import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { database, closeDatabase } from '../src/server/db';
import { createApp } from '../src/server/app';
import { users, authSessions, jobs } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { grantPurchase, lockWallet, reserveCredits } from '../src/server/credits/wallet';
import { generationFingerprint } from '../src/server/credits/quotes';
import { ProviderError } from '../src/server/provider';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { claimJob, processJob, pollJob, releaseForReview, type VideoProvider } from '../src/server/jobs/runner';
import { configureGenerationBudget, confirmGenerationRate, reserveGenerationCost,
  getGenerationBudget, getGenerationCost, observeSupplierPrice, type CostSpec } from '../src/server/costs';
import { readCostAdminInput, runCostAdmin } from '../scripts/generation-cost-admin';

const url=process.env.COST_RUNNER_TEST_DATABASE_URL;
const options={skip:!url,timeout:30_000};
const dbName='kakareel_cost_runner_55445_sandbox',role='kakareel_cost_runner_55445_test';
const originalFetch=global.fetch;
const envKeys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_DAILY_LIMIT'] as const;
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
const origin='https://cost-runner.example.invalid',secret='synthetic-cost-runner-session-key-only';
let client:ReturnType<typeof postgres>;
let owner:string,cookie:string;
const calls:{path:string;method:string}[]=[];
let result:'success'|'failed'|'unknown'='success';
const live:VideoProvider={kind:'live',request:async(path,init)=>{
  calls.push({path,method:init?.method??'GET'});
  if(result==='unknown') throw new Error('synthetic ambiguous transport');
  return {id:'synthetic-task',status:result,...(result==='success'?{data:[{url:'https://synthetic.example.invalid/video.mp4'}]}:{})};
},verifyDelivery:async()=>true};
const fake:VideoProvider={...live,kind:'fake'};
const input=(requestId=randomUUID()):GenerationInput=>({requestId,family:'seedance',mode:'text',prompt:'Synthetic cost integration only',duration:5,resolution:'720p',audio:false,ratio:'16:9'});
const spec:CostSpec={provider:'vibetoken',model:String(providerPayload(input()).model),mode:'text',duration:5,resolution:'720p',audio:false,ratio:'16:9'};
const from=()=>new Date(Date.now()-60_000),until=()=>new Date(Date.now()+3600_000);

before(async()=>{
  if(!url)return;
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55445');
  assert.equal(u.username,role);assert.equal(u.pathname,`/${dbName}`);
  assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
  client=postgres(url,{max:1,onnotice:()=>{}});
  const [identity]=await client`SELECT current_database() AS db,current_user AS role`;
  assert.equal(identity.db,dbName);assert.equal(identity.role,role);
  global.fetch=async()=>{throw new Error('All external fetch forbidden in cost-runner tests');};
  await closeDatabase();
  process.env.DATABASE_URL=url;process.env.APP_URL=origin;process.env.SESSION_SECRET=secret;
  process.env.VIBETOKEN_API_KEY='synthetic-never-used';process.env.DEMO_ACCESS_CODE='synthetic-preview-only';process.env.GENERATION_DAILY_LIMIT='1000';
  // Disposable identity has been checked before DDL; runtime requires the complete schema.
  await client`DROP SCHEMA public CASCADE`;await client`CREATE SCHEMA public`;
  const dir=new URL('../db/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort()) await client.unsafe(await readFile(new URL(f,dir),'utf8'));
});
after(async()=>{
  await closeDatabase();if(client)await client.end();global.fetch=originalFetch;
  for(const k of envKeys) {if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}
});
beforeEach(async()=>{
  if(!url)return;
  await client`TRUNCATE generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates,video_jobs,users CASCADE`;
  await client`UPDATE generation_cost_budget SET enabled=false,cap_minor=0,exposure_minor=0,valid_from=NULL,expires_at=NULL,revision=0`;
  // This suite isolates pre-rollout cost behavior; the 55446 suite proves the new gate.
  await client`UPDATE generation_moderation_rollout SET started_at=clock_timestamp()+interval '1 day'`;
  calls.length=0;result='success';
  owner=randomUUID();const sid=randomUUID();
  await database().insert(users).values({id:owner,googleSub:`synthetic-${owner}`,email:'synthetic@example.invalid',invitedAt:new Date()});
  await database().insert(authSessions).values({id:sid,userId:owner,expiresAt:until()});
  cookie=`kr_access=${await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(owner).setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('10m').sign(new TextEncoder().encode(secret))}`;
});
async function setup(capMinor=1200){
  await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor,validFrom:from(),expiresAt:until(),actor:'synthetic-test',evidenceRef:'synthetic:budget'}));
  return database().transaction(tx=>confirmGenerationRate(tx,{spec,expectedRateId:null,maximumMinor:600,sourceRef:'synthetic:price',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic-test'}));
}
function post(x=input(),provider=live){return createApp({videoProvider:provider}).request(`${origin}/api/jobs`,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(x)});}
async function row(id:string){const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.ok(j);return j;}
async function exposure(){return (await getGenerationBudget(database()))!.exposureMinor;}
async function seed({cost=true,started=false,environment='live' as 'live'|'test'}={}){
  const x=input(),orderId=randomUUID();
  await database().insert(billingOrders).values({id:orderId,userId:owner,requestId:randomUUID(),productId:'credits-starter',productName:'Synthetic',priceVersion:'synthetic',provider:'pancake',environment,
    merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
  await database().transaction(tx=>grantPurchase(tx,{orderId,userId:owner,environment,credits:150,paidAt:new Date()}));
  await database().transaction(async tx=>{
    if(cost)await reserveGenerationCost(tx,{jobId:x.requestId,fingerprint:generationFingerprint(x),spec});
    await lockWallet(tx,owner,environment);
    await tx.insert(jobs).values({id:x.requestId,owner,family:x.family,mode:x.mode,prompt:x.prompt,duration:x.duration,resolution:x.resolution,fingerprint:generationFingerprint(x),payload:providerPayload(x),status:'submitting',billingMode:'paid',creditEnvironment:environment,credits:33,creditState:'reserved',submissionStartedAt:started?new Date():null});
    await reserveCredits(tx,{jobId:x.requestId,userId:owner,environment,credits:33});
  });
  return x.requestId;
}
async function released(id:string){
  assert.equal((await row(id)).creditState,'released');
  const [a]=await client`SELECT state FROM credit_allocations WHERE job_id=${id}::uuid`;assert.equal(a.state,'released');
  const [b]=await client`SELECT sum(reserved)::int AS reserved,sum(consumed)::int AS consumed FROM credit_batches`;assert.deepEqual(b,{reserved:0,consumed:0});
}

test('live preview API fails closed without budget/rate; approved counterexample reaches spy once; fake bypass isolated',options,async()=>{
  const x=input();let r=await post(x);assert.equal(r.status,503);assert.equal((await r.json()).code,'GENERATION_COST_UNAVAILABLE');
  assert.equal(calls.length,0);assert.equal(await exposure(),0);assert.equal((await client`SELECT id FROM video_jobs`).length,0);
  const fakeResult=await post(input(),fake);assert.equal(fakeResult.status,201);assert.equal(calls.length,1);assert.equal(await exposure(),0);
  await setup();r=await post(x);assert.equal(r.status,201,await r.clone().text());
  assert.equal((await row(x.requestId)).status,'success');assert.equal(calls.length,2);
  assert.equal((await getGenerationCost(database(),x.requestId))!.actualMinor,null);
  await client`UPDATE generation_cost_budget SET enabled=false`;
  assert.equal((await post(x)).status,200,'replay remains readable after disable');assert.equal(calls.length,2);
});
test('API exact specification and concurrent global cap; no unpriced sibling reaches network',options,async()=>{
  await setup(600);
  const unpriced=await post({...input(),audio:true});assert.equal(unpriced.status,503);assert.equal(calls.length,0);
  const attempts=await Promise.all(Array.from({length:8},()=>post()));
  assert.equal(attempts.filter(r=>r.status===201).length,1);assert.equal(attempts.filter(r=>r.status===503).length,7);
  assert.equal(calls.length,1);assert.equal(await exposure(),600);
  assert.equal((await client`SELECT id FROM video_jobs`).length,1);
});
test('API job insert failure rolls cost reserve and audit back atomically',options,async()=>{
  await setup();
  await client`CREATE FUNCTION cost_test_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert failure'; END $$`;
  await client`CREATE TRIGGER cost_test_reject_insert BEFORE INSERT ON video_jobs FOR EACH ROW EXECUTE FUNCTION cost_test_reject_insert()`;
  try{assert.equal((await post()).status,503);}finally{await client`DROP TRIGGER cost_test_reject_insert ON video_jobs`;await client`DROP FUNCTION cost_test_reject_insert()`;}
  assert.equal(calls.length,0);assert.equal(await exposure(),0);
  assert.equal((await client`SELECT job_id FROM generation_cost_reservations`).length,0);
  assert.equal((await client`SELECT id FROM generation_cost_audit WHERE action='reserve'`).length,0);
});
test('expired budget before submit releases paid wallet and unsubmitted cost once; force cannot escape hold',options,async()=>{
  await setup();const id=await seed();
  await client`UPDATE generation_cost_budget SET expires_at=clock_timestamp()-interval '1 second'`;
  await Promise.all([processJob(id,live),processJob(id,live)]);
  await pollJob(id,live,true);await processJob(id,live,true);
  await released(id);assert.equal(await exposure(),0);assert.equal(calls.length,0);
  assert.equal((await row(id)).reviewRequired,true);assert.equal((await row(id)).submissionStartedAt,null);
  assert.equal((await client`SELECT id FROM credit_audit WHERE job_id=${id}::uuid AND action='cost-local-rejection'`).length,1);
  assert.equal((await getGenerationCost(database(),id))!.state,'released');
});
test('rate expiry, revision change and observed price halt all release local holds without POST',options,async()=>{
  await setup();
  const expired=await seed();await client`UPDATE generation_cost_rates SET expires_at=clock_timestamp()-interval '1 second'`;
  await processJob(expired,live);await released(expired);
  await client`UPDATE generation_cost_rates SET expires_at=clock_timestamp()+interval '1 hour'`;
  const changed=await seed();const [r]=await client`SELECT rate_id FROM generation_cost_specs`;
  await database().transaction(tx=>confirmGenerationRate(tx,{spec,expectedRateId:String(r.rate_id),maximumMinor:600,sourceRef:'synthetic:new',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'test'}));
  await processJob(changed,live);await released(changed);
  const blocked=await seed();
  await database().transaction(tx=>observeSupplierPrice(tx,{spec,amountMinor:700,observedAt:from(),sourceRef:'synthetic:increase',actor:'test'}));
  await processJob(blocked,live);await released(blocked);
  assert.equal(await exposure(),0);assert.equal(calls.length,0);
});
test('legacy unstarted without snapshot holds and releases; started legacy only queries despite disabled budget',options,async()=>{
  const unstarted=await seed({cost:false});await processJob(unstarted,live);await released(unstarted);
  assert.equal((await row(unstarted)).reviewRequired,true);assert.equal(calls.length,0);
  const started=await seed({cost:false,started:true});await processJob(started,live);
  assert.deepEqual(calls,[{path:`?client_request_id=${started}`,method:'GET'}]);
  assert.equal((await row(started)).creditState,'consumed');assert.equal(await getGenerationCost(database(),started),null);
});
test('committed claim survives lost worker; renewed claim only GET, same budget snapshot and one capture',options,async()=>{
  await setup();const id=await seed();const claims=await Promise.all(Array.from({length:6},()=>claimJob(id,live)));
  assert.equal(claims.filter(c=>c?.submit).length,1);assert.equal(calls.length,0);
  assert.equal((await getGenerationCost(database(),id))!.state,'submitted');
  await closeDatabase(); // New client after a simulated worker loss before any response.
  await client`UPDATE video_jobs SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`;
  await client`UPDATE generation_cost_budget SET enabled=false`;
  await Promise.all([processJob(id,live),processJob(id,live)]);await pollJob(id,live,true);
  assert.deepEqual(calls,[{path:`?client_request_id=${id}`,method:'GET'}]);assert.equal(await exposure(),600);
  assert.equal((await row(id)).creditState,'consumed');
  const cost=await getGenerationCost(database(),id);assert.equal(cost!.outcome,'success');assert.equal(cost!.actualMinor,null);
});
test('unknown/failed retain supplier cost; failed releases user credits, late success never recharges compensated wallet',options,async()=>{
  await setup();const failed=await seed();result='failed';await processJob(failed,live);await released(failed);
  assert.equal((await getGenerationCost(database(),failed))!.outcome,'failed');assert.equal(await exposure(),600);
  const unknown=await seed();result='unknown';await processJob(unknown,live);
  assert.equal((await row(unknown)).creditState,'reserved');assert.equal((await getGenerationCost(database(),unknown))!.outcome,'unknown');
  await client`UPDATE video_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=${unknown}::uuid`;
  await releaseForReview(unknown,'test-operator','Synthetic unknown compensated after 25 hours');
  result='success';await pollJob(unknown,live,true);await released(unknown);
  assert.equal(await exposure(),1200);assert.equal((await getGenerationCost(database(),unknown))!.actualMinor,null);
  assert.equal(calls.filter(c=>c.method==='POST').length,2);
});
test('fake paid test environment works without cost config; live provider cannot submit test balances',options,async()=>{
  const id=await seed({cost:false,environment:'test'});assert.equal(await claimJob(id,live),null);
  assert.equal((await processJob(id,fake))!.status,'success');assert.equal(calls.length,1);assert.equal(await exposure(),0);
});
test('operator CLI validates external private JSON and target; observed price halt commits and rejects stale revision',options,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cost-runner-admin-'));await chmod(dir,0o700);const path=join(dir,'input.json');
  const write=async(x:unknown)=>{await writeFile(path,JSON.stringify(x),{mode:0o600});};
  const target={database:dbName,role};
  try{
    const budget={action:'budget',target,expectedRevision:0,enabled:true,capMinor:1200,validFrom:from().toISOString(),expiresAt:until().toISOString(),actor:'synthetic',evidenceRef:'synthetic:budget'};
    await write({...budget,target:{...target,role:'wrong'}});await assert.rejects(runCostAdmin(path),/DATABASE_TARGET/);assert.equal((await getGenerationBudget(database()))!.revision,0);
    await write(budget);assert.deepEqual(await runCostAdmin(path),{revision:1});await assert.rejects(runCostAdmin(path),/REVISION_CONFLICT/);
    await write({action:'rate',target,spec,expectedRateId:null,maximumMinor:600,sourceRef:'synthetic:price',observedAt:from().toISOString(),validFrom:from().toISOString(),expiresAt:until().toISOString(),actor:'synthetic'});
    assert.ok('rateId' in (await runCostAdmin(path)));
    await write({action:'observe',target,spec,amountMinor:700,observedAt:from().toISOString(),sourceRef:'synthetic:price-change',actor:'synthetic'});
    assert.deepEqual(await runCostAdmin(path),{blocked:true});assert.equal((await post()).status,503);assert.equal(calls.length,0);
    await chmod(path,0o644);await assert.rejects(readCostAdminInput(path),/INPUT_FILE/);await chmod(path,0o600);
    await write({...budget,expiresAt:undefined});await assert.rejects(readCostAdminInput(path));
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('same live request concurrently reaches POST once; committed cost marker never grants a second POST',options,async()=>{
  await setup();const x=input();
  const responses=await Promise.all(Array.from({length:8},()=>post(x)));
  assert.equal(responses.filter(r=>r.status===201).length,1);
  assert.ok(responses.every(r=>[200,201].includes(r.status)));assert.equal(calls.length,1);
  const id=await seed();await claimJob(id,live);
  // Deliberate inconsistent fixture: committed cost marker remains authoritative.
  await client`UPDATE video_jobs SET submission_started_at=NULL,lease_until=NULL,lease_token=NULL,next_poll_at=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`;
  await processJob(id,live);
  assert.deepEqual(calls.at(-1),{path:`?client_request_id=${id}`,method:'GET'});
  assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(await exposure(),1200);
});
test('definitive HTTP rejection releases customer credits but never infers a zero supplier charge',options,async()=>{
  await setup();const id=await seed();
  const rejected:VideoProvider={...live,request:async(path,init)=>{calls.push({path,method:init?.method??'GET'});throw new ProviderError(402);}};
  await processJob(id,rejected);await released(id);
  const cost=await getGenerationCost(database(),id);
  assert.equal(cost!.state,'submitted');assert.equal(cost!.outcome,'failed');assert.equal(cost!.actualMinor,null);
  assert.equal(await exposure(),600);assert.equal(calls.length,1);
});
test('manual compensation of genuinely unstarted job frees both holds, and recovery remains held',options,async()=>{
  await setup();const id=await seed();
  await client`UPDATE video_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=${id}::uuid`;
  await releaseForReview(id,'test-operator','Synthetic unstarted job manually rejected');
  await released(id);assert.equal(await exposure(),0);
  await processJob(id,live,true);await pollJob(id,live,true);assert.equal(calls.length,0);
  assert.equal((await getGenerationCost(database(),id))!.state,'released');
});
