import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../src/server/schema';
import {
  configureGenerationBudget, confirmGenerationRate, costSpecKey, getGenerationBudget, getGenerationCost,
  markGenerationSubmission, observeSupplierPrice, recordActualGenerationCost, recordGenerationOutcome,
  releaseUnsubmittedGenerationCost, reserveGenerationCost, type CostSpec,
} from '../src/server/costs';
const url=process.env.GENERATION_COST_TEST_DATABASE_URL;
const options={skip:!url};
let client:ReturnType<typeof postgres>;
let db:ReturnType<typeof drizzle<typeof schema>>;
const spec:CostSpec={provider:'synthetic-provider',model:'synthetic-video-v1',mode:'text',duration:5,resolution:'720p',audio:false,ratio:'16:9'};
const from=()=>new Date(Date.now()-10_000), until=()=>new Date(Date.now()+60_000);
const approval=()=>({spec,expectedRateId:null,maximumMinor:600,sourceRef:'synthetic-only:price-fixture',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'cost-test'});
const request=()=>({jobId:randomUUID(),fingerprint:randomUUID(),spec});
const originalFetch=global.fetch;
before(async()=>{
  if(!url) return;
  // BEFORE connection, then query the real database and role BEFORE any DDL/reset.
  const u=new URL(url);
  assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55441');
  assert.equal(u.pathname,'/kakareel_cost_55441_sandbox');assert.equal(u.username,'kakareel_cost_55441_test');
  assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
  client=postgres(url,{max:12,onnotice:()=>{}});
  const [identity]=await client`SELECT current_database() AS db, current_user AS role`;
  assert.equal(identity.db,'kakareel_cost_55441_sandbox');assert.equal(identity.role,'kakareel_cost_55441_test');
  global.fetch=async()=>{throw new Error('External network forbidden in cost tests');};
  // Only our named tables, after both URL and live identity checks; repeatable on this dedicated DB.
  await client`DROP TABLE IF EXISTS generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates,generation_cost_budget`;
  await client.unsafe(await readFile(new URL('../db/0006-generation-cost-budget.sql',import.meta.url),'utf8'));
  db=drizzle(client,{schema});
});
after(async()=>{global.fetch=originalFetch;if(client) await client.end();});
beforeEach(async()=>{
  if(!url)return;
  await client`TRUNCATE generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates`;
  await client`UPDATE generation_cost_budget SET enabled=false,cap_minor=0,exposure_minor=0,valid_from=NULL,expires_at=NULL,revision=0`;
});
async function setup(capMinor=1200){
  await db.transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor,validFrom:from(),expiresAt:until(),actor:'cost-test',evidenceRef:'synthetic-only:cap'}));
  return db.transaction(tx=>confirmGenerationRate(tx,approval()));
}
async function held(){const x=request();await db.transaction(tx=>reserveGenerationCost(tx,x));return x;}
async function submitted(){const x=await held();await db.transaction(tx=>markGenerationSubmission(tx,x.jobId));return x;}
async function exposure(){return (await getGenerationBudget(db))!.exposureMinor;}
// Observations use the authoritative database clock, avoiding host/container clock skew.
async function observedNow(){const [r]=await client`SELECT clock_timestamp() AS at`;return new Date(r.at);}
test('unconfigured budget fails closed; configured budget without rate still fails closed',options,async()=>{
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/COST_BUDGET_DISABLED/);
  await db.transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:1200,validFrom:from(),expiresAt:until(),actor:'cost-test',evidenceRef:'synthetic-only:cap'}));
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/COST_RATE_UNCONFIRMED/);
  assert.equal(await exposure(),0);
});
test('parallel independent task reservations cannot exceed global CNY budget',options,async()=>{
  await setup(1200);
  const results=await Promise.allSettled(Array.from({length:16},()=>db.transaction(tx=>reserveGenerationCost(tx,request()))));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.ok(results.filter(x=>x.status==='rejected').every(x=>String(x.reason).includes('COST_BUDGET_EXHAUSTED')));
  assert.equal(await exposure(),1200);
  const [r]=await client`SELECT count(*) AS count,sum(exposure_minor) AS total FROM generation_cost_reservations`;
  assert.equal(Number(r.count),2);assert.equal(Number(r.total),1200);
});
test('same job concurrent reservation only charges once; fingerprint and exact spec bound',options,async()=>{
  await setup();const x=request();
  const all=await Promise.all(Array.from({length:8},()=>db.transaction(tx=>reserveGenerationCost(tx,x))));
  assert.ok(all.every(r=>r.jobId===x.jobId));assert.equal(await exposure(),600);
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,{...x,fingerprint:'different'})),/MISMATCH/);
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,{...x,spec:{...spec,audio:true}})),/MISMATCH/);
  assert.equal((all[0].snapshot as {currency:string}).currency,'CNY');
  assert.equal((all[0].snapshot as {maximumMinor:number}).maximumMinor,600);
});
test('transaction rollback rolls back reservation and global exposure together',options,async()=>{
  await setup();const x=request();
  await assert.rejects(db.transaction(async tx=>{await reserveGenerationCost(tx,x);throw new Error('synthetic job insert failure');}),/synthetic job/);
  assert.equal(await exposure(),0);assert.equal(await getGenerationCost(db,x.jobId),null);
});
test('only one parallel submission is authorized; crash/restart retry cannot re-POST',options,async()=>{
  await setup();const x=await held();
  const all=await Promise.all(Array.from({length:8},()=>db.transaction(tx=>markGenerationSubmission(tx,x.jobId))));
  assert.equal(all.filter(r=>r.maySubmit).length,1);
  // A new client simulates a restarted worker: the decision is persistent, not in memory.
  const second=postgres(url!,{max:1});
  try {const restarted=drizzle(second,{schema});assert.equal((await restarted.transaction(tx=>markGenerationSubmission(tx,x.jobId))).maySubmit,false);}
  finally {await second.end();}
  await assert.rejects(db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'worker',evidenceRef:'network-timeout'})),/MAY_HAVE_BEEN_CHARGED/);
  assert.equal(await exposure(),600);
});
test('unknown, failure and successful delivery retain exposure, actual cost remains unknown',options,async()=>{
  await setup(1800);
  for (const outcome of ['unknown','failed','success'] as const) {
    const x=await submitted();
    const r=await db.transaction(tx=>recordGenerationOutcome(tx,{jobId:x.jobId,outcome,evidenceRef:'synthetic-only:task-status'}));
    assert.equal(r.actualMinor,null);assert.equal(r.exposureMinor,600);
    await assert.rejects(db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'worker',evidenceRef:'customer-refund'})),/MAY_HAVE_BEEN_CHARGED/);
  }
  assert.equal(await exposure(),1800);
});
test('local pre-submit rejection releases exactly once and cannot later be submitted',options,async()=>{
  await setup();const x=await held();
  await Promise.all(Array.from({length:6},()=>db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'input-review',evidenceRef:'synthetic-only:local-rejection'}))));
  assert.equal(await exposure(),0);
  assert.equal((await db.transaction(tx=>reserveGenerationCost(tx,x))).state,'released');
  await assert.rejects(db.transaction(tx=>markGenerationSubmission(tx,x.jobId)),/RELEASED/);
});
test('release versus submit race never both authorizes POST and frees exposure',options,async()=>{
  await setup();const x=await held();
  const results=await Promise.allSettled([
    db.transaction(tx=>markGenerationSubmission(tx,x.jobId)),
    db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'worker',evidenceRef:'synthetic-only:reject'})),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const r=await getGenerationCost(db,x.jobId);
  assert.equal(await exposure(),r!.state==='submitted'?600:0);
});
test('supplier increase blocks fresh AND held tasks; existing submission can still be queried',options,async()=>{
  await setup();const existing=await submitted(),pending=await held();
  const observedAt=await observedNow();
  const observed=await db.transaction(tx=>observeSupplierPrice(tx,{spec,amountMinor:750,observedAt,sourceRef:'synthetic-only:run-button',actor:'operator'}));
  assert.equal(observed.blocked,true);
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/RATE_BLOCKED/);
  await assert.rejects(db.transaction(tx=>markGenerationSubmission(tx,pending.jobId)),/RATE_BLOCKED/);
  assert.equal((await db.transaction(tx=>markGenerationSubmission(tx,existing.jobId))).maySubmit,false);
  assert.equal((await getGenerationCost(db,existing.jobId))!.state,'submitted');
  await db.transaction(tx=>recordGenerationOutcome(tx,{jobId:existing.jobId,outcome:'failed',evidenceRef:'synthetic-only:status'}));
  assert.equal(await exposure(),1200);
});
test('rate expiry blocks submit, budget expiry blocks new reserve; read and settlement still work',options,async()=>{
  await setup();const existing=await submitted(),pending=await held();
  await client`UPDATE generation_cost_rates SET expires_at=clock_timestamp()-interval '1 second',valid_from=clock_timestamp()-interval '20 seconds'`;
  await assert.rejects(db.transaction(tx=>markGenerationSubmission(tx,pending.jobId)),/RATE_EXPIRED/);
  await client`UPDATE generation_cost_budget SET expires_at=clock_timestamp()-interval '1 second',valid_from=clock_timestamp()-interval '20 seconds'`;
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/BUDGET_EXPIRED/);
  assert.equal((await db.transaction(tx=>reserveGenerationCost(tx,existing))).jobId,existing.jobId);
  assert.ok(await getGenerationCost(db,existing.jobId));
  await db.transaction(tx=>recordActualGenerationCost(tx,{jobId:existing.jobId,amountMinor:0,evidenceRef:'synthetic-only:verified-zero',actor:'operator'}));
  assert.equal(await exposure(),1200);
});
test('actual charge over estimate records money, raises exposure above cap and disables specification',options,async()=>{
  await setup(600);const x=await submitted();
  const input={jobId:x.jobId,amountMinor:800,evidenceRef:'synthetic-only:final-invoice',actor:'operator'};
  assert.deepEqual(await db.transaction(tx=>recordActualGenerationCost(tx,input)),{duplicate:false,priceIncreased:true});
  assert.deepEqual(await db.transaction(tx=>recordActualGenerationCost(tx,input)),{duplicate:true,priceIncreased:true});
  assert.equal(await exposure(),800);
  assert.equal((await getGenerationCost(db,x.jobId))!.actualMinor,800);
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/RATE_BLOCKED/);
  await assert.rejects(db.transaction(tx=>recordActualGenerationCost(tx,{...input,amountMinor:100})),/ACTUAL_COST_CONFLICT/);
  assert.equal(await exposure(),800);
});
test('lower actual charge never silently refunds the budget; repeated final evidence idempotent',options,async()=>{
  await setup();const x=await submitted();const input={jobId:x.jobId,amountMinor:400,evidenceRef:'synthetic-only:bill',actor:'operator'};
  await db.transaction(tx=>recordActualGenerationCost(tx,input));await db.transaction(tx=>recordActualGenerationCost(tx,input));
  assert.equal(await exposure(),600);assert.equal((await getGenerationCost(db,x.jobId))!.actualMinor,400);
});
test('budget reconfiguration uses revision, does not reset exposure; disabled recovery remains readable',options,async()=>{
  await setup();const x=await submitted();const config={expectedRevision:1,enabled:false,capMinor:100,validFrom:from(),expiresAt:until(),actor:'operator',evidenceRef:'synthetic-only:pause'};
  await db.transaction(tx=>configureGenerationBudget(tx,config));
  await assert.rejects(db.transaction(tx=>configureGenerationBudget(tx,config)),/REVISION_CONFLICT/);
  assert.equal(await exposure(),600);assert.ok(await getGenerationCost(db,x.jobId));
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/BUDGET_DISABLED/);
  await db.transaction(tx=>recordGenerationOutcome(tx,{jobId:x.jobId,outcome:'success',evidenceRef:'synthetic-only:delivery'}));
});
test('manual new rate uses compare-and-set, cannot clear price halt using stale/lower evidence',options,async()=>{
  const approved=await setup();const x=await held();const now=await observedNow();
  await db.transaction(tx=>observeSupplierPrice(tx,{spec,amountMinor:750,observedAt:now,sourceRef:'synthetic-only:increase',actor:'operator'}));
  await assert.rejects(db.transaction(tx=>confirmGenerationRate(tx,{...approval(),expectedRateId:approved.rateId})),/STALE_PRICE/);
  const next=await db.transaction(tx=>confirmGenerationRate(tx,{...approval(),maximumMinor:750,expectedRateId:approved.rateId,observedAt:now,validFrom:now}));
  await assert.rejects(db.transaction(tx=>markGenerationSubmission(tx,x.jobId)),/RATE_CHANGED/);
  await assert.rejects(db.transaction(tx=>confirmGenerationRate(tx,{...approval(),expectedRateId:approved.rateId})),/REVISION_CONFLICT/);
  assert.notEqual(next.rateId,approved.rateId);
  await db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'operator',evidenceRef:'synthetic-only:requote'}));
  assert.equal((await held()).spec.model,spec.model);
});
test('reject fractions, negatives, unsafe integers and missing cost dimensions',options,async()=>{
  for (const value of [-1,0.2,Number.MAX_SAFE_INTEGER+1,NaN]) {
    await assert.rejects(db.transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:value,validFrom:from(),expiresAt:until(),actor:'operator',evidenceRef:'synthetic-only:bad'})),/INVALID_CNY/);
  }
  assert.throws(()=>costSpecKey({...spec,extra:'unpriced'} as CostSpec),/INVALID_COST_SPEC/);
  assert.notEqual(costSpecKey(spec),costSpecKey({...spec,mode:'image'}));
  assert.notEqual(costSpecKey(spec),costSpecKey({...spec,audio:true}));
});
test('unknown to late success is allowed without new reservation or cost reset',options,async()=>{
  await setup();const x=await submitted();
  await db.transaction(tx=>recordGenerationOutcome(tx,{jobId:x.jobId,outcome:'unknown',evidenceRef:'synthetic-only:timeout'}));
  await db.transaction(tx=>recordGenerationOutcome(tx,{jobId:x.jobId,outcome:'success',evidenceRef:'synthetic-only:late-success'}));
  assert.equal(await exposure(),600);
  await assert.rejects(db.transaction(tx=>recordGenerationOutcome(tx,{jobId:x.jobId,outcome:'failed',evidenceRef:'synthetic-only:conflict'})),/OUTCOME_CONFLICT/);
  assert.equal((await db.transaction(tx=>markGenerationSubmission(tx,x.jobId))).maySubmit,false);
});
test('budget expiry while waiting for lock must be checked after lock acquisition',options,async()=>{
  await setup();
  let ready!:()=>void;const locked=new Promise<void>(resolve=>{ready=resolve;});
  const blocker=db.transaction(async tx=>{
    await tx.execute(sql`SELECT id FROM generation_cost_budget WHERE id=true FOR UPDATE`);
    await tx.execute(sql`UPDATE generation_cost_budget SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE id=true`);
    ready();
    await tx.execute(sql`SELECT pg_sleep(0.15)`);
  });
  await locked;
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/BUDGET_EXPIRED/);
  await blocker;assert.equal(await exposure(),0);
});
test('lowered cap blocks held tasks without losing original exposure',options,async()=>{
  await setup();const x=await held();
  await db.transaction(tx=>configureGenerationBudget(tx,{expectedRevision:1,enabled:true,capMinor:100,validFrom:from(),expiresAt:until(),actor:'operator',evidenceRef:'synthetic-only:lower-cap'}));
  await assert.rejects(db.transaction(tx=>markGenerationSubmission(tx,x.jobId)),/BUDGET_EXHAUSTED/);
  assert.equal(await exposure(),600);
  await db.transaction(tx=>releaseUnsubmittedGenerationCost(tx,{jobId:x.jobId,actor:'operator',evidenceRef:'synthetic-only:local-reject'}));
  assert.equal(await exposure(),0);
});
test('lower observed price does not auto-enable blocked specification',options,async()=>{
  await setup();
  await db.transaction(tx=>observeSupplierPrice(tx,{spec,amountMinor:800,observedAt:from(),sourceRef:'synthetic-only:rise',actor:'operator'}));
  const observedAt=await observedNow();
  const r=await db.transaction(tx=>observeSupplierPrice(tx,{spec,amountMinor:500,observedAt,sourceRef:'synthetic-only:fall',actor:'operator'}));
  assert.equal(r.blocked,true);
  await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,request())),/RATE_BLOCKED/);
});
test('unconfirmed sibling specification is never priced by fallback',options,async()=>{
  await setup();
  for(const changed of [{audio:true},{ratio:'9:16'},{mode:'image' as const},{resolution:'1080p'},{duration:10},{model:'synthetic-v2'}]) {
    await assert.rejects(db.transaction(tx=>reserveGenerationCost(tx,{...request(),spec:{...spec,...changed}})),/RATE_UNCONFIRMED/);
  }
  assert.equal(await exposure(),0);
});
