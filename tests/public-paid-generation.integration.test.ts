import type { PromptScanner } from '../src/server/moderation/automation';
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
import { walletSummary, grantPurchase, reserveCredits, settleCredits, lockWallet } from '../src/server/credits/wallet';
import type { GenerationInput } from '../src/server/input';
import { configureGenerationBudget, confirmGenerationRate, getGenerationCost, getGenerationBudget } from '../src/server/costs';
import { processJob, pollJob, type VideoProvider } from '../src/server/jobs/runner';

// Fresh disposable DB ONLY. Never inherits DATABASE_URL or loads configuration files.
const url=process.env.PUBLIC_PAID_TEST_DATABASE_URL;
const opts={skip:!url,timeout:30_000};
const dbName='kakareel_acceptance_55452_sandbox',role='kakareel_acceptance_55452_test';
const origin='https://automation.example.invalid', secret='synthetic-automation-session-secret-for-isolated-tests';
const keys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_LIVE_PILOT_USER_ID','GENERATION_LIVE_PILOT_REQUEST_ID','GENERATION_LIVE_PILOT_EXPIRES_AT','GENERATION_REVIEW_POLICY','GENERATION_MVP_AUTOMATION_ENABLED','GENERATION_REVIEW_MAX_WAIT_SECONDS','GENERATION_REVIEW_MAX_ATTEMPTS','GENERATION_REVIEW_TIMEOUT_MS','GENERATION_PAID_ACCEPTANCE_ENABLED'] as const;
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
const realNow=Date.now.bind(Date);let clock=realNow();
let pg:ReturnType<typeof postgres>, initialized=false;
type Actor={id:string;cookie:string};
let owner:Actor,stranger:Actor,requestId:string,previousJobId:string;
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
async function actor():Promise<Actor>{
 const id=randomUUID(),sid=randomUUID();
 await database().insert(users).values({id,googleSub:id,email:`${id}@example.invalid`,invitedAt:null,ageConfirmedAt:new Date(),agePolicyVersion:AGE_POLICY_VERSION});
 await database().insert(authSessions).values({id:sid,userId:id,expiresAt:until()});
 const token=await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 return {id,cookie:`kr_access=${token}`};
}
function request(path:string,method='GET',body?:unknown,who=owner,headers:Record<string,string>={}){
 // Separate app instances share only DB/config, not in-memory slot state.
 return createApp({videoProvider:provider}).request(`${origin}/api${path}`,{method,headers:{cookie:who.cookie,origin,'content-type':'application/json','X-KakaReel-Owner':who.id,...headers},...(body?{body:JSON.stringify(body)}:{})});
}
async function quote(x=input(),who=owner){const r=await request('/jobs/quote','POST',x,who);assert.equal(r.status,200);return r.json();}
async function job(id=requestId){const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.ok(j);return j;}
async function balances(available:number,reserved:number,consumed:number){const b=await walletSummary(owner.id);assert.equal(b.availableCredits,available);assert.equal(b.reservedCredits,reserved);const [r]=await pg`SELECT coalesce(sum(consumed),0)::int AS n FROM credit_batches WHERE user_id=${owner.id}::uuid`;assert.equal(r.n,consumed);}
async function auditCount(action:string){const [r]=await pg`SELECT count(*)::int AS n FROM credit_audit WHERE job_id=${requestId}::uuid AND action=${action}`;return r.n;}

before(async()=>{
 if(!url)return;
 const u=new URL(url);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55452');assert.equal(u.pathname,`/${dbName}`);assert.equal(u.username,role);assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
 global.fetch=async()=>{throw new Error('External fetch forbidden in automation tests');};
 pg=postgres(url,{max:12,onnotice:()=>{}});
 const [scope]=await pg`SELECT current_database() AS db,current_user AS role`;assert.equal(scope.db,dbName);assert.equal(scope.role,role);
 const tables=await pg`SELECT tablename FROM pg_tables WHERE schemaname='public'`;assert.equal(tables.length,0,'Use a fresh empty disposable DB; never delete existing test data');
 await closeDatabase();process.env.DATABASE_URL=url;process.env.APP_URL=origin;process.env.SESSION_SECRET=secret;process.env.VIBETOKEN_API_KEY='synthetic-unused';process.env.DEMO_ACCESS_CODE='synthetic-unused';
 mock.method(Date,'now',()=>clock);
 initialized=true;
 for(const file of (await readdir(new URL('../db/',import.meta.url))).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort()) {
  if(file === '0011-generation-automation.sql') {
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
 owner=await actor();stranger=await actor();requestId=randomUUID();
 delete process.env.GENERATION_LIVE_PILOT_USER_ID;delete process.env.GENERATION_LIVE_PILOT_REQUEST_ID;delete process.env.GENERATION_LIVE_PILOT_EXPIRES_AT;
 process.env.GENERATION_PAID_ACCEPTANCE_ENABLED='false';
 for(const who of [owner,stranger]){
  const id=randomUUID();await database().insert(billingOrders).values({id,userId:who.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
  await database().transaction(tx=>grantPurchase(tx,{orderId:id,userId:who.id,environment:'live',credits:150,paidAt:new Date()}));
 }
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:true,capMinor:1368,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:budget'}));
 await database().transaction(tx=>confirmGenerationRate(tx,{spec:{provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image',duration:6,resolution:'2K',audio:false,ratio:'adaptive'},expectedRateId:null,maximumMinor:456,sourceRef:'synthetic:rate',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic'}));
 previousJobId=randomUUID();
 await database().transaction(async tx=>{
  await lockWallet(tx,owner.id,'live');
  await tx.insert(jobs).values({id:previousJobId,owner:owner.id,family:'minimax',mode:'image',prompt:'historical synthetic',duration:6,resolution:'2K',fingerprint:'historical',status:'success',billingMode:'paid',creditEnvironment:'live',credits:23,creditState:'reserved'});
  await reserveCredits(tx,{jobId:previousJobId,userId:owner.id,environment:'live',credits:23});
  await settleCredits(tx,previousJobId,'consumed');
  await tx.update(jobs).set({creditState:'consumed'}).where(eq(jobs.id,previousJobId));
 });

});
const result=(action:PromptSiftResult['action'],extra:Partial<PromptSiftResult>={}):PromptSiftResult=>({action,requestId:'private-request',reasonCode:'private-reason',semanticStatus:'private-status',retryable:action!=='block',retryAfterMs:null,httpStatus:200,...extra});
const scans:Parameters<PromptScanner>[0][]=[];
const allow:PromptScanner=async x=>{scans.push(x);return result('allow');};
async function noManual(){assert.equal((await pg`SELECT count(*)::int n FROM generation_moderation`)[0].n,0);}
beforeEach(()=>{scans.length=0;});


test('ordinary signed-in accounts without preview access have public paid mode and no consumed pilot restriction',opts,async()=>{
 for(const who of [owner,stranger]){
  const summary=await (await request('/billing','GET',undefined,who)).json();
  assert.equal(summary.generationChargingEnabled,true);assert.equal(summary.generationPilot,null);assert.equal(summary.previewAccess,false);
  assert.equal((await quote(input(randomUUID()),who)).available,true);
 }
 const preview=await request('/jobs','POST',input());assert.equal(preview.status,403);
 assert.equal((await request('/billing','GET',undefined,{id:'',cookie:''})).status,401);
 await balances(127,0,23);assert.equal(calls.length,0);
});

test('public quotes and create reject all unreleased specifications without holds or model calls',opts,async()=>{
 for(const change of [{duration:10},{audio:true},{family:'kling',resolution:'4K'},{mode:'text',ratio:'16:9',image:undefined}]){
  const x={...input(),...change} as GenerationInput;
  const q=await quote(x);assert.equal(q.available,false);assert.equal(q.reason,'PAID_SPEC_UNAVAILABLE');
  const r=await request('/jobs','POST',{...x,billingMode:'paid',quoteId:randomUUID()});assert.equal(r.status,409);assert.equal((await r.json()).code,'PAID_SPEC_UNAVAILABLE');
 }
 await balances(127,0,23);assert.equal(calls.length,0);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);
});

test('public quote is unavailable when budget is disabled, scoped or exhausted and does not reserve credits',opts,async()=>{
 for(const config of [{enabled:false,capMinor:1368},{enabled:true,capMinor:0},{enabled:true,capMinor:1368,scope:{jobId:randomUUID(),grantId:randomUUID()}}]){
  const b=(await getGenerationBudget(database()))!;
  await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:b.revision,...config,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:quote-capacity'}));
  const q=await quote();assert.equal(q.available,false);assert.equal(q.reason,'GENERATION_COST_UNAVAILABLE');
 }
 await balances(127,0,23);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);assert.equal(calls.length,0);
});

test('owner with an old consumed pilot can complete two ordinary paid jobs; repeats capture once per task',opts,async()=>{
 const old=await job(previousJobId);
 let available=127,consumed=23;
 for(let i=0;i<2;i++){
  requestId=randomUUID();const x=input(),q=await quote();assert.equal(q.available,true);
  const created=await Promise.all(Array.from({length:4},()=>request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId})));
  assert.deepEqual(created.map(r=>r.status).sort(),[200,200,200,201]);available-=23;await balances(available,23,consumed);
  assert.equal(await auditCount('generation-pilot-created'),0);
  status='success';taskId='synthetic-task-'+i;
  await Promise.all([processJob(requestId,provider,true,true,allow),processJob(requestId,provider,true,true,allow)]);
  await pollJob(requestId,provider,true);consumed+=23;await balances(available,0,consumed);
  assert.equal(await auditCount('automation-delivery'),1);assert.equal((await job()).creditState,'consumed');
 }
 assert.equal(calls.filter(x=>x.method==='POST').length,2);assert.deepEqual(await job(previousJobId),old);await noManual();
 const summary=await (await request('/billing')).json();assert.equal(summary.generationChargingEnabled,true);assert.equal(summary.generationPilot,null);
 assert.equal((await quote(input(randomUUID()))).available,true);
});

test('ordinary stranger has an independent wallet; failure releases held credits and preserves supplier exposure',opts,async()=>{
 const x=input(randomUUID()),q=await quote(x,stranger);assert.equal(q.available,true);
 const r=await request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId},stranger);assert.equal(r.status,201);
 status='failed';await processJob(x.requestId,provider,true,true,allow);
 const row=await job(x.requestId);assert.equal(row.creditState,'released');
 const other=await walletSummary(stranger.id);assert.equal(other.availableCredits,150);assert.equal(other.reservedCredits,0);
 await balances(127,0,23);assert.equal((await getGenerationCost(database(),x.requestId))!.exposureMinor,456);await noManual();
});

for(const mode of ['expired','blocked','missing'] as const)test('public quote rejects '+mode+' cost rates before reservation',opts,async()=>{
 if(mode==='expired')await pg`UPDATE generation_cost_rates SET valid_from=now()-interval '2 hours',expires_at=now()-interval '1 hour'`;
 if(mode==='blocked')await pg`UPDATE generation_cost_specs SET blocked_reason='synthetic-price-change'`;
 if(mode==='missing')await pg`DELETE FROM generation_cost_specs`;
 const q=await quote();assert.equal(q.available,false);assert.equal(q.reason,'GENERATION_COST_UNAVAILABLE');
 await balances(127,0,23);assert.equal(calls.length,0);
});
test('budget closing after quote rolls back job, quote consumption and customer hold',opts,async()=>{
 const x=input(),q=await quote();assert.equal(q.available,true);
 const b=(await getGenerationBudget(database()))!;
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:b.revision,enabled:false,capMinor:b.capMinor,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:emergency-stop'}));
 const r=await request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId});assert.equal(r.status,503);
 assert.equal((await pg`SELECT count(*)::int n FROM video_jobs WHERE id=${requestId}::uuid`)[0].n,0);
 assert.equal((await pg`SELECT job_id FROM video_quotes WHERE id=${q.quoteId}::uuid`)[0].job_id,null);
 await balances(127,0,23);assert.equal(calls.length,0);
});
