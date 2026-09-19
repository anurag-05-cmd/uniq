/** Native pilot smoke; the launcher must target the disposable cedar_test database. */
if (process.env.RUN_API_TESTS !== 'true') throw new Error('Use scripts/test-api.ps1 -LoadSmoke with the dedicated test database.');
const base = (process.env.API_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '') + '/api/v1';
const cookies = new Map<string,string>();
let csrf = {token:'',headerName:'X-CSRF-TOKEN'};
function cookie() { return [...cookies].map(([k,v])=>`${k}=${v}`).join('; '); }
async function api(path:string, body?:unknown) {
  const headers:Record<string,string>={Cookie:cookie()};
  if(body!==undefined) { headers[csrf.headerName]=csrf.token; headers['Idempotency-Key']=crypto.randomUUID();headers['Content-Type']=body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'; }
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:body instanceof URLSearchParams?body.toString():JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  for(const raw of response.headers.getSetCookie()) {const part=raw.split(';')[0]!; const split=part.indexOf('=');cookies.set(part.slice(0,split),part.slice(split+1));}
  const data=await response.json();
  if(!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data as any;
}
csrf=await api('/auth/csrf');
await api('/auth/login',new URLSearchParams({username:'manager@cedar.local',password:'CedarDemo!2026'}));
csrf=await api('/auth/csrf');
if(!(await api('/restaurant')).demoMode) throw new Error('Demo profile required.');
await api('/demo/reset',{});
for(let i=0;i<2;i++) await api('/demo/rush',{count:50});
const initial=await api('/host/board');
if(initial.entries.length!==100) throw new Error(`Expected100parties, got ${initial.entries.length}`);
const controllers:AbortController[]=[];
let latestRevision=0;
let eventTime=0;
async function connect(index:number) {
  const controller=new AbortController();controllers.push(controller);
  const response=await fetch(base+'/events',{headers:{Cookie:cookie()},signal:controller.signal});
  if(response.status!==200||!response.body) throw new Error(`SSE ${index}: ${response.status}`);
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  function consume(chunk:Uint8Array) {
    buffer+=decoder.decode(chunk,{stream:true});
    let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0) {
      const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
      const line=frame.split('\n').find(l=>l.startsWith('data:'));
      if(index===0&&line) { const data=JSON.parse(line.slice(5));latestRevision=data.revision;eventTime=performance.now(); }
    }
  }
  const first=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('SSE initial event timeout')),10000))]);
  if(first.done) throw new Error('SSE closed unexpectedly');
  consume(first.value);
  void (async()=>{try {while(true){const item=await reader.read();if(item.done)break;consume(item.value);}}catch{}})();
}
function percentile(values:number[],p:number) { const sorted=[...values].sort((a,b)=>a-b);return Math.round(sorted[Math.ceil(p*sorted.length)-1]!); }
try {
  await Promise.all(Array.from({length:100},(_,i)=>connect(i)));
  // Warm connection pools and JIT before the bounded measured sample.
  for(let i=0;i<10;i++) await api('/host/board');
  const reads:number[]=[];
  await Promise.all(Array.from({length:10},async()=>{for(let i=0;i<20;i++){const start=performance.now();await api('/host/board');reads.push(performance.now()-start);}}));
  const mutations:number[]=[];
  for(let i=0;i<3;i++) {const start=performance.now();await api('/host/call-next',{});mutations.push(performance.now()-start);}
  const committed=performance.now();
  const revision=(await api('/host/board')).revision;
  const deadline=performance.now()+5000;
  while(latestRevision<revision&&performance.now()<deadline) await Bun.sleep(50);
  const liveDelay=latestRevision>=revision?Math.max(0,Math.round(eventTime-committed)):null;
  const result={queueParties:100,sseConnections:100,concurrentReaders:10,readRequests:reads.length,readP95Ms:percentile(reads,.95),mutationP95Ms:percentile(mutations,.95),observedLiveDelayMs:liveDelay,readTargetMet:percentile(reads,.95)<500,mutationTargetMet:percentile(mutations,.95)<1000,liveTargetMet:liveDelay!==null&&liveDelay<3000,completedAt:new Date().toISOString()};
  await Bun.write('.artifacts/load-smoke.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(liveDelay===null) throw new Error('Committed state was not signalled within five seconds');
} finally {for(const controller of controllers)controller.abort();}
