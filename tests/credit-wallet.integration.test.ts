import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { database, closeDatabase } from '../src/server/db';
import { users, jobs, authSessions } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { grantPurchase, applyFullRefund, lockWallet, walletSummary, freezeRefund, unfreezeRefund, reserveCredits, settleCredits, blockWalletForReview, resolveWalletReview } from '../src/server/credits/wallet';
import { createApp } from '../src/server/app';
import { claimJob, finishClaim, processJob, releaseForReview, workerTick, type VideoProvider } from '../src/server/jobs/runner';
import type { CreditEnvironment } from '../src/server/credits/config';
const creditTestDatabaseUrl=process.env.CREDIT_TEST_DATABASE_URL;
const originalDatabaseUrl=process.env.DATABASE_URL;
const integration=!!creditTestDatabaseUrl;
const originalFetch=global.fetch;
const fake:VideoProvider={kind:'fake',request:async()=>({id:'fake-task',status:'pending'}),verifyDelivery:async()=>true};
before(()=>{
  if(!integration) return;
  const u=new URL(creditTestDatabaseUrl!);
  assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55439');assert.equal(u.pathname,'/video_credit_qa');
  process.env.DATABASE_URL=creditTestDatabaseUrl;
  global.fetch=async()=>{throw new Error('Real network prohibited in credit tests');};
  process.env.APP_URL='https://credit-test.example';
  process.env.SESSION_SECRET='fictional-test-only-session-secret-for-credit-qa';
});
after(async()=>{
  global.fetch=originalFetch;
  await closeDatabase();
  if(originalDatabaseUrl===undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL=originalDatabaseUrl;
});
async function user() {
 const id=randomUUID();await database().insert(users).values({id,googleSub:`qa-${id}`,email:`${id}@example.test`});return id;
}
async function purchase(userId:string,credits=150,environment:CreditEnvironment='test',paidAt=new Date(),grant=true) {
  const orderId=randomUUID();
  await database().insert(billingOrders).values({id:orderId,userId,requestId:randomUUID(),productId:'credits-starter',productName:'QA',priceVersion:'qa',provider:'pancake',environment,merchantAccountId:'qa-only',providerProductId:'qa-only',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits,status:'paid'});
  const p={orderId,userId,environment,credits,paidAt};
  if(grant) await database().transaction(tx=>grantPurchase(tx,p));return p;
}
async function job(userId:string,credits:number,environment:CreditEnvironment='test') {
  const id=randomUUID();
  await database().transaction(async tx=>{
    await lockWallet(tx,userId,environment);
    await tx.insert(jobs).values({id,owner:userId,family:'seedance',mode:'text',prompt:'test leaf',duration:5,resolution:'720p',fingerprint:'qa',payload:{model:'qa-fake',prompt:'qa'},status:'submitting',billingMode:'paid',creditEnvironment:environment,credits,creditState:'reserved'});
    await reserveCredits(tx,{jobId:id,userId,environment,credits});
  });return id;
}
async function settle(id:string,userId:string,state:'consumed'|'released') {
 await database().transaction(async tx=>{await lockWallet(tx,userId,'test');await settleCredits(tx,id,state);await tx.update(jobs).set({creditState:state}).where(eq(jobs.id,id));});
}
const opts={skip:!integration};
test('concurrent reservations cannot overspend and failed transaction leaves no job',opts,async()=>{
  const u=await user();await purchase(u,150);
  const r=await Promise.allSettled([job(u,100),job(u,100)]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  assert.deepEqual(await walletSummary(u),{availableCredits:0,reservedCredits:0,testAvailableCredits:50,testReservedCredits:100,blocked:false,testBlocked:false});
  const rows=await database().select().from(jobs).where(eq(jobs.owner,u));assert.equal(rows.length,1);
});
test('FIFO allocations span batches; grant is idempotent; environments stay separate',opts,async()=>{
  const u=await user(),a=await purchase(u,30,'test',new Date(Date.now()-10_000)),b=await purchase(u,150);
  await purchase(u,150,'live');await database().transaction(tx=>grantPurchase(tx,b));
  const id=await job(u,33);
  const rows=await database().execute(sql`SELECT * FROM credit_allocations WHERE job_id=${id}::uuid`);
  assert.equal(rows.find(x=>x.order_id===a.orderId)?.credits,30);
  assert.equal(rows.find(x=>x.order_id===b.orderId)?.credits,3);
  assert.equal((await walletSummary(u)).availableCredits,150);
  await settle(id,u,'released');await settle(id,u,'released');assert.equal((await walletSummary(u)).testAvailableCredits,180);
});
test('refund freezing validates time and usage, refund/late purchase are idempotent',opts,async()=>{
  const u=await user(),p=await purchase(u);
  assert.deepEqual(await database().transaction(tx=>freezeRefund(tx,{...p,now:new Date()})),{ok:true});
  await assert.rejects(job(u,33),/INSUFFICIENT/);
  await database().transaction(tx=>unfreezeRefund(tx,p));
  const id=await job(u,33);
  assert.equal((await database().transaction(tx=>freezeRefund(tx,{...p,now:new Date()}))).ok,false);
  await settle(id,u,'released');
  await database().transaction(tx=>applyFullRefund(tx,p));await database().transaction(tx=>applyFullRefund(tx,p));await database().transaction(tx=>grantPurchase(tx,p));
  assert.equal((await walletSummary(u)).testAvailableCredits,0);
  const old=await purchase(u,150,'test',new Date(Date.now()-15*86400_000));
  assert.equal((await database().transaction(tx=>freezeRefund(tx,{...old,now:new Date()}))).reason,'REFUND_WINDOW_EXPIRED');
});
test('external refund records debt rather than rolling back; released reservations remove their debt',opts,async()=>{
  const u=await user(),p=await purchase(u),id=await job(u,33);
  await database().transaction(tx=>applyFullRefund(tx,p));assert.equal((await walletSummary(u)).testBlocked,true);
  await settle(id,u,'released');assert.equal((await walletSummary(u)).testBlocked,false);
  const p2=await purchase(u),id2=await job(u,33);await settle(id2,u,'consumed');
  await database().transaction(tx=>applyFullRefund(tx,p2));assert.equal((await walletSummary(u)).testBlocked,true);
  await purchase(u);await assert.rejects(job(u,33),/WALLET_BLOCKED/);
});
test('per-order evidence holds do not invent debt or clear other holds',opts,async()=>{
  const u=await user(),a=await purchase(u),b=await purchase(u);
  await database().transaction(async tx=>{await blockWalletForReview(tx,a,'Amount not yet verified');await blockWalletForReview(tx,b,'Tax not yet verified');});
  await database().transaction(async tx=>{await unfreezeRefund(tx,a);await resolveWalletReview(tx,a,'Authenticated evidence resolved this order');});
  assert.equal((await walletSummary(u)).testBlocked,true);
  assert.equal((await walletSummary(u)).blocked,false);
  const [w]=await database().execute(sql`SELECT debt FROM credit_wallets WHERE user_id=${u}::uuid AND environment='test'`);assert.equal(w.debt,0);
  await database().transaction(tx=>resolveWalletReview(tx,b,'Authenticated evidence resolved second order'));assert.equal((await walletSummary(u)).testBlocked,false);
});
test('expired lease cannot settle; recovery only polls; invalid delivery remains reserved',opts,async()=>{
  const u=await user();await purchase(u);const id=await job(u,33);
  const first=await claimJob(id,fake);assert.ok(first?.submit);
  await database().execute(sql`UPDATE video_jobs SET lease_until=now()-interval '1 second',next_poll_at=now() WHERE id=${id}::uuid`);
  let posts=0,gets=0;
  const f:VideoProvider={...fake,request:async(_path,init)=>{if(init?.method==='POST')posts++;else gets++;return {id:'original-task',status:'success',data:[{url:'https://qa.example/test.mp4'}]};},verifyDelivery:async()=>false};
  await processJob(id,f);
  await finishClaim(first!.job,{task:{id:'stale-task',status:'failed'}});
  let j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.status,'unknown');assert.equal(j?.creditState,'reserved');assert.equal(posts,0);assert.equal(gets,1);
  await processJob(id,{...f,verifyDelivery:async()=>true},true);
  j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.status,'success');assert.equal(j?.creditState,'consumed');assert.equal((await walletSummary(u)).testAvailableCredits,117);
});
test('24h unknown requires review; audited release survives late success without charging',opts,async()=>{
  const u=await user();await purchase(u);const id=await job(u,33);
  await database().execute(sql`UPDATE video_jobs SET created_at=now()-interval '25 hours',submission_started_at=now()-interval '25 hours' WHERE id=${id}::uuid`);
  await processJob(id,{...fake,request:async()=>{throw new Error('Unknown upstream');}});
  let j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.reviewRequired,true);assert.equal(j?.status,'unknown');
  await releaseForReview(id,'qa-operator','Remote task unresolved after investigation');
  await processJob(id,{...fake,request:async()=>({id:'late-success',status:'success',data:[{url:'https://qa.example/test.mp4'}]})},true);
  j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.status,'success');assert.equal(j?.creditState,'released');assert.equal((await walletSummary(u)).testAvailableCredits,150);
  const audit=await database().execute(sql`SELECT action FROM credit_audit WHERE job_id=${id}::uuid`);assert.ok(audit.some(x=>x.action==='operator-release'));
});
test('live worker cannot submit test jobs; definitive failed tasks release credits',opts,async()=>{
  const u=await user();await purchase(u);const id=await job(u,33);
  let calls=0;
  assert.equal(await claimJob(id,{...fake,kind:'live',request:async()=>{calls++;throw Error();}}),null);assert.equal(calls,0);
  await processJob(id,{...fake,request:async()=>({id:'failed-task',status:'failed'})});
  assert.equal((await walletSummary(u)).testAvailableCredits,150);
});
async function cookie(u:string) {
 const sid=randomUUID();await database().insert(authSessions).values({id:sid,userId:u,expiresAt:new Date(Date.now()+3600_000)});
 const jwt=await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(u).setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('10m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));return `kr_access=${jwt}`;
}
const input=()=>({requestId:randomUUID(),family:'seedance',mode:'text',prompt:'A leaf in sunlight',duration:5,resolution:'720p',ratio:'16:9',audio:false});
test('paid quote API requires same origin and account; quote binding, expiry, idempotency and default gate',opts,async()=>{
 const u=await user();await purchase(u);const session=await cookie(u);let posts=0;
 const app=createApp({charging:{enabled:true,environment:'test'},videoProvider:{...fake,request:async(_p,i)=>{if(i?.method==='POST')posts++;return {id:'api-task',status:'pending'};}}});
 const req=(path:string,body:unknown,c=session,origin=process.env.APP_URL!)=>app.request(`https://credit-test.example/api${path}`,{method:'POST',headers:{cookie:c,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const x=input();assert.equal((await req('/jobs/quote',x,'')).status,401);assert.equal((await req('/jobs/quote',x,session,'https://evil.example')).status,403);
 const q=await (await req('/jobs/quote',x)).json();assert.equal(q.credits,33);assert.equal(q.available,true);
 assert.equal((await req('/jobs',{...x,prompt:'tampered',billingMode:'paid',quoteId:q.quoteId})).status,409);
 assert.equal((await walletSummary(u)).testReservedCredits,0);
 const responses=await Promise.all([req('/jobs',{...x,billingMode:'paid',quoteId:q.quoteId}),req('/jobs',{...x,billingMode:'paid',quoteId:q.quoteId})]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,201]);assert.equal(posts,1);assert.equal((await walletSummary(u)).testReservedCredits,33);
 const y=input(),qy=await(await req('/jobs/quote',y)).json();await database().execute(sql`UPDATE video_quotes SET expires_at=now()-interval '1 second' WHERE id=${qy.quoteId}::uuid`);
 assert.equal((await req('/jobs',{...y,billingMode:'paid',quoteId:qy.quoteId})).status,409);
 const disabled=createApp({videoProvider:fake});
 const r=await disabled.request('https://credit-test.example/api/jobs',{method:'POST',headers:{cookie:session,origin:process.env.APP_URL!,'content-type':'application/json'},body:JSON.stringify({...input(),billingMode:'paid',quoteId:randomUUID()})});assert.equal(r.status,503);
});
test('legacy active preview job with payload is polled without a new submission',opts,async()=>{
 const owner=await user(),id=randomUUID();
 await database().insert(jobs).values({id,owner,family:'seedance',mode:'text',prompt:'legacy',duration:5,resolution:'720p',fingerprint:'legacy',payload:{model:'legacy'},status:'submitting',submissionStartedAt:new Date(Date.now()-60_000)});
 let posts=0,gets=0;
 await processJob(id,{...fake,request:async(path,init)=>{if(init?.method==='POST') posts++;else {gets++;assert.equal(path,`?client_request_id=${id}`);}return {id:'legacy-original',status:'pending'};}});
 assert.equal(posts,0);assert.equal(gets,1);
 const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.creditState,'none');assert.equal(j?.billingMode,'preview');
});
test('refund-before-purchase creates a tombstone and does not mint credits on late purchase',opts,async()=>{
 const u=await user(),p=await purchase(u,150,'test',new Date(),false);
 await database().transaction(tx=>applyFullRefund(tx,p));
 await database().transaction(tx=>grantPurchase(tx,p));
 assert.equal((await walletSummary(u)).testAvailableCredits,0);
 const [b]=await database().execute(sql`SELECT refunded FROM credit_batches WHERE order_id=${p.orderId}::uuid`);assert.equal(b.refunded,true);
});
test('concurrent refund freeze and reservation have exactly one winner',opts,async()=>{
 const u=await user(),p=await purchase(u);
 const [freeze,reservation]=await Promise.allSettled([
  database().transaction(tx=>freezeRefund(tx,{...p,now:new Date()})),job(u,33),
 ]);
 assert.equal(freeze.status,'fulfilled');
 const frozen=freeze.status==='fulfilled'&&freeze.value.ok;
 assert.notEqual(frozen,reservation.status==='fulfilled');
});
test('worker recovers a persisted unstarted job and a second tick never posts it again',opts,async()=>{
 const u=await user();await purchase(u);const id=await job(u,33);
 let targetPosts=0;
 const f:VideoProvider={...fake,request:async(path,init)=>{
  const key=(init?.headers as Record<string,string>|undefined)?.['Idempotency-Key'];
  if(key===id) targetPosts++;
  return {id:key?`recovered-${key}`:path.replace(/^\//,''),status:'pending'};
 }};
 await workerTick(f,100);assert.equal(targetPosts,1);
 await database().execute(sql`UPDATE video_jobs SET next_poll_at=now() WHERE id=${id}::uuid`);
 await workerTick(f,100);assert.equal(targetPosts,1);
 const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.equal(j?.upstreamId,`recovered-${id}`);assert.equal(j?.creditState,'reserved');
});
test('uninvited owner can recover but GET/recover never submit queued preview or paid work',opts,async()=>{
 const u=await user(),other=await user(),session=await cookie(u),otherSession=await cookie(other);
 await purchase(u);
 const paidId=await job(u,33),previewId=randomUUID(),unknownId=randomUUID();
 await database().insert(jobs).values({id:previewId,owner:u,family:'seedance',mode:'text',prompt:'previously accepted preview',duration:5,resolution:'720p',fingerprint:'queued-preview',payload:{model:'qa-fake'},status:'submitting'});
 let posts=0,gets=0;
 const provider:VideoProvider={...fake,request:async(path,init)=>{
   if(init?.method==='POST') {posts++;return {id:'accepted-original-task',status:'pending'};}
   gets++;
   if(path===`?client_request_id=${unknownId}`) return {id:'original-unknown-task',status:'pending'};
   assert.equal(path,'/accepted-original-task');return {id:'accepted-original-task',status:'pending'};
 }};
 const app=createApp({charging:{enabled:true,environment:'test'},videoProvider:provider});
 const req=(path:string,method='GET',sessionCookie=session,body?:unknown)=>app.request(`https://credit-test.example/api${path}`,{
   method,headers:{cookie:sessionCookie,origin:process.env.APP_URL!,'content-type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),
 });
 assert.equal((await req('/jobs','POST',session,input())).status,403,'Uninvited account cannot create preview work');
 const before=await walletSummary(u);
 for(const id of [previewId,paidId]) {
   assert.equal((await req(`/jobs/${id}/recover`,'POST',otherSession)).status,404);
   assert.equal((await req(`/jobs/${id}/recover`,'POST')).status,200);
   assert.equal((await req(`/jobs/${id}`)).status,200);
   const queued=await database().query.jobs.findFirst({where:eq(jobs.id,id)});
   assert.equal(queued?.status,'submitting');assert.equal(queued?.submissionStartedAt,null);assert.equal(queued?.leaseToken,null);assert.ok(queued?.payload);
 }
 assert.equal(posts,0);assert.equal(gets,0);assert.deepEqual(await walletSummary(u),before);
 await database().insert(jobs).values({id:unknownId,owner:u,family:'seedance',mode:'text',prompt:'previously attempted preview',duration:5,resolution:'720p',fingerprint:'unknown-preview',payload:{model:'qa-fake'},status:'unknown',submissionStartedAt:new Date()});
 const recoveredUnknown=await req(`/jobs/${unknownId}/recover`,'POST');
 assert.equal(recoveredUnknown.status,200);assert.equal((await recoveredUnknown.json()).job.status,'pending');
 assert.equal(posts,0);assert.equal(gets,1);assert.deepEqual(await walletSummary(u),before);
 // The submission worker is still allowed to process an already accepted job.
 await processJob(previewId,provider,true);assert.equal(posts,1);
 assert.equal((await req(`/jobs/${previewId}/recover`,'POST')).status,200);
 assert.equal(posts,1);assert.equal(gets,2);
 assert.deepEqual(await walletSummary(u),before,'Polling never creates a new reservation');
});
