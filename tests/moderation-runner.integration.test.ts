const AGE_POLICY_VERSION = "18-plus-2026-10-26"; // Historical migration fixture only.
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { database, closeDatabase } from '../src/server/db';
import { jobs, users, authSessions } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { createApp } from '../src/server/app';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { generationFingerprint } from '../src/server/credits/quotes';
import { grantPurchase, lockWallet, reserveCredits } from '../src/server/credits/wallet';
import { configureGenerationBudget, confirmGenerationRate, reserveGenerationCost, getGenerationCost, getGenerationBudget, type CostSpec } from '../src/server/costs';
import { claimJob, processJob, pollJob, workerTick, type VideoProvider } from '../src/server/jobs/runner';
import { currentReview, decideReview, type Review, type Decision } from '../src/server/moderation/service';
import { openCase } from '../src/server/moderation/cases';

const url=process.env.MODERATION_RUNNER_TEST_DATABASE_URL;
const opts={skip:!url,timeout:30_000};
const dbName='kakareel_moderation_runner_55446_sandbox',role='kakareel_moderation_runner_55446_test';
const originalFetch=global.fetch;
const keys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_DAILY_LIMIT'] as const;
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const origin='https://moderation-runner.example.invalid',secret='synthetic-moderation-runner-session-key';
const videoUrl='https://synthetic.example.invalid/private-candidate.mp4';
const bytes=Buffer.from('synthetic full video byte fixture, never an actual external video');
const contentSha256=createHash('sha256').update(bytes).digest('hex');
const content={contentSha256,bytes:bytes.length,mime:'video/mp4' as const};
let pg:ReturnType<typeof postgres>,owner:string,cookie:string;
let status:'success'|'pending'|'failed'='success',contentAvailable=true,headerChecks=0,contentChecks=0;
const calls:{method:string;path:string}[]=[];
const live:VideoProvider={kind:'live',request:async(path,init)=>{
 calls.push({method:init?.method??'GET',path});
 return {id:'synthetic-upstream',status,...(status==='success'?{data:[{url:videoUrl}]}:{})};
},verifyDelivery:async()=>{headerChecks++;return true;},verifyContent:async(value)=>{
 assert.equal(value,videoUrl);contentChecks++;return contentAvailable?content:null;
}};
const input=(id=randomUUID()):GenerationInput=>({requestId:id,family:'seedance',mode:'text',prompt:'Synthetic landscape for moderation integration',duration:5,resolution:'720p',audio:false,ratio:'16:9'});
const spec:CostSpec={provider:'vibetoken',model:String(providerPayload(input()).model),mode:'text',duration:5,resolution:'720p',audio:false,ratio:'16:9'};
const from=()=>new Date(Date.now()-60_000),until=()=>new Date(Date.now()+3600_000);
before(async()=>{
 if(!url)return;
 const u=new URL(url);
 assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55446');
 assert.equal(u.pathname,`/${dbName}`);assert.equal(u.username,role);assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
 pg=postgres(url,{max:10,onnotice:()=>{}});
 const [identity]=await pg`SELECT current_database() AS db,current_user AS role`;
 assert.equal(identity.db,dbName);assert.equal(identity.role,role);
 // Strict URL AND actual role/db checks precede all destructive fixture setup.
 await closeDatabase();process.env.DATABASE_URL=url;process.env.APP_URL=origin;process.env.SESSION_SECRET=secret;
 process.env.VIBETOKEN_API_KEY='synthetic-unused';process.env.DEMO_ACCESS_CODE='synthetic-unused';process.env.GENERATION_DAILY_LIMIT='1000';
 global.fetch=async()=>{throw new Error('External fetch forbidden in moderation-runner suite');};
 await pg`DROP SCHEMA public CASCADE`;await pg`CREATE SCHEMA public`;
 for(const f of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort()) await pg.unsafe(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));
});
after(async()=>{await closeDatabase();if(pg)await pg.end();global.fetch=originalFetch;for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
beforeEach(async()=>{
 if(!url)return;
 await pg`TRUNCATE users,video_jobs,generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates CASCADE`;
 await pg`UPDATE generation_cost_budget SET enabled=false,cap_minor=0,exposure_minor=0,valid_from=NULL,expires_at=NULL,revision=0`;
 // Explicitly new relative to rollout, including aged fixtures. No environment bypass.
 await pg`UPDATE generation_moderation_rollout SET started_at=clock_timestamp()-interval '2 days'`;
 calls.length=0;status='success';contentAvailable=true;contentChecks=0;headerChecks=0;
 owner=randomUUID();const sid=randomUUID();
 await database().insert(users).values({id:owner,googleSub:owner,email:'synthetic@example.invalid',invitedAt:new Date(),ageConfirmedAt:new Date(),agePolicyVersion:AGE_POLICY_VERSION});
 await database().insert(authSessions).values({id:sid,userId:owner,expiresAt:until()});
 cookie=`kr_access=${await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(owner).setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('10m').sign(new TextEncoder().encode(secret))}`;
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:6000,validFrom:from(),expiresAt:until(),actor:'synthetic-test',evidenceRef:'synthetic:budget'}));
 await database().transaction(tx=>confirmGenerationRate(tx,{spec,expectedRateId:null,maximumMinor:600,sourceRef:'synthetic:price',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic-test'}));
});
async function seed({old=false,started=false,cost=true}={}){
 const x=input(),order=randomUUID();
 await database().insert(billingOrders).values({id:order,userId:owner,requestId:randomUUID(),productId:'synthetic',productName:'Synthetic',priceVersion:'test',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
 await database().transaction(tx=>grantPurchase(tx,{orderId:order,userId:owner,environment:'live',credits:150,paidAt:new Date()}));
 await database().transaction(async tx=>{
  if(cost)await reserveGenerationCost(tx,{jobId:x.requestId,fingerprint:generationFingerprint(x),spec});
  await lockWallet(tx,owner,'live');
  await tx.insert(jobs).values({id:x.requestId,owner,family:x.family,mode:x.mode,prompt:x.prompt,duration:x.duration,resolution:x.resolution,fingerprint:generationFingerprint(x),payload:providerPayload(x),status:'submitting',billingMode:'paid',creditEnvironment:'live',credits:33,creditState:'reserved',submissionStartedAt:started?new Date():null,createdAt:old?new Date(Date.now()-3*86400_000):new Date()});
  await reserveCredits(tx,{jobId:x.requestId,userId:owner,environment:'live',credits:33});
 });return x.requestId;
}
async function row(id:string){const r=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.ok(r);return r;}
async function review(id:string,phase:'input'|'output'){const r=await database().transaction(tx=>currentReview(tx,id,phase));assert.ok(r,`${phase} review exists`);return r;}
function decision(r:Review,which:Decision['decision']='approved'):Decision{return {jobId:r.job_id,phase:r.phase,version:r.version,inputHash:r.input_hash,outputHash:r.output_hash,decision:which,actor:'synthetic-reviewer',reason:'Inspected the exact synthetic input or video bytes',viewedContentSha256:contentSha256};}
async function approveInput(id:string){await processJob(id,live);await decideReview(decision(await review(id,'input')));}
async function amounts(id:string){const [r]=await pg`SELECT b.reserved,b.consumed,a.state FROM credit_batches b JOIN credit_allocations a ON a.order_id=b.order_id WHERE a.job_id=${id}::uuid`;return r;}
function request(path:string,method='GET',body?:unknown){return createApp({videoProvider:live}).request(`${origin}/api${path}`,{method,headers:{cookie,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function exposed(id:string){const r=await request(`/jobs/${id}`);assert.equal(r.status,200);return (await r.json()).job;}

test('new live paid job holds input before cost submission; force/recovery/worker cannot bypass; API is minimal',opts,async()=>{
 const id=await seed();await Promise.all([processJob(id,live),processJob(id,live)]);
 await processJob(id,live,true);await pollJob(id,live,true);await workerTick(live);
 const j=await row(id);assert.equal(j.reviewRequired,true);assert.equal(j.submissionStartedAt,null);assert.equal(calls.length,0);
 assert.equal((await getGenerationCost(database(),id))!.state,'held');assert.deepEqual(await amounts(id),{reserved:33,consumed:0,state:'reserved'});
 const publicJob=await exposed(id);assert.deepEqual(publicJob.moderation,[{phase:'input',state:'pending',version:1}]);
 assert.equal(publicJob.resultUrl,null);assert.ok(!JSON.stringify(publicJob).includes('snapshot'));assert.ok(!JSON.stringify(publicJob).includes('binding_hash'));
 const recovered=await request(`/jobs/${id}/recover`,'POST');assert.equal(recovered.status,200);assert.equal(calls.length,0);
});
test('input approval permits exactly one POST; full hash output holds private until concurrent approval captures once',opts,async()=>{
 const id=await seed();await approveInput(id);
 await Promise.all(Array.from({length:6},()=>processJob(id,live)));
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(contentChecks,1);assert.equal(headerChecks,0);
 const r=await review(id,'output');assert.equal(r.snapshot.contentSha256,contentSha256);
 assert.equal((await row(id)).status,'unknown');assert.equal((await row(id)).resultUrl,null);assert.equal((await row(id)).creditState,'reserved');
 assert.equal((await getGenerationCost(database(),id))!.outcome,'success');
 await processJob(id,live,true);await pollJob(id,live,true);assert.equal(calls.length,1);
 const held=await exposed(id);assert.equal(held.resultUrl,null);assert.ok(!JSON.stringify(held).includes(videoUrl));
 assert.deepEqual(held.moderation,[{phase:'input',state:'approved',version:1},{phase:'output',state:'pending',version:1}]);
 await assert.rejects(decideReview({...decision(r),viewedContentSha256:'0'.repeat(64)}),/VIEWED_VIDEO_HASH_REQUIRED/);
 await Promise.all(Array.from({length:6},()=>decideReview(decision(r))));
 assert.deepEqual(await amounts(id),{reserved:0,consumed:33,state:'consumed'});assert.equal((await row(id)).status,'success');assert.equal((await exposed(id)).resultUrl,videoUrl);
 const [audit]=await pg`SELECT count(*)::int AS n FROM credit_audit WHERE job_id=${id}::uuid AND action='moderation-output-approved'`;assert.equal(audit.n,1);
});
test('input rejection releases both monetary and credit holds once and remains blocked even with force',opts,async()=>{
 const id=await seed();await processJob(id,live);const r=await review(id,'input');
 await Promise.all([decideReview(decision(r,'rejected')),decideReview(decision(r,'rejected'))]);
 await processJob(id,live,true);await pollJob(id,live,true);assert.equal(calls.length,0);
 assert.equal((await getGenerationCost(database(),id))!.state,'released');assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);
 assert.deepEqual(await amounts(id),{reserved:0,consumed:0,state:'released'});assert.equal((await row(id)).status,'unknown');
});
test('output rejection releases customer credits but keeps potentially billed supplier cost',opts,async()=>{
 const id=await seed();await approveInput(id);await processJob(id,live);await decideReview(decision(await review(id,'output'),'rejected'));
 await processJob(id,live,true);await pollJob(id,live,true);assert.equal(calls.length,1);
 assert.deepEqual(await amounts(id),{reserved:0,consumed:0,state:'released'});assert.equal((await getGenerationBudget(database()))!.exposureMinor,600);
 assert.equal((await getGenerationCost(database(),id))!.state,'submitted');assert.equal((await row(id)).resultUrl,null);assert.equal((await row(id)).status,'unknown');
});
test('missing complete content evidence cannot stage output, expose URL or capture credits',opts,async()=>{
 const id=await seed();await approveInput(id);contentAvailable=false;await processJob(id,live);
 assert.equal((await row(id)).creditState,'reserved');assert.equal((await row(id)).resultUrl,null);assert.equal((await row(id)).status,'unknown');
 assert.equal(await database().transaction(tx=>currentReview(tx,id,'output')),undefined);assert.equal(headerChecks,0);
 contentAvailable=true;await pollJob(id,live,true);assert.equal((await review(id,'output')).state,'pending');
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.filter(c=>c.method==='GET').length,1);
});
test('new live API request and idempotent replay remain held, cannot leak private review payload',opts,async()=>{
 const x=input();const rs=await Promise.all([request('/jobs','POST',x),request('/jobs','POST',x)]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,201]);
 assert.equal(calls.length,0);const publicJob=await exposed(x.requestId);assert.equal(publicJob.moderation[0].state,'pending');
 assert.ok(!('payload' in publicJob));assert.ok(!('snapshot' in publicJob));assert.equal((await getGenerationBudget(database()))!.exposureMinor,600);
});
test('pre-rollout started legacy jobs use previous delivery verification with no fabricated review or cost',opts,async()=>{
 const id=await seed({old:true,started:true,cost:false});await processJob(id,live);
 assert.deepEqual(calls,[{method:'GET',path:`?client_request_id=${id}`}]);assert.equal(headerChecks,1);assert.equal(contentChecks,0);
 assert.equal((await row(id)).status,'success');assert.equal((await row(id)).creditState,'consumed');assert.equal(await getGenerationCost(database(),id),null);
 assert.deepEqual((await exposed(id)).moderation,[]);
});
test('content cases block new and legacy tasks even under force; no submission or delivery bypass',opts,async()=>{
 for(const old of [false,true]){
  const id=await seed({old,started:old,cost:!old});
  await openCase({jobId:id,sourceReference:'synthetic:'+id,category:'rights',summary:'Synthetic rights complaint under review',actor:'synthetic-reviewer'});
  await processJob(id,live,true);await pollJob(id,live,true);assert.equal((await row(id)).reviewRequired,true);assert.equal((await row(id)).resultUrl,null);
 }assert.equal(calls.length,0);
});
test('committed submission claim lost with worker only recovers via GET and still requires output approval',opts,async()=>{
 const id=await seed();await approveInput(id);const claim=await claimJob(id,live);assert.equal(claim?.submit,true);
 await closeDatabase();await pg`UPDATE video_jobs SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`;
 await Promise.all([processJob(id,live),processJob(id,live)]);
 assert.deepEqual(calls,[{method:'GET',path:`?client_request_id=${id}`}]);assert.equal((await review(id,'output')).state,'pending');assert.equal((await row(id)).creditState,'reserved');
 await decideReview(decision(await review(id,'output')));assert.equal((await row(id)).creditState,'consumed');
});
test('expired input review explicitly releases both holds and cannot restart',opts,async()=>{
 const id=await seed();await processJob(id,live);const r=await review(id,'input');
 await pg`UPDATE generation_moderation SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=${id}::uuid`;
 await assert.rejects(decideReview(decision(r)),/REVIEW_EXPIRED/);await decideReview(decision(r,'expired'));
 await processJob(id,live,true);assert.equal(calls.length,0);assert.equal((await getGenerationCost(database(),id))!.state,'released');assert.equal((await row(id)).creditState,'released');
});
