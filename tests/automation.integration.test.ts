import { advanceAutomation, createAutomation, getAutomation, publicSafety, type PromptScanner } from '../src/server/moderation/automation';
import { ProviderError } from '../src/server/provider';
import { workerTick } from '../src/server/jobs/runner';
import type { PromptSiftResult } from '../src/server/moderation/prompt-sift';
import { before, beforeEach, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
const AGE_POLICY_VERSION = "18-plus-2026-10-26"; // Historical migration fixture only.
import { createApp } from '../src/server/app';
import { database, closeDatabase } from '../src/server/db';
import { jobs, users, authSessions } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { walletSummary, grantPurchase } from '../src/server/credits/wallet';
import { generationFingerprint } from '../src/server/credits/quotes';
import { productionChargingPolicy } from '../src/server/credits/config';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { configureGenerationBudget, confirmGenerationRate, getGenerationCost, getGenerationBudget } from '../src/server/costs';
import { processJob, pollJob, type VideoProvider } from '../src/server/jobs/runner';
import { currentReview } from '../src/server/moderation/service';

// Fresh disposable DB ONLY. Never inherits DATABASE_URL or loads configuration files.
const url=process.env.AUTOMATION_TEST_DATABASE_URL;
const opts={skip:!url,timeout:30_000};
const dbName='kakareel_auto_55450_sandbox',role='kakareel_auto_55450_test';
const origin='https://automation.example.invalid', secret='synthetic-automation-session-secret-for-isolated-tests';
const keys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_LIVE_PILOT_USER_ID','GENERATION_LIVE_PILOT_REQUEST_ID','GENERATION_LIVE_PILOT_EXPIRES_AT','GENERATION_REVIEW_POLICY','GENERATION_MVP_AUTOMATION_ENABLED','GENERATION_REVIEW_MAX_WAIT_SECONDS','GENERATION_REVIEW_MAX_ATTEMPTS','GENERATION_REVIEW_TIMEOUT_MS'] as const;
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
const realNow=Date.now.bind(Date);let clock=realNow();
let pg:ReturnType<typeof postgres>, initialized=false;
type Actor={id:string;cookie:string};
let owner:Actor,stranger:Actor,requestId:string;
let failure:Error|null=null;let taskId='synthetic-task',outputUrl='https://synthetic.example.invalid/full-video.mp4';
let status:'success'|'pending'|'failed'='pending',lost=false,contentAvailable=true;
const calls:{method:string;path:string;body?:string}[]=[];
const contentSha256=createHash('sha256').update('synthetic complete output bytes').digest('hex');
const videoUrl='https://synthetic.example.invalid/full-video.mp4';
const provider:VideoProvider={kind:'live',request:async(path,init)=>{
  const method=init?.method??'GET';calls.push({method,path,...(init?.body?{body:String(init.body)}:{})});
  if(failure)throw failure;
  if(method==='POST'&&lost)throw new Error('Synthetic response lost after acceptance');
  return {id:taskId,status,...(status==='success'?{data:[{url:outputUrl}]}:{})};
},verifyDelivery:async()=>{throw new Error('MVP must verify complete content');},verifyContent:async()=>contentAvailable?{contentSha256,bytes:100,mime:'video/mp4'}:null};
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
async function balances(available:number,reserved:number,consumed:number){const b=await walletSummary(owner.id);assert.equal(b.availableCredits,available);assert.equal(b.reservedCredits,reserved);const [r]=await pg`SELECT coalesce(sum(consumed),0)::int AS n FROM credit_batches WHERE user_id=${owner.id}::uuid`;assert.equal(r.n,consumed);}
async function auditCount(action:string){const [r]=await pg`SELECT count(*)::int AS n FROM credit_audit WHERE job_id=${requestId}::uuid AND action=${action}`;return r.n;}

before(async()=>{
 if(!url)return;
 const u=new URL(url);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55450');assert.equal(u.pathname,`/${dbName}`);assert.equal(u.username,role);assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
 global.fetch=async()=>{throw new Error('External fetch forbidden in automation tests');};
 pg=postgres(url,{max:12,onnotice:()=>{}});
 const [scope]=await pg`SELECT current_database() AS db,current_user AS role`;assert.equal(scope.db,dbName);assert.equal(scope.role,role);
 const tables=await pg`SELECT tablename FROM pg_tables WHERE schemaname='public'`;assert.equal(tables.length,0,'Use a fresh empty disposable DB; never delete existing test data');
 await closeDatabase();process.env.DATABASE_URL=url;process.env.APP_URL=origin;process.env.SESSION_SECRET=secret;process.env.VIBETOKEN_API_KEY='synthetic-unused';process.env.DEMO_ACCESS_CODE='synthetic-unused';
 mock.method(Date,'now',()=>clock);
 initialized=true;
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort()) {
  if(file.startsWith('0011-')) {
   const id=randomUUID();await pg`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,status) VALUES(${id}::uuid,${randomUUID()}::uuid,'minimax','image','legacy',6,'2K','legacy','unknown')`;
   const before=await pg`SELECT row_to_json(j) AS j FROM video_jobs j WHERE id=${id}::uuid`;
   await pg.unsafe(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
   assert.deepEqual(await pg`SELECT row_to_json(j) AS j FROM video_jobs j WHERE id=${id}::uuid`,before);
   assert.equal((await pg`SELECT count(*)::int n FROM generation_automation`)[0].n,0);
  } else await pg.unsafe(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 }
 // Fail any accidental automatic insertion into the human moderation queue.
 await pg.unsafe(`CREATE FUNCTION reject_auto_manual_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM generation_automation WHERE job_id=NEW.job_id AND policy_version='mvp-text-only-v1') THEN RAISE EXCEPTION 'MVP must never write human moderation'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_auto_manual_review BEFORE INSERT OR UPDATE ON generation_moderation FOR EACH ROW EXECUTE FUNCTION reject_auto_manual_review();`);
});
after(async()=>{
 mock.restoreAll();await closeDatabase();
 if(pg){if(initialized){await pg`DROP SCHEMA public CASCADE`;await pg`CREATE SCHEMA public`;}await pg.end();}
 global.fetch=originalFetch;
 for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
beforeEach(async()=>{
 if(!url)return;
 await pg`TRUNCATE users,video_jobs,generation_cost_audit,generation_cost_reservations,generation_cost_specs,generation_cost_rates CASCADE`;
 await pg`UPDATE generation_cost_budget SET enabled=false,cap_minor=0,exposure_minor=0,valid_from=NULL,expires_at=NULL,revision=0`;
 await pg`UPDATE generation_moderation_rollout SET started_at=clock_timestamp()-interval '2 days'`;
 clock=realNow();calls.length=0;lost=false;status='pending';contentAvailable=true;failure=null;taskId='synthetic-task';outputUrl=videoUrl;
 process.env.GENERATION_REVIEW_POLICY='mvp-text-only-v1';process.env.GENERATION_MVP_AUTOMATION_ENABLED='true';
 delete process.env.GENERATION_REVIEW_MAX_WAIT_SECONDS;delete process.env.GENERATION_REVIEW_MAX_ATTEMPTS;delete process.env.GENERATION_REVIEW_TIMEOUT_MS;
 owner=await actor();stranger=await actor();requestId=randomUUID();configure();
 for(const who of [owner,stranger]){
  const id=randomUUID();await database().insert(billingOrders).values({id,userId:who.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
  await database().transaction(tx=>grantPurchase(tx,{orderId:id,userId:who.id,environment:'live',credits:150,paidAt:new Date()}));
 }
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:456,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:budget'}));
 await database().transaction(tx=>confirmGenerationRate(tx,{spec:{provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image',duration:6,resolution:'2K',audio:false,ratio:'adaptive'},expectedRateId:null,maximumMinor:456,sourceRef:'synthetic:rate',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic'}));
});


const result=(action:PromptSiftResult['action'],extra:Partial<PromptSiftResult>={}):PromptSiftResult=>({action,requestId:'private-request',reasonCode:'private-reason',semanticStatus:'private-status',retryable:action!=='block',retryAfterMs:null,httpStatus:200,...extra});
const scans:Parameters<PromptScanner>[0][]=[];
const allow:PromptScanner=async x=>{scans.push(x);return result('allow');};
async function auto(){const a=await getAutomation(database(),requestId);assert.ok(a);return a;}
async function noManual(){assert.equal((await pg`SELECT count(*)::int n FROM generation_moderation`)[0].n,0);}
async function released(){await balances(150,0,0);assert.equal((await job()).status,'failed');assert.equal((await getGenerationCost(database(),requestId))!.state,'released');assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);await noManual();}
beforeEach(()=>{scans.length=0;});

test('atomic queued acceptance and read/recover never scan or submit; concurrent replay holds once',opts,async()=>{
 const x=input(),q=await quote();const responses=await Promise.all(Array.from({length:4},()=>request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,200,201]);
 const body=await responses[0].json();assert.equal(body.job.status,'submitting');assert.equal(body.job.safety.status,'checking');assert.equal(body.job.moderation,null);
 assert.equal(body.job.safety.imageReview,'not_reviewed_mvp');assert.equal(body.job.safety.outputReview,'not_reviewed_mvp');
 await request('/jobs/'+requestId);await request('/jobs/'+requestId+'/recover','POST',{});
 assert.equal(calls.length,0);assert.equal((await auto()).attempts,0);await balances(127,23,0);
 assert.equal((await getGenerationCost(database(),requestId))!.state,'held');assert.equal(productionChargingPolicy.enabled,false);
 assert.equal((await request('/jobs/'+requestId,'GET',undefined,stranger)).status,404);await noManual();
});

test('creation rollback leaves no job, policy, credits or supplier hold',opts,async()=>{
 const q=await quote();await pg`UPDATE video_quotes SET expires_at=now()-interval '1 second' WHERE id=${q.quoteId}::uuid`;
 assert.equal((await request('/jobs','POST',{...input(),billingMode:'paid',quoteId:q.quoteId})).status,409);
 assert.equal(await getAutomation(database(),requestId),null);assert.equal(await getGenerationCost(database(),requestId),null);
 assert.equal((await pg`SELECT count(*)::int n FROM video_jobs`)[0].n,0);await balances(150,0,0);
});

test('worker allow: concurrency submits once, incomplete output never captures, full file captures once without manual review',opts,async()=>{
 await create();status='success';contentAvailable=false;
 await Promise.all([workerTick(provider,8,allow),processJob(requestId,provider,true,true,allow),processJob(requestId,provider,true,true,allow)]);
 assert.equal(scans.length,1);assert.deepEqual(Object.keys(scans[0]).sort(),['idempotencyKey','prompt','timeoutMs']);
 assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal((await job()).status,'unknown');await balances(127,23,0);
 assert.equal((await job()).resultUrl,null);await noManual();contentAvailable=true;
 await Promise.all([pollJob(requestId,provider,true),pollJob(requestId,provider,true)]);
 assert.equal((await job()).resultUrl,videoUrl);await balances(127,0,23);assert.equal(await auditCount('automation-delivery'),1);
 assert.equal((await pg`SELECT output_content_sha256 FROM generation_automation WHERE job_id=${requestId}::uuid`)[0].output_content_sha256,contentSha256);
 await processJob(requestId,provider,true,true,allow);assert.equal(scans.length,1);await balances(127,0,23);await noManual();
 const s=await publicSafety(requestId);assert.ok(!JSON.stringify(s).includes('private-'));assert.equal(s!.status,'allowed');
});

test('block releases credits and unsubmitted cost exactly once; durable terminal never resubmits',opts,async()=>{
 await create();let n=0;const block:PromptScanner=async()=>{n++;return result('block');};
 await Promise.all([processJob(requestId,provider,true,true,block),processJob(requestId,provider,true,true,block)]);
 await processJob(requestId,provider,true,true,allow);assert.equal(n,1);assert.equal(calls.length,0);assert.equal((await auto()).status,'blocked');
 await released();assert.equal(await auditCount('automation-blocked'),1);
});

test('review respects adapter one-hour retry, short deadline expires with no invented rescan or model POST',opts,async()=>{
 await create();let n=0;const scanner:PromptScanner=async()=>{n++;return result('review',{retryAfterMs:3600_000});};
 await processJob(requestId,provider,true,true,scanner);const a=await auto();assert.equal(a.status,'review');
 assert.equal(new Date(a.next_attempt_at).getTime(),new Date(a.deadline_at).getTime());clock+=60_000;
 await processJob(requestId,provider,true,true,scanner);assert.equal(n,1);clock=new Date(a.deadline_at).getTime();
 await processJob(requestId,provider,true,true,scanner);assert.equal(n,1);assert.equal((await auto()).status,'expired');assert.equal(calls.length,0);await released();
});

test('review fallback uses sixty seconds, same idempotency key, three total attempts then terminal release',opts,async()=>{
 await create();const keys:string[]=[];const scanner:PromptScanner=async x=>{keys.push(x.idempotencyKey);return result('review');};
 for(let i=0;i<3;i++){await processJob(requestId,provider,true,true,scanner);clock+=60_000;}
 assert.equal(keys.length,3);assert.equal(new Set(keys).size,1);assert.equal((await auto()).status,'expired');await released();assert.equal(calls.length,0);
});

test('429 respects Retry-After, ordinary retry uses ten seconds, key remains fixed',opts,async()=>{
 await create();const keys:string[]=[];const scanner:PromptScanner=async x=>{keys.push(x.idempotencyKey);return keys.length===1?result('error',{httpStatus:429,retryAfterMs:20_000}):keys.length===2?result('error',{httpStatus:503}):result('allow');};
 await processJob(requestId,provider,true,true,scanner);clock+=19_999;await processJob(requestId,provider,true,true,scanner);assert.equal(keys.length,1);
 clock++;await processJob(requestId,provider,true,true,scanner);clock+=9999;await processJob(requestId,provider,true,true,scanner);assert.equal(keys.length,2);
 clock++;await processJob(requestId,provider,true,true,scanner);assert.equal(keys.length,3);assert.equal(new Set(keys).size,1);assert.equal(calls.filter(x=>x.method==='POST').length,1);await balances(127,23,0);await noManual();
});

test('bounded scanner timeout retries five/ten seconds then releases, never manual queue',opts,async()=>{
 process.env.GENERATION_REVIEW_TIMEOUT_MS='1000';await create();let n=0;
 const scanner:PromptScanner=async()=>{n++;return new Promise(()=>{});};
 for(let i=0;i<3;i++){await processJob(requestId,provider,true,true,scanner);clock+=(i===0?5000:10000);}
 assert.equal(n,3);assert.equal((await auto()).status,'error');assert.equal(calls.length,0);await released();
});

test('restart expires scanner lease, reuses key, fences late old response',opts,async()=>{
 await create();let entered!:()=>void,resolveOld!:(x:PromptSiftResult)=>void;const started=new Promise<void>(r=>{entered=r;});const keys:string[]=[];
 const old=advanceAutomation(requestId,'live',async x=>{keys.push(x.idempotencyKey);entered();return new Promise(r=>{resolveOld=r;});});await started;
 await closeDatabase();clock+=16_000;await advanceAutomation(requestId,'live',async x=>{keys.push(x.idempotencyKey);return result('allow');});
 resolveOld(result('block'));await old;assert.equal((await auto()).status,'allowed');assert.equal((await auto()).attempts,2);assert.equal(new Set(keys).size,1);
 const attempts=await pg`SELECT action FROM generation_automation_attempts ORDER BY attempt`;assert.deepEqual(attempts.map(x=>x.action),['abandoned','allow']);
 await processJob(requestId,provider,true,true,allow);assert.equal(scans.length,0);assert.equal(calls.filter(x=>x.method==='POST').length,1);await noManual();
});

test('immutable snapshots, exact input binding and selector rollback are independent',opts,async()=>{
 await create();await assert.rejects(pg`UPDATE generation_automation SET policy_version='manual-v1' WHERE job_id=${requestId}::uuid`,/immutable/);
 await assert.rejects(pg`UPDATE generation_automation SET deadline_at=deadline_at+interval '1 hour' WHERE job_id=${requestId}::uuid`,/immutable/);
 process.env.GENERATION_REVIEW_POLICY='manual-v1';await advanceAutomation(requestId,'live',allow);
 await pg`UPDATE video_jobs SET payload=jsonb_set(payload,'{prompt}','"different"') WHERE id=${requestId}::uuid`;
 await processJob(requestId,provider,true,true,allow);assert.equal((await auto()).reason,'INPUT_CHANGED');await released();assert.equal(calls.length,0);
});

test('rollback affects only new snapshots; emergency cancels queued but submitted unknown can recover and settle',opts,async()=>{
 await create();process.env.GENERATION_REVIEW_POLICY='manual-v1';lost=true;await processJob(requestId,provider,true,true,allow);
 assert.equal((await job()).status,'unknown');assert.equal(calls.filter(x=>x.method==='POST').length,1);
 process.env.GENERATION_MVP_AUTOMATION_ENABLED='false';delete process.env.GENERATION_LIVE_PILOT_USER_ID;clock+=901_000;
 await closeDatabase();lost=false;status='success';await pollJob(requestId,provider,true);await pollJob(requestId,provider,true);
 await balances(127,0,23);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal(scans.length,1);assert.equal((await auto()).status,'allowed');await noManual();
});

test('emergency off before scanning cancels known-unsubmitted holds with zero external calls',opts,async()=>{
 await create();process.env.GENERATION_MVP_AUTOMATION_ENABLED='false';await processJob(requestId,provider,true,true,allow);
 assert.equal(scans.length,0);assert.equal(calls.length,0);assert.equal((await auto()).status,'canceled');await released();
});

for(const mode of ['failed-task','definitive-http'] as const)test(`provider ${mode} releases once and keeps submitted supplier exposure`,opts,async()=>{
 await create();if(mode==='failed-task')status='failed';else failure=new ProviderError(402);
 await processJob(requestId,provider,true,true,allow);await processJob(requestId,provider,true,true,allow);
 await balances(150,0,0);assert.equal((await job()).status,'failed');assert.equal(calls.length,1);
 const cost=(await getGenerationCost(database(),requestId))!;assert.equal(cost.state,'submitted');assert.equal(cost.actualMinor,null);assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);await noManual();
});

for(const mode of ['unsafe-url','wrong-task'] as const)test(`${mode} cannot deliver or capture`,opts,async()=>{
 await create();await processJob(requestId,provider,true,true,allow);status='success';if(mode==='unsafe-url')outputUrl='http://unsafe.invalid/x';else taskId='different-task';
 await pollJob(requestId,provider,true);assert.equal((await job()).status,'unknown');assert.equal((await job()).resultUrl,null);await balances(127,23,0);await noManual();
});

for(const mode of ['expiry','emergency','content-case','replacement-lease'] as const)test(`pause after claim before final send authorization: ${mode}`,opts,async(t)=>{
 await create();let resume!:()=>void,reached!:()=>void;
 const pause=new Promise<void>(r=>{reached=r;}),resumeClaim=new Promise<void>(r=>{resume=r;});
 const db=database(),transaction=db.transaction.bind(db);
 const spy=t.mock.method(Object.getPrototypeOf(db) as typeof db,'transaction',(async(fn:Parameters<typeof db.transaction>[0])=>{
  const value=await transaction(fn);const claim=value as {submit?:boolean;job?:{id:string}}|null;
  if(claim?.submit&&claim.job?.id===requestId){reached();await resumeClaim;}return value;
 }) as typeof db.transaction);
 const running=processJob(requestId,provider,true,true,allow);
 await Promise.race([pause,running.then(()=>{throw new Error('Expected pause after first claim');})]);
 try {
  assert.equal((await getGenerationCost(database(),requestId))!.state,'submitted');assert.equal(calls.length,0);
  if(mode==='expiry')clock=new Date((await auto()).deadline_at).getTime()+1;
  if(mode==='emergency')process.env.GENERATION_MVP_AUTOMATION_ENABLED='false';
  if(mode==='content-case')await report();
  if(mode==='replacement-lease')await pg`UPDATE video_jobs SET lease_token=${randomUUID()}::uuid WHERE id=${requestId}::uuid`;
 } finally {resume();}
 await running;spy.mock.restore();assert.equal(calls.length,0);
 if(mode==='expiry'||mode==='emergency'){
  await released();assert.equal((await job()).submissionStartedAt,null);assert.equal((await auto()).status,'canceled');
  process.env.GENERATION_MVP_AUTOMATION_ENABLED='true';await processJob(requestId,provider,true,true,allow);assert.equal(calls.length,0);
 }else{
  await balances(127,23,0);assert.equal((await getGenerationCost(database(),requestId))!.state,'submitted');assert.equal((await getGenerationBudget(database()))!.exposureMinor,456);
 }
});

async function report(){const {openCase}=await import('../src/server/moderation/cases');return openCase({jobId:requestId,sourceReference:'synthetic:'+requestId,category:'rights',summary:'Synthetic rights complaint under review',actor:'synthetic-reviewer'});}
test('reported queued MVP remains worker-reachable and atomically cancels both holds',opts,async()=>{
 await create();await report();assert.equal((await job()).reviewRequired,true);
 const replay=await request('/jobs','POST',{...input(),billingMode:'paid',quoteId:randomUUID()});
 assert.equal(replay.status,200);const body=await replay.json();
 assert.equal(body.job.creditState,'reserved');assert.equal(body.job.reviewRequired,true);
 assert.equal(body.job.status,'unknown');assert.equal(body.error,undefined);assert.equal(body.code,undefined);
 assert.ok(!JSON.stringify(body).includes('credits have been released'));await balances(127,23,0);
 await workerTick(provider,8,allow);assert.equal((await auto()).status,'canceled');assert.equal((await auto()).reason,'CONTENT_CASE_HOLD');
 await released();assert.equal(scans.length,0);assert.equal(calls.length,0);
});

for(const phase of ['checking','pending','success'] as const)test(`guest-to-account owner migration at ${phase} preserves exact content policy and authorized delivery`,opts,async()=>{
 // Same DB ownership update used by auth-routes, with no Google/network call.
 // Guest preview jobs have no wallet; account claims change only owner/updatedAt.
 const guest=randomUUID(),x=input();
 await database().transaction(async tx=>{
  const [j]=await tx.insert(jobs).values({id:requestId,owner:guest,family:x.family,mode:x.mode,prompt:x.prompt,duration:x.duration,resolution:x.resolution,
   fingerprint:generationFingerprint(x),payload:providerPayload(x),status:'submitting',billingMode:'preview'}).returning();await createAutomation(tx,j);
 });
 const fake:VideoProvider={...provider,kind:'fake'};
 if(phase!=='checking'){if(phase==='success')status='success';await processJob(requestId,fake,true,true,allow);assert.equal((await job()).status,phase);}
 const snapshot=await auto();
 await database().update(jobs).set({owner:owner.id,updatedAt:new Date()}).where(eq(jobs.owner,guest));
 if(phase==='checking')await processJob(requestId,fake,true,true,allow);
 if(phase!=='success'){status='success';await pollJob(requestId,fake,true);}
 assert.equal((await job()).status,'success');assert.equal((await job()).resultUrl,videoUrl);assert.equal((await auto()).binding_hash,snapshot.binding_hash);
 assert.equal((await auto()).identity_hash,snapshot.identity_hash);assert.equal(scans.length,1);assert.equal(calls.filter(x=>x.method==='POST').length,1);
 const mine=await request('/jobs/'+requestId);assert.equal(mine.status,200);assert.equal((await request('/jobs/'+requestId,'GET',undefined,stranger)).status,404);await noManual();
});

test('historical absence remains manual, old records untouched, new manual snapshots never label output MVP',opts,async()=>{
 const legacy=randomUUID(),x=input(legacy);
 await database().insert(jobs).values({id:legacy,owner:owner.id,family:x.family,mode:x.mode,prompt:x.prompt,duration:x.duration,resolution:x.resolution,fingerprint:generationFingerprint(x),payload:providerPayload(x),status:'unknown',billingMode:'preview',submissionStartedAt:new Date()});
 const old=await job(legacy);assert.equal(await publicSafety(legacy),null);await create();assert.deepEqual(await job(legacy),old);
 assert.equal(await getAutomation(database(),legacy),null);assert.equal((await request('/jobs/'+legacy,'GET',undefined,stranger)).status,404);
 // A separate fresh manual preview follows the original input moderation queue.
 process.env.GENERATION_REVIEW_POLICY='manual-v1';const id=randomUUID(),manual=input(id);
 // Previous MVP holds the only configured budget. Cancel it before manual creation.
 process.env.GENERATION_MVP_AUTOMATION_ENABLED='false';await processJob(requestId,provider,true,true,allow);
 const response=await request('/jobs','POST',manual);assert.equal(response.status,201,await response.clone().text());
 const a=await getAutomation(database(),id);assert.equal(a!.policy_version,'manual-v1');assert.equal(a!.output_review,'manual');assert.equal(a!.image_review,'manual');
 assert.equal(await publicSafety(id),null);assert.equal((await database().transaction(tx=>currentReview(tx,id,'input')))!.state,'pending');assert.equal(calls.length,0);
 assert.deepEqual(await job(legacy),old);
});

test('nonretryable scanner failure releases immediately with a safe public reason',opts,async()=>{
 await create();let n=0;
 await processJob(requestId,provider,true,true,async()=>{n++;return result('error',{retryable:false,httpStatus:401,reasonCode:'SENSITIVE_SYNTHETIC_PROVIDER_DETAIL'});});
 await processJob(requestId,provider,true,true,allow);assert.equal(n,1);assert.equal(calls.length,0);await released();
 const safety=await publicSafety(requestId);assert.equal(safety!.status,'error');assert.equal(safety!.reason,'CHECK_UNAVAILABLE');assert.ok(!JSON.stringify(safety).includes('SENSITIVE'));
});
