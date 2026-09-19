// Regenerate with: bun scripts/generate-openapi.mjs
// Source of truth: ApiController, Requests, Dtos and the shared implementation contract.
import { mkdir, writeFile } from 'node:fs/promises';
const str = (format) => ({ type: 'string', ...(format ? { format } : {}) });
const integer = (minimum = 0, maximum) => ({ type: 'integer', minimum, ...(maximum === undefined ? {} : { maximum }) });
const number = { type: 'number' };
const bool = { type: 'boolean' };
const uuid = str('uuid');
const instant = str('date-time');
const nullable = (s) => ({ ...s, type: [s.type, 'null'] });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (item) => ({ type: 'array', items: typeof item === 'string' ? ref(item) : item });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const bounded = (max, min = 0) => ({ ...str(), minLength: min, maxLength: max });
const roles = ['CUSTOMER', 'HOST', 'MANAGER', 'DISPLAY'];
const statuses = ['WAITING', 'ARRIVAL_WINDOW', 'CHECKED_IN', 'SNOOZED', 'CALLED', 'SEATED', 'DINING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'];
const policyProps = {
  arrivalLeadMinutes: integer(1,120), arrivalGraceMinutes: integer(1,30), callGraceMinutes: integer(1,10), maxSnoozes: integer(0,2), snoozeMinutes: integer(1,10), snoozeSpots: integer(1,10), priorityBurstLimit: integer(1,2), agingMinutes: integer(1,30), starvationMinutes: integer(5,120), sampleSize: integer(5,100), sampleHorizonMinutes: integer(15,1440), minimumSamples: integer(1,100), defaultDiningMinutes: integer(5,180), maxActiveParties: integer(1,500), capacityWastePenalty: integer(0,30),
};
const changeProps = { expectedVersion: integer(), reason: bounded(500), tableId: uuid, priority: bool, challenge: bounded(128) };
const tableProps = { number: bounded(20,1), areaId: uuid, capacity: integer(1,20), accessible: bool, enabled: bool, expectedVersion: integer(), reason: bounded(500) };
const schemas = {
  Problem: { type:'object', properties:{type:str('uri-reference'), title:str(),status:integer(400,599),detail:str(),instance:str('uri-reference'),code:str(),requestId:str()}, required:['detail','code'], additionalProperties:true },
  Csrf: object({token:str(),headerName:str()}),
  User: object({id:uuid,email:str('email'),displayName:str(),role:{type:'string',enum:roles}}),
  RegisterInput: object({email:{...str('email'),maxLength:254},password:{...bounded(72,12),description:'Maximum 72 UTF-8 bytes. Passwords are hashed with BCrypt.'},displayName:bounded(100,1)}),
  LoginInput: object({username:str('email'),password:str()}),
  Message: object({message:str()}),
  Policy: object(policyProps),
  PolicyInput: {...object({...policyProps,reason:bounded(500,1)}),description:'minimumSamples must not exceed sampleSize. Session policy updates are audited.'},
  Area: object({id:uuid,name:str()}),
  AreaInput: object({name:bounded(100,1)}),
  RestaurantTable: object({id:uuid,number:str(),areaId:uuid,areaName:str(),capacity:integer(1,20),accessible:bool,status:{type:'string',enum:['AVAILABLE','ASSIGNED','OCCUPIED','UNAVAILABLE']},enabled:bool,version:integer()}),
  TableInput: object(tableProps,['number','areaId','capacity']),
  TableUpdateInput: object(tableProps,['number','areaId','capacity','expectedVersion','reason']),
  Restaurant: object({id:uuid,name:str(),location:str(),timezone:str(),description:nullable(str()),open:bool,demoMode:bool,serverTime:instant,sessionId:nullable(uuid),sessionStatus:{type:'string',enum:['OPEN','CLOSING','CLOSED']},recoveryRequired:bool,policy:ref('Policy'),areas:list('Area'),tables:list('RestaurantTable'),waitingCount:integer()}),
  RestaurantInput: object({name:bounded(120,1),location:bounded(200,1),timezone:{...bounded(64,1),description:'Valid IANA timezone, for example Asia/Kolkata.'},description:bounded(1000),reason:bounded(500,1)},['name','location','timezone','reason']),
  Entry: object({id:uuid,token:str(),customerName:str(),partySize:integer(1,20),preference:nullable(str()),accessible:bool,status:{type:'string',enum:statuses},joinedAt:instant,fairnessSince:instant,checkedInAt:nullable(instant),arrivalWindowOpenedAt:nullable(instant),arrivalDeadline:nullable(instant),callDeadline:nullable(instant),snoozeReleaseAt:nullable(instant),snoozeCount:integer(0,2),snoozesRemaining:integer(0,2),priority:bool,tableId:nullable(uuid),tableNumber:nullable(str()),areaName:nullable(str()),etaSeconds:nullable(integer()),estimatedStartAt:nullable(instant),computedAt:nullable(instant),estimateSource:str(),sampleCount:integer(),confidence:{type:'string',enum:['LOW','MEDIUM','HIGH']},assumesArrival:bool,position:nullable(integer(1)),version:integer(),terminalReason:nullable(str())},['id','token','partySize','status','joinedAt','fairnessSince','snoozeCount','priority','version','etaSeconds']),
  JoinInput: object({partySize:integer(1,20),preference:{...bounded(100),description:'ANY or a configured dining-area name. Soft preference.'},accessible:{...bool,description:'Hard accessibility requirement.'}},['partySize']),
  ChangeInput: object(changeProps,[]),
  EntryChangeInput: object(changeProps,['expectedVersion']),
  CheckInInput: object(changeProps,['expectedVersion','challenge']),
  AssistedInput: object(changeProps,['expectedVersion','reason']),
  AssignmentInput: object(changeProps,['expectedVersion','tableId','reason']),
  PriorityInput: object(changeProps,['expectedVersion','priority','reason']),
  AvailabilityInput: object({status:{type:'string',enum:['AVAILABLE','UNAVAILABLE']},enabled:bool,reason:bounded(500,1),expectedVersion:integer()},['status','reason','expectedVersion']),
  Visit: object({id:uuid,entryId:uuid,token:str(),tableId:uuid,tableNumber:str(),partySize:integer(1,20),startedAt:instant,completedAt:nullable(instant),durationSeconds:nullable(integer())}),
  Suggestion: object({entryId:uuid,tableId:uuid,score:number,reason:str()}),
  HostBoard: object({entries:list('Entry'),tables:list('RestaurantTable'),visits:list('Visit'),revision:integer(),serverTime:instant,suggestions:list('Suggestion')}),
  Notification: object({id:uuid,kind:str(),title:str(),body:str(),createdAt:instant,readAt:nullable(instant)}),
  FeedbackInput: object({rating:integer(1,5),comment:bounded(1000)},['rating']),
  Feedback: object({id:uuid,rating:integer(1,5),comment:nullable(str())}),
  SessionInput: object({reason:bounded(500,1),graceSeconds:integer(60,1800),opensAt:instant,closesAt:instant},['reason']),
  StaffInput: object({email:str('email'),password:bounded(72,12),displayName:bounded(100,1),role:{type:'string',enum:['HOST','MANAGER','DISPLAY']}}),
  AuditEvent: object({id:uuid,action:str(),actor:str(),reason:nullable(str()),occurredAt:instant,entryId:nullable(uuid),details:nullable(str())}),
  Analytics: object({averageWaitMinutes:number,averageDiningMinutes:number,completedParties:integer(),cancellations:integer(),noShows:integer(),utilizationPercent:nullable(number),throughputPerHour:nullable(number),queueTrends:list(object({hour:instant,joined:integer(),completed:integer()})),tableUtilization:list(object({tableNumber:str(),utilizationPercent:nullable(number)})),sampleCount:integer(),asOf:instant,periodFrom:instant,availableTableSeconds:integer(),serviceOpenSeconds:integer()}),
  DisplayBoard: object({restaurantName:str(),called:list(object({token:str(),tableNumber:str(),areaName:str()})),challenge:{...str(),description:'Short-lived venue challenge; never log or persist its plaintext.'},expiresAt:instant,serverTime:instant}),
  SimulationInput: object({count:integer(1,60),tableId:uuid},[]),
  RefreshEvent: object({revision:integer(),serverTime:instant}),
};
const parameters = {
  IdempotencyKey:{name:'Idempotency-Key',in:'header',required:true,schema:bounded(80,1),description:'Unique command key per actor/route. Reuse exactly the same key and body to replay a command; changed body with the same key returns 409.'},
  CsrfToken:{name:'X-CSRF-TOKEN',in:'header',required:true,schema:str(),description:'Obtain token/headerName from GET /auth/csrf. Fetch a fresh token after login. Send session cookies.'},
  Id:{name:'id',in:'path',required:true,schema:uuid},
};
const error = {description:'Validation, authorization, expired deadline, stale version, invariant, idempotency or throttling error.',content:{'application/problem+json':{schema:ref('Problem')}}};
const paths = {};
function op(path,method,summary,{input,output,status=200,publicAccess=false,idempotent=true,role='authenticated',description,empty=false}={}) {
  const mutation=method!=='get';
  const p=[];
  if(path.includes('{id}')) p.push({$ref:'#/components/parameters/Id'});
  if(mutation) p.push({$ref:'#/components/parameters/CsrfToken'});
  if(mutation&&idempotent) p.push({$ref:'#/components/parameters/IdempotencyKey'});
  const responses={[status]:{description:status===204?'No content.':'Success.',...(output?{content:{'application/json':{schema:typeof output==='string'?ref(output):output}}}:{})},default:error};
  if(empty) responses['204']={description:'No checked-in party/table pair is currently eligible.'};
  const operation={operationId:(method+'_'+path).replace(/[^A-Za-z0-9]+/g,'_'),summary,description:description||summary,tags:[path.startsWith('/auth')?'Authentication':path.startsWith('/admin')?'Manager':path.startsWith('/host')?'Host':path.startsWith('/demo')?'Development simulator':path.startsWith('/display')?'Display':'Customer'],security:publicAccess?[]:[{session:[]}], 'x-required-role':role,parameters:p,responses};
  if(input) operation.requestBody={required:true,content:{'application/json':{schema:ref(input)}}};
  (paths[path]??={})[method]=operation;
  return operation;
}
op('/auth/csrf','get','Obtain CSRF token',{output:'Csrf',publicAccess:true,role:'anonymous or authenticated'});
op('/auth/register','post','Register a customer',{input:'RegisterInput',output:'User',status:201,publicAccess:true,idempotent:false,role:'anonymous or authenticated'});
const login=op('/auth/login','post','Start authenticated session',{output:'User',publicAccess:true,idempotent:false,role:'anonymous or authenticated',description:'Spring Security form login. Persists a server-side session and rotates its identifier. Fetch a fresh CSRF token afterward.'});
login.requestBody={required:true,content:{'application/x-www-form-urlencoded':{schema:ref('LoginInput')}}};
op('/auth/logout','post','End authenticated session',{status:204,idempotent:false});
op('/me','get','Read current account',{output:'User'});
op('/restaurant','get','Read restaurant availability and public configuration',{output:'Restaurant',publicAccess:true,role:'anonymous or authenticated'});
op('/me/entries','get','Read own recent waitlist entries',{output:list('Entry'),role:'CUSTOMER, HOST or MANAGER'});
op('/entries','post','Join remote restaurant waitlist',{input:'JoinInput',output:'Entry',status:201,role:'CUSTOMER, HOST or MANAGER',description:'One active reservation per customer in the operating session. Physical capacity/accessibility and open service are validated. The idempotency key replays the original result.'});
op('/entries/{id}','get','Read own entry or staff-authorized entry',{output:'Entry',role:'owner, HOST or MANAGER'});
for(const action of ['check-in','snooze','cancel']) op(`/entries/{id}/${action}`,'post',`${action} own reservation`,{input:action==='check-in'?'CheckInInput':'EntryChangeInput',output:'Entry',role:'owner',description:action==='check-in'?'Validate current restaurant QR, authenticated ownership and server-side arrival deadline. Successful check-in replays are idempotent.':'Backend enforces lifecycle and optimistic version. Snooze requires existing followers and remaining quota; identity and original join timestamp are preserved.'});
op('/entries/{id}/feedback','post','Leave feedback after dining completion',{input:'FeedbackInput',output:'Feedback',role:'owner'});
op('/me/notifications','get','Read own durable notifications',{output:list('Notification'),role:'CUSTOMER, HOST or MANAGER'});
op('/me/notifications/{id}/read','post','Mark owned notification read',{status:204,role:'owner'});
op('/host/board','get','Read operational queue, visits and allocation suggestions',{output:'HostBoard',role:'HOST or MANAGER'});
op('/host/call-next','post','Assign globally optimized compatible party/table pair',{input:'ChangeInput',output:'Entry',empty:true,role:'HOST or MANAGER',description:'Omit tableId for venue-wide selection; provide tableId to constrain selection to an available table. Checked-in parties only. Capacity, verified priority, fairness, burst limit and starvation safeguards apply.'});
for(const action of ['assist','priority','assign','seat','dining','complete','no-show']) op(`/host/entries/{id}/${action}`,'post',`Host ${action} reservation`,{input:action==='assist'||action==='no-show'?'AssistedInput':action==='priority'?'PriorityInput':action==='assign'?'AssignmentInput':'EntryChangeInput',output:'Entry',role:'HOST or MANAGER'});
op('/host/tables/{id}/availability','post','Change unoccupied table availability',{input:'AvailabilityInput',output:'RestaurantTable',role:'HOST or MANAGER'});
op('/admin/analytics','get','Read trailing 24-hour restaurant analytics',{output:'Analytics',role:'MANAGER',description:'Wait/dining averages, throughput by operating hours, table utilization by enabled intervals, queue trends and terminal counts. Zero utilization/throughput denominator produces null.'});
op('/admin/audit','get','Read latest 200 audit events',{output:list('AuditEvent'),role:'MANAGER'});
op('/admin/restaurant','put','Update restaurant details',{input:'RestaurantInput',output:'Message',role:'MANAGER'});
op('/admin/policy','put','Update validated queue policies',{input:'PolicyInput',output:'Policy',role:'MANAGER'});
op('/admin/areas','post','Create dining area',{input:'AreaInput',output:'Area',role:'MANAGER'});
op('/admin/tables','post','Create configured restaurant table',{input:'TableInput',output:'RestaurantTable',role:'MANAGER'});
op('/admin/tables/{id}','put','Update unoccupied table configuration',{input:'TableUpdateInput',output:'RestaurantTable',role:'MANAGER'});
for(const action of ['open','close','recover']) op(`/admin/session/${action}`,'post',`${action} operating session`,{input:'SessionInput',output:'Message',role:'MANAGER'});
op('/admin/staff','get','List staff and display accounts',{output:list('User'),role:'MANAGER'});
op('/admin/staff','post','Provision staff or display account',{input:'StaffInput',output:'User',role:'MANAGER'});
op('/display/board','get','Read anonymous calls and rotating arrival QR',{output:'DisplayBoard',role:'DISPLAY, HOST or MANAGER',description:'Never contains customer identity. Refresh regularly: challenge rotates every 30 seconds and expires after 45 seconds; multiple customers may use one valid challenge.'});
const events=op('/events','get','Subscribe to authorized live refresh signals',{description:'SSE event refresh carries only revision and serverTime. Reconnect and GET authorized resources to resynchronize; never infer domain success solely from the stream.'});
events.responses['200']={description:'SSE stream with refresh events and heartbeat updates.',content:{'text/event-stream':{schema:{type:'string',example:'event: refresh\ndata: {"revision":12,"serverTime":"2026-09-19T12:00:00Z"}\n\n'}}}};
for(const action of ['add','rush','occupy','free','complete','no-show','activity','reset']) op(`/demo/${action}`,'post',`Simulate ${action}`,{input:'SimulationInput',output:'Message',role:'MANAGER',description:'Available only in demo/dev profile; otherwise 404. Manager-authorized simulation is audited. Reset operates on demonstration activity.'});
const spec={openapi:'3.1.0',info:{title:'The Cedar Table — Smart Queue API',version:'1.0.0',description:'Restaurant queue, arrival, table allocation and dining API. All commands use server sessions and CSRF. Domain commands additionally require Idempotency-Key. Read projections and estimates are advisory; PostgreSQL transactions enforce authoritative state.'},servers:[{url:'/api/v1',description:'Same-origin frontend proxy or backend'}],security:[{session:[]}],paths,components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'SESSION',description:'Spring Session JDBC cookie. HttpOnly, SameSite=Lax; secure outside local demo profile.'}},parameters,schemas}};
await mkdir(new URL('../contracts/',import.meta.url),{recursive:true});
await writeFile(new URL('../contracts/openapi.json',import.meta.url),JSON.stringify(spec,null,2)+'\n');
console.log(`Generated ${Object.keys(paths).length} paths and ${Object.keys(schemas).length} schemas.`);
