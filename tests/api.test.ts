import { beforeAll, describe, expect, test } from 'bun:test';

/** Black-box checks against the native demo API. Run only against a disposable demo database. */
const endpoint = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const base = endpoint.endsWith('/api/v1') ? endpoint : endpoint + '/api/v1';
const enabled = process.env.RUN_API_TESTS === 'true';
const suite = enabled ? describe : describe.skip;
const password = 'CedarDemo!2026';

class Client {
  cookies = new Map<string, string>();
  csrf = '';
  header = 'X-CSRF-TOKEN';

  async request(path: string, method = 'GET', body?: unknown, key = crypto.randomUUID(), csrf = true) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (method !== 'GET') {
      headers['Idempotency-Key'] = key;
      if (csrf) headers[this.header] = this.csrf;
    }
    if (body !== undefined) headers['Content-Type'] = body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json';
    const response = await fetch(`${base}${path}`, {
      method, headers, redirect: 'manual',
      body: body === undefined ? undefined : body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const cookie = raw.split(';', 1)[0]!;
      const split = cookie.indexOf('=');
      this.cookies.set(cookie.slice(0, split), cookie.slice(split + 1));
    }
    const text = await response.text();
    let data: any = undefined;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { status: response.status, data, headers: response.headers };
  }

  async refreshCsrf() {
    const r = await this.request('/auth/csrf');
    expect(r.status).toBe(200);
    this.csrf = r.data.token;
    this.header = r.data.headerName;
  }

  async login(email: string) {
    await this.refreshCsrf();
    const r = await this.request('/auth/login', 'POST', new URLSearchParams({ username: email, password }));
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    await this.refreshCsrf();
    return r.data;
  }

  async register() {
    const email = `test-${crypto.randomUUID()}@example.test`;
    await this.refreshCsrf();
    const r = await this.request('/auth/register', 'POST', { email, password, displayName: 'API test guest' });
    expect([200, 201], JSON.stringify(r.data)).toContain(r.status);
    await this.login(email);
    return this;
  }

  async join(partySize = 2, key = crypto.randomUUID()) {
    return this.request('/entries', 'POST', { partySize, preference: 'ANY', accessible: false }, key);
  }
}

suite('Native PostgreSQL REST acceptance', () => {
  let host: Client, manager: Client, display: Client;
  beforeAll(async () => {
    host = new Client(); manager = new Client(); display = new Client();
    await host.login('host@cedar.local');
    await manager.login('manager@cedar.local');
    await display.login('display@cedar.local');
    const restaurant = await manager.request('/restaurant');
    expect(restaurant.data.demoMode, 'These checks require the demo profile and disposable database').toBe(true);
    // Each test run starts with the documented simulator reset, never direct application-table SQL.
    const reset = await manager.request('/demo/reset', 'POST', {});
    expect(reset.status, JSON.stringify(reset.data)).toBe(200);
    await host.login('host@cedar.local');
    await manager.login('manager@cedar.local');
    await display.login('display@cedar.local');
  }, 60000);

  test('authorization, CSRF and display privacy are enforced', async () => {
    const anonymous = new Client();
    expect((await anonymous.request('/host/board')).status).toBe(401);
    expect((await anonymous.request('/display/board')).status).toBe(401);
    const customer = await new Client().register();
    expect((await customer.request('/host/board')).status).toBe(403);
    expect((await customer.request('/admin/analytics')).status).toBe(403);
    expect((await customer.request('/display/board')).status).toBe(403);
    expect((await customer.request('/entries', 'POST', { partySize: 2, preference: 'ANY', accessible: false }, crypto.randomUUID(), false)).status).toBe(403);
    expect((await display.request('/host/call-next', 'POST', {})).status).toBe(403);
    const board = await display.request('/display/board');
    expect(board.status).toBe(200);
    expect(JSON.stringify(board.data)).not.toContain('@cedar.local');
    expect(board.data).not.toHaveProperty('customerName');
  });

  test('operational metrics are private and public health remains minimal', async () => {
    const origin = base.replace(/\/api\/v1$/, '');
    const health = await fetch(origin + '/actuator/health');
    expect(health.status).toBe(200);
    const healthBody = await health.json() as Record<string, unknown>;
    expect(healthBody.status).toBe('UP');
    expect(healthBody).not.toHaveProperty('components');
    expect(Object.keys(healthBody).every(key => ['status', 'groups'].includes(key))).toBe(true);
    expect((await fetch(origin + '/actuator/metrics')).status).toBe(401);
    const customer = await new Client().register();
    const cookie = (client:Client) => [...client.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    expect((await fetch(origin + '/actuator/metrics', {headers:{Cookie:cookie(customer)}})).status).toBe(403);
    const response = await fetch(origin + '/actuator/metrics', {headers:{Cookie:cookie(manager)}});
    expect(response.status).toBe(200);
    const names = (await response.json() as {names:string[]}).names;
    expect(names).toContain('cedar.queue.deadline.lag');
    expect(names).toContain('cedar.outbox.pending');
    expect(names).toContain('cedar.venue.lock.wait');
    expect(names).toContain('http.server.requests');
  });
  test('parallel duplicate joins serialize and idempotency rejects changed bodies', async () => {
    const customer = await new Client().register();
    const key = crypto.randomUUID();
    const attempts = await Promise.all(Array.from({ length: 8 }, () => customer.join(2, key)));
    for (const r of attempts) expect([200, 201], JSON.stringify(r.data)).toContain(r.status);
    expect(new Set(attempts.map(r => r.data.id)).size).toBe(1);
    const changed = await customer.join(4, key);
    expect(changed.status).toBe(409);
    const again = await customer.join();
    expect([200, 409]).toContain(again.status);
    const list = await customer.request('/me/entries');
    expect(list.data.length).toBe(1);
    const entry = list.data[0];
    expect((await customer.request(`/entries/${entry.id}/cancel`, 'POST', { expectedVersion: entry.version, reason: 'Acceptance cleanup' })).status).toBe(200);
  });

  test('remote join → verified QR → concurrent call/seat → dining → completion → feedback', async () => {
    const customer = await new Client().register();
    const stranger = await new Client().register();
    const joined = await customer.join();
    expect([200, 201], JSON.stringify(joined.data)).toContain(joined.status);
    let entry = joined.data;
    expect(entry.token).toBeTruthy();
    expect(entry.etaSeconds).toBeGreaterThanOrEqual(0);
    expect(entry.computedAt).toBeTruthy();
    expect(['TABLE_WINDOW', 'PARTY_WINDOW', 'PARTY_SIZE', 'PARTY_SIZE_WINDOW', 'POOL', 'SERVICE_POOL', 'RESTAURANT_POOL', 'DEFAULT']).toContain(entry.estimateSource);
    expect((await stranger.request(`/entries/${entry.id}`)).status).toBe(404);
    expect((await host.request(`/host/entries/${entry.id}/complete`, 'POST', { expectedVersion: entry.version })).status).toBe(409);
    const invalidQr = await customer.request(`/entries/${entry.id}/check-in`, 'POST', { challenge: 'not-a-valid-challenge', expectedVersion: entry.version });
    expect([409, 422]).toContain(invalidQr.status);
    const qr = await display.request('/display/board');
    expect(qr.data.challenge).toBeTruthy();
    const checked = await customer.request(`/entries/${entry.id}/check-in`, 'POST', { challenge: qr.data.challenge, expectedVersion: entry.version });
    expect(checked.status, JSON.stringify(checked.data)).toBe(200);
    entry = checked.data;
    expect(entry.status).toBe('CHECKED_IN');
    const repeated = await customer.request(`/entries/${entry.id}/check-in`, 'POST', { challenge: qr.data.challenge, expectedVersion: entry.version });
    expect(repeated.status).toBe(200);
    const board = await host.request('/host/board');
    const table = board.data.tables.find((t: any) => t.capacity === 2 && t.enabled && t.status === 'AVAILABLE');
    expect(table).toBeTruthy();
    const calls = await Promise.all(Array.from({ length: 8 }, () => host.request('/host/call-next', 'POST', { tableId: table.id, expectedVersion: table.version })));
    expect(calls.filter(r => r.status === 200).length).toBe(1);
    entry = calls.find(r => r.status === 200)!.data;
    expect(entry.status).toBe('CALLED');
    expect(entry.tableId).toBe(table.id);
    const latestTable = (await host.request('/host/board')).data.tables.find((t: any) => t.id === table.id);
    expect((await host.request(`/host/tables/${table.id}/availability`, 'POST', { status: 'UNAVAILABLE', enabled: true, expectedVersion: latestTable.version, reason: 'Should conflict during reservation' })).status).toBe(409);
    expect((await customer.request(`/entries/${entry.id}/snooze`, 'POST', { expectedVersion: entry.version })).status).toBe(409);
    const seatKey = crypto.randomUUID();
    const seats = await Promise.all(Array.from({ length: 5 }, () => host.request(`/host/entries/${entry.id}/seat`, 'POST', { expectedVersion: entry.version }, seatKey)));
    for (const r of seats) expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(new Set(seats.map(r => r.data.id)).size).toBe(1);
    entry = seats[0]!.data;
    expect(entry.status).toBe('SEATED');
    entry = (await host.request(`/host/entries/${entry.id}/dining`, 'POST', { expectedVersion: entry.version })).data;
    expect(entry.status).toBe('DINING');
    const completeKey = crypto.randomUUID();
    const completions = await Promise.all(Array.from({ length: 5 }, () => host.request(`/host/entries/${entry.id}/complete`, 'POST', { expectedVersion: entry.version }, completeKey)));
    for (const r of completions) expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(completions[0]!.data.status).toBe('COMPLETED');
    const after = await host.request('/host/board');
    expect(after.data.tables.find((t: any) => t.id === table.id).status).toBe('AVAILABLE');
    expect((await customer.request(`/entries/${entry.id}/feedback`, 'POST', { rating: 5, comment: 'Acceptance flow completed.' })).status).toBeLessThan(300);
    expect((await customer.request('/me/notifications')).status).toBe(200);
    const analytics = await manager.request('/admin/analytics');
    expect(analytics.data.completedParties).toBeGreaterThan(0);
    expect(analytics.data.averageDiningMinutes).toBeGreaterThanOrEqual(0);
    expect((await manager.request('/admin/audit')).data.length).toBeGreaterThan(0);
  }, 60000);

  test('large party cannot be assigned to undersized table; assistance requires reason', async () => {
    const customer = await new Client().register();
    let entry = (await customer.join(6)).data;
    expect(entry.id).toBeTruthy();
    const missingReason = await host.request(`/host/entries/${entry.id}/assist`, 'POST', { expectedVersion: entry.version });
    expect([400, 422]).toContain(missingReason.status);
    const assisted = await host.request(`/host/entries/${entry.id}/assist`, 'POST', { expectedVersion: entry.version, reason: 'Physical arrival verified; camera unavailable' });
    expect(assisted.status, JSON.stringify(assisted.data)).toBe(200);
    entry = assisted.data;
    const board = await host.request('/host/board');
    const small = board.data.tables.find((t: any) => t.capacity === 2 && t.status === 'AVAILABLE');
    const incompatible = await host.request(`/host/entries/${entry.id}/assign`, 'POST', { tableId: small.id, expectedVersion: entry.version, reason: 'Capacity validation acceptance check' });
    expect([409, 422]).toContain(incompatible.status);
    expect((await customer.request(`/entries/${entry.id}/cancel`, 'POST', { expectedVersion: entry.version, reason: 'Acceptance cleanup' })).status).toBe(200);
  });

  test('invalid manager policies fail without changing operational policy', async () => {
    const restaurant = (await manager.request('/restaurant')).data;
    const invalid = await manager.request('/admin/policy', 'PUT', { ...restaurant.policy, maxSnoozes: 99, reason: 'Validation acceptance check' });
    expect([400, 422]).toContain(invalid.status);
    expect((await manager.request('/restaurant')).data.policy.maxSnoozes).toBe(restaurant.policy.maxSnoozes);
  });
  test('entry validation rejects impossible parties and client-supplied priority', async () => {
    const customer = await new Client().register();
    for (const partySize of [0, -1, 1000, 2.5]) {
      const r = await customer.request('/entries', 'POST', { partySize, preference: 'ANY', accessible: false });
      expect([400, 409, 422], JSON.stringify(r.data)).toContain(r.status);
    }
    const forged = await customer.request('/entries', 'POST', { partySize: 2, preference: 'ANY', accessible: false, priority: true });
    expect([400, 422], JSON.stringify(forged.data)).toContain(forged.status);
    expect((await customer.request('/me/entries')).data).toHaveLength(0);
  });

  test('table availability affects real capacity and changes are version-checked', async () => {
    const board = (await host.request('/host/board')).data;
    const table = board.tables.find((t: any) => t.status === 'AVAILABLE');
    expect(table).toBeTruthy();
    const change = await host.request(`/host/tables/${table.id}/availability`, 'POST', { status: 'UNAVAILABLE', enabled: true, expectedVersion: table.version, reason: 'Temporary cleaning acceptance check' });
    expect(change.status, JSON.stringify(change.data)).toBe(200);
    expect(change.data.status).toBe('UNAVAILABLE');
    const stale = await host.request(`/host/tables/${table.id}/availability`, 'POST', { status: 'AVAILABLE', enabled: true, expectedVersion: table.version, reason: 'Stale acceptance check' });
    expect(stale.status).toBe(409);
    const restore = await host.request(`/host/tables/${table.id}/availability`, 'POST', { status: 'AVAILABLE', enabled: true, expectedVersion: change.data.version, reason: 'Cleaning finished acceptance check' });
    expect(restore.status).toBe(200);
  });
  test('manager can configure the restaurant, policy, dining areas, tables and staff', async () => {
    const original=(await manager.request('/restaurant')).data;
    const suffix=crypto.randomUUID().slice(0,8);
    const configured=await manager.request('/admin/restaurant','PUT',{name:original.name,location:original.location,timezone:'Asia/Kolkata',description:'Acceptance configuration saved',reason:'Verify restaurant configuration'});
    expect(configured.status,JSON.stringify(configured.data)).toBe(200);
    expect((await manager.request('/restaurant')).data.description).toBe('Acceptance configuration saved');
    const area=await manager.request('/admin/areas','POST',{name:'Test dining '+suffix});
    expect(area.status,JSON.stringify(area.data)).toBeLessThan(300);
    const created=await manager.request('/admin/tables','POST',{number:'QA-'+suffix,areaId:area.data.id,capacity:6,accessible:false,enabled:true});
    expect(created.status,JSON.stringify(created.data)).toBeLessThan(300);
    const updated=await manager.request(`/admin/tables/${created.data.id}`,'PUT',{number:created.data.number,areaId:area.data.id,capacity:8,accessible:true,enabled:true,expectedVersion:created.data.version,reason:'Verify capacity and accessibility editing'});
    expect(updated.status,JSON.stringify(updated.data)).toBe(200);
    expect(updated.data.capacity).toBe(8);
    expect(updated.data.accessible).toBe(true);
    const policy=await manager.request('/admin/policy','PUT',{...original.policy,defaultDiningMinutes:46,reason:'Verify policy editing'});
    expect(policy.status,JSON.stringify(policy.data)).toBe(200);
    expect((await manager.request('/restaurant')).data.policy.defaultDiningMinutes).toBe(46);
    const email=`staff-${suffix}@example.test`;
    const staff=await manager.request('/admin/staff','POST',{email,password,displayName:'Acceptance host',role:'HOST'});
    expect(staff.status,JSON.stringify(staff.data)).toBeLessThan(300);
    const newHost=new Client();
    await newHost.login(email);
    expect((await newHost.request('/host/board')).status).toBe(200);
    expect((await newHost.request('/admin/analytics')).status).toBe(403);
    expect((await manager.request('/admin/staff')).data.some((u:any)=>u.email===email)).toBe(true);
    await manager.request('/admin/policy','PUT',{...original.policy,reason:'Restore original policy'});
    await manager.request('/admin/restaurant','PUT',{name:original.name,location:original.location,timezone:original.timezone,description:original.description,reason:'Restore original description'});
  });

  test('session close cancels waiting parties and a new operating session accepts joins', async () => {
    const customer=await new Client().register();
    const joined=await customer.join();
    expect(joined.status,JSON.stringify(joined.data)).toBeLessThan(300);
    const closed=await manager.request('/admin/session/close','POST',{reason:'Acceptance service closure'});
    expect(closed.status,JSON.stringify(closed.data)).toBe(200);
    expect((await manager.request('/restaurant')).data.open).toBe(false);
    expect((await customer.request(`/entries/${joined.data.id}`)).data.status).toBe('CANCELLED');
    expect((await customer.join()).status).toBe(409);
    const opened=await manager.request('/admin/session/open','POST',{reason:'Acceptance next service'});
    expect(opened.status,JSON.stringify(opened.data)).toBe(200);
    expect((await manager.request('/restaurant')).data.open).toBe(true);
    const next=await customer.join();
    expect(next.status,JSON.stringify(next.data)).toBeLessThan(300);
    expect(next.data.id).not.toBe(joined.data.id);
    await customer.request(`/entries/${next.data.id}/cancel`,'POST',{expectedVersion:next.data.version,reason:'Acceptance cleanup'});
  });

  test('every demo simulation operation produces real persisted state', async () => {
    const initial=(await host.request('/host/board')).data;
    const table=initial.tables.find((t:any)=>t.status==='AVAILABLE' && t.enabled);
    for(const operation of ['occupy','complete']) {
      const result=await manager.request(`/demo/${operation}`,'POST',{tableId:table.id});
      expect(result.status,JSON.stringify(result.data)).toBe(200);
      const current=(await host.request('/host/board')).data.tables.find((t:any)=>t.id===table.id);
      expect(current.status).toBe(operation==='occupy'?'OCCUPIED':'AVAILABLE');
    }
    for(const [operation,count] of [['add',1],['add',3],['rush',8],['no-show',1],['activity',2]] as const) {
      const result=await manager.request(`/demo/${operation}`,'POST',{count});
      expect(result.status,operation+': '+JSON.stringify(result.data)).toBe(200);
    }
    const active=(await host.request('/host/board')).data;
    expect(active.entries.length).toBeGreaterThanOrEqual(10);
    expect((await manager.request('/admin/analytics')).data.noShows).toBeGreaterThan(0);
    expect((await manager.request('/demo/free','POST',{})).status).toBe(200);
    const reset=await manager.request('/demo/reset','POST',{});
    expect(reset.status,JSON.stringify(reset.data)).toBe(200);
    expect((await host.request('/host/board')).data.entries).toHaveLength(0);
    expect((await manager.request('/admin/analytics')).data.completedParties).toBeGreaterThan(0);
  });
});
