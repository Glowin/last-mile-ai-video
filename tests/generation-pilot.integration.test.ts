import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { AGE_POLICY_VERSION } from '../src/lib/age-declaration';
import { createApp } from '../src/server/app';
import { database, closeDatabase } from '../src/server/db';
import { jobs, users, authSessions } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { walletSummary, grantPurchase } from '../src/server/credits/wallet';
import { generationFingerprint } from '../src/server/credits/quotes';
import { productionChargingPolicy } from '../src/server/credits/config';
import { assertPilotCreation } from '../src/server/credits/pilot';
import { lockWallet } from '../src/server/credits/wallet';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { configureGenerationBudget, confirmGenerationRate, getGenerationCost, getGenerationBudget } from '../src/server/costs';
import { claimJob, processJob, pollJob, releaseForReview, type VideoProvider } from '../src/server/jobs/runner';
import { currentReview, decideReview, reopenOutputReview, type Review, type Decision } from '../src/server/moderation/service';

// Fresh disposable DB ONLY. Never inherits DATABASE_URL or loads configuration files.
const url=process.env.GENERATION_PILOT_TEST_DATABASE_URL;
const opts={skip:!url,timeout:30_000};
const dbName='kakareel_pilot_55449_sandbox',role='kakareel_pilot_55449_test';
const origin='https://pilot.example.invalid', secret='synthetic-pilot-session-secret-for-isolated-tests';
const keys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_LIVE_PILOT_USER_ID','GENERATION_LIVE_PILOT_REQUEST_ID','GENERATION_LIVE_PILOT_EXPIRES_AT'] as const;
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
let pg:ReturnType<typeof postgres>, initialized=false;
type Actor={id:string;cookie:string};
let owner:Actor,stranger:Actor,requestId:string;
let status:'success'|'pending'|'failed'='pending',lost=false,contentAvailable=true;
const calls:{method:string;path:string;body?:string}[]=[];
const contentSha256=createHash('sha256').update('synthetic complete output bytes').digest('hex');
const videoUrl='https://synthetic.example.invalid/full-video.mp4';
const provider:VideoProvider={kind:'live',request:async(path,init)=>{
  const method=init?.method??'GET';calls.push({method,path,...(init?.body?{body:String(init.body)}:{})});
  if(method==='POST'&&lost)throw new Error('Synthetic response lost after acceptance');
  return {id:'synthetic-task',status,...(status==='success'?{data:[{url:videoUrl}]}:{})};
},verifyDelivery:async()=>{throw new Error('Pilot must verify complete content');},verifyContent:async()=>contentAvailable?{contentSha256,bytes:100,mime:'video/mp4'}:null};
const input=(id=requestId):GenerationInput=>({requestId:id,family:'minimax',mode:'image',duration:6,resolution:'2K',ratio:'adaptive',audio:false,prompt:'A synthetic bird',image:'data:image/png;base64,iVBORw0KGgoAAAAA'});
const from=()=>new Date(Date.now()-60_000),until=()=>new Date(Date.now()+3600_000);
function configure(id=requestId){process.env.GENERATION_LIVE_PILOT_USER_ID=owner.id;process.env.GENERATION_LIVE_PILOT_REQUEST_ID=id;process.env.GENERATION_LIVE_PILOT_EXPIRES_AT=until().toISOString();}
async function actor():Promise<Actor>{
 const id=randomUUID(),sid=randomUUID();
 await database().insert(users).values({id,googleSub:id,email:`${id}@example.invalid`,invitedAt:new Date(),ageConfirmedAt:new Date(),agePolicyVersion:AGE_POLICY_VERSION});
 await database().insert(authSessions).values({id:sid,userId:id,expiresAt:until()});
 const token=await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 return {id,cookie:`kr_access=${token}`};
}
function request(path:string,method='GET',body?:unknown,who=owner,headers:Record<string,string>={}){
 // Separate app instances share only DB/config, not in-memory slot state.
 return createApp({videoProvider:provider}).request(`${origin}/api${path}`,{method,headers:{cookie:who.cookie,origin,'content-type':'application/json','X-KakaReel-Owner':who.id,...headers},...(body?{body:JSON.stringify(body)}:{})});
}
async function quote(x=input(),who=owner){const r=await request('/jobs/quote','POST',x,who);assert.equal(r.status,200);return r.json();}
async function create(x=input()) {const q=await quote(x);assert.equal(q.available,true);assert.equal(q.credits,23);const r=await request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await r.json()).job;}
async function job(id=requestId){const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.ok(j);return j;}
async function review(phase:'input'|'output',id=requestId){const r=await database().transaction(tx=>currentReview(tx,id,phase));assert.ok(r);return r;}
function decision(r:Review,value:Decision['decision']='approved'):Decision{return {jobId:r.job_id,phase:r.phase,version:r.version,inputHash:r.input_hash,outputHash:r.output_hash,decision:value,actor:'synthetic-operator',reason:'Inspected this exact synthetic input or complete output',viewedContentSha256:contentSha256};}
async function approveInput(){await decideReview(decision(await review('input')));}
async function balances(available:number,reserved:number,consumed:number){const b=await walletSummary(owner.id);assert.equal(b.availableCredits,available);assert.equal(b.reservedCredits,reserved);const [r]=await pg`SELECT coalesce(sum(consumed),0)::int AS n FROM credit_batches WHERE user_id=${owner.id}::uuid`;assert.equal(r.n,consumed);}
async function auditCount(action:string){const [r]=await pg`SELECT count(*)::int AS n FROM credit_audit WHERE job_id=${requestId}::uuid AND action=${action}`;return r.n;}

before(async()=>{
 if(!url)return;
 const u=new URL(url);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55449');assert.equal(u.pathname,`/${dbName}`);assert.equal(u.username,role);assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
 global.fetch=async()=>{throw new Error('External fetch forbidden in paid pilot tests');};
 pg=postgres(url,{max:12,onnotice:()=>{}});
 const [scope]=await pg`SELECT current_database() AS db,current_user AS role`;assert.equal(scope.db,dbName);assert.equal(scope.role,role);
 const tables=await pg`SELECT tablename FROM pg_tables WHERE schemaname='public'`;assert.equal(tables.length,0,'Use a fresh empty disposable DB; never delete existing test data');
 await closeDatabase();process.env.DATABASE_URL=url;process.env.APP_URL=origin;process.env.SESSION_SECRET=secret;process.env.VIBETOKEN_API_KEY='synthetic-unused';process.env.DEMO_ACCESS_CODE='synthetic-unused';
 initialized=true;
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort())await pg.unsafe(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
});
after(async()=>{
 await closeDatabase();
 if(pg){if(initialized){await pg`DROP SCHEMA public CASCADE`;await pg`CREATE SCHEMA public`;}await pg.end();}
 global.fetch=originalFetch;
 for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
beforeEach(async()=>{
 if(!url)return;
 await pg`TRUNCATE users,video_jobs,generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates CASCADE`;
 await pg`UPDATE generation_cost_budget SET enabled=false,cap_minor=0,exposure_minor=0,valid_from=NULL,expires_at=NULL,revision=0`;
 await pg`UPDATE generation_moderation_rollout SET started_at=clock_timestamp()-interval '2 days'`;
 calls.length=0;lost=false;status='pending';contentAvailable=true;
 owner=await actor();stranger=await actor();requestId=randomUUID();configure();
 for(const who of [owner,stranger]){
  const id=randomUUID();await database().insert(billingOrders).values({id,userId:who.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
  await database().transaction(tx=>grantPurchase(tx,{orderId:id,userId:who.id,environment:'live',credits:150,paidAt:new Date()}));
 }
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:456,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:budget'}));
 await database().transaction(tx=>confirmGenerationRate(tx,{spec:{provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image',duration:6,resolution:'2K',audio:false,ratio:'adaptive'},expectedRateId:null,maximumMinor:456,sourceRef:'synthetic:rate',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic'}));
});

test('only authenticated owner gets pilot metadata; strangers, spoofed owner and wrong specs cannot quote/create',opts,async()=>{
 const mine=await (await request('/billing')).json();assert.equal(mine.generationChargingEnabled,true);assert.equal(mine.generationPilot.requestId,requestId);assert.equal(mine.checkoutEnabled,false);
 const other=await (await request('/billing','GET',undefined,stranger)).json();assert.equal(other.generationChargingEnabled,false);assert.equal(other.generationPilot,null);
 const publicCatalog=await (await request('/billing/catalog','GET',undefined,{id:'',cookie:''})).json();assert.equal(publicCatalog.checkoutEnabled,false);assert.ok(!JSON.stringify(publicCatalog).includes(requestId));
 assert.equal((await request('/billing','GET',undefined,{id:'',cookie:''})).status,401);
 assert.equal((await request('/jobs/quote','POST',input(),stranger,{'X-KakaReel-Owner':owner.id})).status,409);
 assert.equal((await quote(input(),stranger)).available,false);
 assert.equal((await request('/jobs','POST',{...input(),billingMode:'paid',quoteId:randomUUID()},stranger)).status,503);
 for(const change of [{requestId:randomUUID()},{duration:10},{audio:true},{mode:'text',ratio:'16:9',image:undefined}]){
  const x={...input(),...change} as GenerationInput;const q=await quote(x);assert.equal(q.available,false);
  assert.equal((await request('/jobs','POST',{...x,billingMode:'paid',quoteId:randomUUID()})).status,503);
 }
 await balances(150,0,0);assert.equal(calls.length,0);
 const [n]=await pg`SELECT count(*)::int AS n FROM video_jobs`;assert.equal(n.n,0);
});

test('fresh quotes bind image and prompt; concurrent identical creates reserve once, changed config cannot reopen slot',opts,async()=>{
 const x=input(),q=await quote(x),fresh=await quote(x);assert.notEqual(q.quoteId,fresh.quoteId);
 for(const change of [{prompt:'changed'},{image:'data:image/png;base64,iVBORw0KGgoAAAEA'}]){
  const response=await request('/jobs','POST',{...x,...change,billingMode:'paid',quoteId:fresh.quoteId});assert.equal(response.status,409);assert.equal((await response.json()).code,'QUOTE_MISMATCH');
 }
 await balances(150,0,0);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);
 const results=await Promise.all(Array.from({length:6},()=>request('/jobs','POST',{...x,billingMode:'paid',quoteId:fresh.quoteId})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,200,200,200,200,201]);await balances(127,23,0);assert.equal(await auditCount('generation-pilot-created'),1);assert.equal(calls.length,0);
 const summary=await (await request('/billing')).json();assert.equal(summary.generationChargingEnabled,false);assert.equal(summary.generationPilot.jobId,requestId);
 const changed=randomUUID();configure(changed);const denied=await quote(input(changed));assert.equal(denied.reason,'GENERATION_PILOT_JOB_LIMIT');
 const result=await request('/jobs','POST',{...input(changed),billingMode:'paid',quoteId:q.quoteId});assert.equal(result.status,409);assert.equal((await result.json()).code,'GENERATION_PILOT_JOB_LIMIT');
 assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);await balances(127,23,0);
});

test('wallet serialization rechecks changed request config after waiting; rollback leaves slot usable',opts,async()=>{
 let unlocked!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),release=new Promise<void>(r=>{unlocked=r;});
 const holder=database().transaction(async tx=>{await lockWallet(tx,owner.id,'live');entered();await release;});await waiting;
 const x=input();
 const attempt=database().transaction(async tx=>{await lockWallet(tx,owner.id,'live');await assertPilotCreation(tx,owner.id,x,productionChargingPolicy);});
 const expected=assert.rejects(attempt,/GENERATION_CHARGING_DISABLED/);
 configure(randomUUID());unlocked();await holder;await expected;
 configure();await create();await balances(127,23,0);
});

test('quote expiry rolls all holds back; current fresh quote still uses original fixed request',opts,async()=>{
 const q=await quote();await pg`UPDATE video_quotes SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${q.quoteId}::uuid`;
 const r=await request('/jobs','POST',{...input(),billingMode:'paid',quoteId:q.quoteId});assert.equal(r.status,409);assert.equal((await r.json()).code,'QUOTE_EXPIRED');
 await balances(150,0,0);assert.equal(await getGenerationCost(database(),requestId),null);
 await create();assert.equal((await job()).id,requestId);await balances(127,23,0);
});

test('full output must be verified AND approved before capture; concurrent workers and approval capture once',opts,async()=>{
 await create();await balances(127,23,0);await processJob(requestId,provider,true);await pollJob(requestId,provider,true);assert.equal(calls.length,0);
 await approveInput();status='success';contentAvailable=false;await Promise.all(Array.from({length:5},()=>processJob(requestId,provider)));assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal((await job()).creditState,'reserved');assert.equal((await job()).resultUrl,null);assert.equal(await database().transaction(tx=>currentReview(tx,requestId,'output')),undefined);
 contentAvailable=true;await pollJob(requestId,provider,true);const r=await review('output');await balances(127,23,0);assert.equal((await job()).resultUrl,null);
 await assert.rejects(decideReview({...decision(r),viewedContentSha256:'0'.repeat(64)}),/VIEWED_VIDEO_HASH_REQUIRED/);
 await Promise.all(Array.from({length:5},()=>decideReview(decision(r))));await balances(127,0,23);assert.equal(await auditCount('moderation-output-approved'),1);assert.equal((await job()).resultUrl,videoUrl);
 await Promise.all([processJob(requestId,provider,true),pollJob(requestId,provider,true)]);assert.equal(calls.filter(c=>c.method==='POST').length,1);await balances(127,0,23);
});

test('expiry or revocation before first POST releases both holds once, even with force; slot remains consumed',opts,async(t)=>{
 for(const mode of ['expired','removed','changed-request','extended'] as const){
  // Each case has a different owner, retaining all earlier durable jobs.
  if(mode!=='expired'){
   owner=await actor();requestId=randomUUID();configure();const id=randomUUID();
   await database().insert(billingOrders).values({id,userId:owner.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150});
   await database().transaction(tx=>grantPurchase(tx,{orderId:id,userId:owner.id,environment:'live',credits:150,paidAt:new Date()}));
  }
  await create();await approveInput();
  if(mode==='expired'){
   const expiredAt=Date.parse(process.env.GENERATION_LIVE_PILOT_EXPIRES_AT!)+1;
   t.mock.method(Date,'now',()=>expiredAt);
  }
  if(mode==='removed')delete process.env.GENERATION_LIVE_PILOT_USER_ID;
  if(mode==='changed-request')process.env.GENERATION_LIVE_PILOT_REQUEST_ID=randomUUID();
  if(mode==='extended')process.env.GENERATION_LIVE_PILOT_EXPIRES_AT=new Date(Date.now()+7200_000).toISOString();
  await Promise.all([processJob(requestId,provider),processJob(requestId,provider)]);
  await processJob(requestId,provider,true);await pollJob(requestId,provider,true);
  await balances(150,0,0);assert.equal(calls.length,0);assert.equal((await job()).submissionStartedAt,null);assert.equal((await getGenerationCost(database(),requestId))!.state,'released');assert.equal(await auditCount('cost-local-rejection'),1);
  t.mock.restoreAll();
  configure(randomUUID());assert.equal((await quote(input(process.env.GENERATION_LIVE_PILOT_REQUEST_ID))).reason,'GENERATION_PILOT_JOB_LIMIT');
 }
});

test('lost POST and restart after expired/revoked pilot only query original; output still settles exactly once',opts,async()=>{
 await create();await approveInput();lost=true;await processJob(requestId,provider);assert.equal((await job()).status,'unknown');assert.equal((await job()).upstreamId,null);await balances(127,23,0);
 delete process.env.GENERATION_LIVE_PILOT_USER_ID;await closeDatabase();lost=false;status='success';
 await Promise.all([pollJob(requestId,provider,true),pollJob(requestId,provider,true)]);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.filter(c=>c.method==='GET').length,1);assert.equal(calls[1].path,`?client_request_id=${requestId}`);
 const r=await review('output');await balances(127,23,0);await decideReview(decision(r));await balances(127,0,23);
 assert.equal((await getGenerationCost(database(),requestId))!.actualMinor,null);assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);
});

for(const invalidation of ['expiry','revocation'] as const) test(`paused AFTER committed claim: ${invalidation} cancels known-unsent work, zero POST and no reopened trial`,opts,async(t)=>{
 // Keep the trial shorter than the lease so expiry alone is sufficient to block.
 process.env.GENERATION_LIVE_PILOT_EXPIRES_AT=new Date(Date.now()+60_000).toISOString();
 const expiry=Date.parse(process.env.GENERATION_LIVE_PILOT_EXPIRES_AT);
 await create();await approveInput();
 let resume!:()=>void,reached!:()=>void;
 const paused=new Promise<void>(resolve=>{reached=resolve;}),continueClaim=new Promise<void>(resolve=>{resume=resolve;});
 const db=database(),transaction=db.transaction.bind(db);
 // Instrument the real transaction RETURN: its COMMIT has completed, but the
 // actual processJob continuation has not yet received the first-submit claim.
 // database() creates a new Drizzle wrapper per call; intercept its shared
 // prototype, not one instance which processJob would never use.
 const spy=t.mock.method(Object.getPrototypeOf(db) as typeof db,'transaction',(async (fn:Parameters<typeof db.transaction>[0])=>{
  const result=await transaction(fn);
  const claim=result as {submit?:boolean;job?:{id:string}}|null;
  if(claim?.submit && claim.job?.id===requestId){reached();await continueClaim;}
  return result;
 }) as typeof db.transaction);
 const processing=processJob(requestId,provider);
 await Promise.race([paused,processing.then(()=>{throw new Error('Expected first-submit claim to pause before transport');})]);
 try {
  const held=await job();assert.ok(held.submissionStartedAt);assert.ok(held.leaseToken);
  assert.equal((await getGenerationCost(database(),requestId))!.state,'submitted');await balances(127,23,0);
  if(invalidation==='expiry')t.mock.method(Date,'now',()=>expiry+1);
  else delete process.env.GENERATION_LIVE_PILOT_USER_ID;
 } finally {resume();}
 const canceled=await processing;
 spy.mock.restore();t.mock.restoreAll();
 assert.equal(calls.length,0);assert.equal(canceled!.status,'failed');assert.equal(canceled!.submissionStartedAt,null);
 assert.equal(canceled!.leaseToken,null);assert.equal(canceled!.payload,null);assert.equal(canceled!.creditState,'released');
 await balances(150,0,0);
 const cost=(await getGenerationCost(database(),requestId))!;assert.equal(cost.state,'released');assert.equal(cost.outcome,'failed');assert.equal(cost.actualMinor,null);
 assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);
 const [persisted]=await pg`SELECT submitted_at FROM generation_cost_reservations WHERE job_id=${requestId}::uuid`;assert.equal(persisted.submitted_at,null);
 assert.equal(await auditCount('generation-pilot-created'),1);assert.equal(await auditCount('pilot-unsent-cancellation'),1);
 const [audit]=await pg`SELECT count(*)::int AS n FROM generation_cost_audit WHERE job_id=${requestId}::uuid AND action='cancel-unsent-pilot'`;assert.equal(audit.n,1);
 // Restore original authorization: neither force, replay nor a new configured ID
 // may recycle the durable trial or repeat releases.
 process.env.GENERATION_LIVE_PILOT_USER_ID=owner.id;
 await Promise.all([processJob(requestId,provider,true),pollJob(requestId,provider,true)]);
 const replay=await request('/jobs','POST',{...input(),billingMode:'paid',quoteId:randomUUID()});assert.equal(replay.status,200);assert.equal((await replay.json()).job.status,'failed');
 const other=randomUUID();configure(other);assert.equal((await quote(input(other))).reason,'GENERATION_PILOT_JOB_LIMIT');
 assert.equal(calls.length,0);assert.equal(await auditCount('pilot-unsent-cancellation'),1);await balances(150,0,0);
});

test('committed submission permit survives worker loss; expiry cannot convert recovery into a second POST',opts,async()=>{
 await create();await approveInput();const claim=await claimJob(requestId,provider);assert.equal(claim?.submit,true);
 process.env.GENERATION_LIVE_PILOT_EXPIRES_AT=new Date(Date.now()-1).toISOString();await closeDatabase();
 await pg`UPDATE video_jobs SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=${requestId}::uuid`;
 status='success';await Promise.all([processJob(requestId,provider),processJob(requestId,provider)]);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');await balances(127,23,0);await decideReview(decision(await review('output')));await balances(127,0,23);
});

test('input rejection releases both holds once; output rejection keeps supplier exposure and late approval never recharges',opts,async()=>{
 await create();const inputReview=await review('input');await Promise.all([decideReview(decision(inputReview,'rejected')),decideReview(decision(inputReview,'rejected'))]);await balances(150,0,0);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);assert.equal(await auditCount('moderation-input-rejected'),1);
 configure(randomUUID());assert.equal((await quote(input(process.env.GENERATION_LIVE_PILOT_REQUEST_ID))).reason,'GENERATION_PILOT_JOB_LIMIT');
 // The second half uses an independent account, not a reopened pilot slot.
 owner=await actor();requestId=randomUUID();configure();const order=randomUUID();
 await database().insert(billingOrders).values({id:order,userId:owner.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150});
 await database().transaction(tx=>grantPurchase(tx,{orderId:order,userId:owner.id,environment:'live',credits:150,paidAt:new Date()}));
 await create();await approveInput();status='success';await processJob(requestId,provider);const out=await review('output');await Promise.all([decideReview(decision(out,'rejected')),decideReview(decision(out,'rejected'))]);await balances(150,0,0);assert.equal(await auditCount('moderation-output-rejected'),1);assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);
 const reopened=await reopenOutputReview(requestId,'synthetic-operator','Reconsider this exact synthetic output');await decideReview(decision(reopened));await balances(150,0,0);assert.equal((await job()).creditState,'released');
});

test('24h unknown compensation is audited once, preserves supplier exposure and never resubmits',opts,async()=>{
 await create();await approveInput();lost=true;await processJob(requestId,provider);
 await pg`UPDATE video_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=${requestId}::uuid`;
 await Promise.all([releaseForReview(requestId,'synthetic-operator','Unknown task compensated after 24 hours'),releaseForReview(requestId,'synthetic-operator','Unknown task compensated after 24 hours')]);
 await balances(150,0,0);assert.equal(await auditCount('operator-release'),1);assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);
 lost=false;status='success';delete process.env.GENERATION_LIVE_PILOT_USER_ID;await pollJob(requestId,provider,true);await decideReview(decision(await review('output')));await balances(150,0,0);assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('existing preview records remain unchanged; ordinary enabled sandbox paid jobs have no pilot slot limit',opts,async()=>{
 const oldId=randomUUID(),oldInput=input(oldId);
 await database().insert(jobs).values({id:oldId,owner:owner.id,family:'minimax',mode:'image',prompt:oldInput.prompt,duration:6,resolution:'2K',fingerprint:generationFingerprint(oldInput),payload:providerPayload(oldInput),status:'unknown',billingMode:'preview',submissionStartedAt:new Date(),createdAt:new Date(Date.now()-3*86400_000)});
 const before=await job(oldId);await create();assert.deepEqual(await job(oldId),before);
 const sandbox:VideoProvider={kind:'fake',request:async()=>({id:'synthetic-sandbox',status:'pending'}),verifyDelivery:async()=>true};
 const order=randomUUID();await database().insert(billingOrders).values({id:order,userId:owner.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'test',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150});
 await database().transaction(tx=>grantPurchase(tx,{orderId:order,userId:owner.id,environment:'test',credits:150,paidAt:new Date()}));
 const app=createApp({charging:{enabled:true,environment:'test'},videoProvider:sandbox});
 const req=(path:string,body:unknown)=>app.request(`${origin}/api${path}`,{method:'POST',headers:{cookie:owner.cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 for(let i=0;i<2;i++){const x=input(randomUUID()),q=await (await req('/jobs/quote',x)).json();assert.equal(q.available,true);assert.equal((await req('/jobs',{...x,billingMode:'paid',quoteId:q.quoteId})).status,201);}
 assert.equal((await walletSummary(owner.id)).testReservedCredits,46);assert.deepEqual(await job(oldId),before);
});
