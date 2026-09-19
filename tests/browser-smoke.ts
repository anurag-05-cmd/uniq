import { chromium, expect, type BrowserContext, type Page } from '../frontend/node_modules/@playwright/test';

const base = process.env.WEB_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({headless:true});
const contexts: BrowserContext[] = [];
const errors: string[] = [];
const password = 'CedarDemo!2026';
const output = '.artifacts/browser';
await Bun.write(output + '/.keep', '');

async function page(width=1440,height=1000) {
  const context = await browser.newContext({viewport:{width,height}});
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error=>errors.push(error.message));
  return page;
}
async function login(page:Page, email:string, route:string) {
  await page.goto(base + '/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(url=>url.pathname===route);
  await expect(page.getByRole('button',{name:/Sign out/})).toBeVisible();
}
async function overflow(page:Page) {
  const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
  expect(size.content, 'No horizontal overflow at the mobile viewport').toBeLessThanOrEqual(size.viewport);
}
try {
  const customer=await page(390,844);
  await customer.goto(base+'/login');
  await customer.getByRole('button',{name:'New here? Create an account'}).click();
  await customer.getByLabel('Your name',{exact:true}).fill('Browser acceptance guest');
  await customer.getByLabel('Email address').fill(`browser-${crypto.randomUUID()}@example.test`);
  await customer.getByLabel('Password',{exact:false}).fill(password);
  await customer.getByRole('button',{name:'Create account & continue'}).click();
  await customer.waitForURL(url=>url.pathname==='/');
  await expect(customer.getByRole('button',{name:'Join the waitlist',exact:true})).toBeVisible();
  await overflow(customer);
  await customer.screenshot({path:output+'/customer-mobile-join.png',fullPage:true});
  await customer.getByRole('button',{name:'Join the waitlist',exact:true}).click();
  const token=await customer.locator('.token-line h2').textContent({timeout:15000});
  expect(token).toMatch(/^C-\d+$/);
  await expect(customer.getByRole('button',{name:'I’m here · scan venue QR'})).toBeVisible({timeout:15000});
  await customer.screenshot({path:output+'/customer-mobile-waiting.png',fullPage:true});

  const display=await page();
  await login(display,'display@cedar.local','/display');
  await expect(display.getByAltText('Rotating restaurant arrival check-in QR code')).toBeVisible();
  await display.screenshot({path:output+'/public-display.png',fullPage:true});
  const board=await (await display.request.get(base+'/api/v1/display/board')).json();
  expect(board.challenge).toBeTruthy();
  await customer.getByRole('button',{name:'I’m here · scan venue QR'}).click();
  await customer.getByLabel('Venue check-in link or challenge').fill(`${base}/check-in?challenge=${board.challenge}`);
  await customer.getByRole('button',{name:'Confirm my arrival'}).click();
  await expect(customer.getByText('You’re checked in. Stay nearby; we’re matching your party with a suitable table.')).toBeVisible();

  const host=await page();
  await login(host,'host@cedar.local','/host');
  const row=host.locator('.party-row').filter({hasText:token!});
  await expect(row).toBeVisible({timeout:15000});
  await host.getByRole('button',{name:'Call next suitable party ↗'}).click();
  await expect(customer.getByText('YOUR TABLE IS READY',{exact:true})).toBeVisible({timeout:15000});
  await customer.screenshot({path:output+'/customer-table-ready.png',fullPage:true});
  await expect(display.locator('.call-line').filter({hasText:token!})).toBeVisible({timeout:15000});
  expect(await display.locator('.display-page').innerText()).not.toContain('Browser acceptance guest');
  await row.getByRole('button',{name:'Seat party',exact:true}).click();
  await host.getByRole('button',{name:'Confirm seat',exact:true}).click();
  await expect(row.getByRole('button',{name:'Start dining',exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Start dining',exact:true}).click();
  await host.getByRole('button',{name:'Confirm dining',exact:true}).click();
  await expect(row.getByText('Enjoy your meal',{exact:true})).toBeVisible();
  await host.screenshot({path:output+'/host-live-service.png',fullPage:true});
  await row.getByRole('button',{name:'Complete visit',exact:true}).click();
  await host.getByRole('button',{name:'Confirm complete',exact:true}).click();
  await expect(customer.getByText('Thanks for dining with us',{exact:true})).toBeVisible({timeout:15000});
  await customer.getByText('How was your visit? Leave feedback',{exact:true}).click();
  await customer.getByLabel('Anything we should know?').fill('The complete browser workflow passed.');
  await customer.getByRole('button',{name:'Send feedback',exact:true}).click();
  await expect(customer.getByText('Thank you. Your feedback helps us make the next visit better.')).toBeVisible();
  await overflow(customer);

  const manager=await page();
  await login(manager,'manager@cedar.local','/manager');
  await expect(manager.getByText('Average wait', {exact:true})).toBeVisible();
  await expect(manager.locator('.trend-chart')).toBeVisible();
  await manager.screenshot({path:output+'/manager-overview.png',fullPage:true});
  expect(errors, 'Uncaught browser application errors').toEqual([]);
  const result={passed:true,base,token,viewports:['390x844','1440x1000'],flows:['registration','remote join','calculated ETA','QR check-in','SSE live customer/host/display','call','seat','dining','completion','feedback','manager overview','display privacy'],pageErrors:errors,completedAt:new Date().toISOString()};
  await Bun.write(output+'/result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  for(let i=0;i<contexts.length;i++) for(const page of contexts[i]!.pages()) await page.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{});
  await Bun.write(output+'/failure.json',JSON.stringify({message:String(error),errors},null,2));
  throw error;
} finally { await browser.close(); }
