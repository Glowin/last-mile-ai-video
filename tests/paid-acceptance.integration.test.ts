import { Hono } from 'hono';
import { createBillingModule } from '../src/server/billing/routes';
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
import { walletSummary, grantPurchase, reserveCredits, settleCredits, lockWallet } from '../src/server/credits/wallet';
import { generationFingerprint } from '../src/server/credits/quotes';
import { productionChargingPolicy } from '../src/server/credits/config';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { configureGenerationBudget, confirmGenerationRate, getGenerationCost, getGenerationBudget } from '../src/server/costs';
import { processJob, pollJob, releaseForReview, type VideoProvider } from '../src/server/jobs/runner';
import { issuePaidAcceptance, revokePaidAcceptance, acceptanceGrant } from '../src/server/credits/acceptance';
import { reserveGenerationCost } from '../src/server/costs';
import { runPaidAcceptanceAdmin } from '../scripts/paid-generation-acceptance-admin';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fresh disposable DB ONLY. Never inherits DATABASE_URL or loads configuration files.
const url=process.env.PAID_ACCEPTANCE_TEST_DATABASE_URL;
const opts={skip:!url,timeout:30_000};
const dbName='kakareel_acceptance_55451_sandbox',role='kakareel_acceptance_55451_test';
const origin='https://automation.example.invalid', secret='synthetic-automation-session-secret-for-isolated-tests';
const keys=['DATABASE_URL','APP_URL','SESSION_SECRET','VIBETOKEN_API_KEY','DEMO_ACCESS_CODE','GENERATION_LIVE_PILOT_USER_ID','GENERATION_LIVE_PILOT_REQUEST_ID','GENERATION_LIVE_PILOT_EXPIRES_AT','GENERATION_REVIEW_POLICY','GENERATION_MVP_AUTOMATION_ENABLED','GENERATION_REVIEW_MAX_WAIT_SECONDS','GENERATION_REVIEW_MAX_ATTEMPTS','GENERATION_REVIEW_TIMEOUT_MS','GENERATION_PAID_ACCEPTANCE_ENABLED'] as const;
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
const realNow=Date.now.bind(Date);let clock=realNow();
let pg:ReturnType<typeof postgres>, initialized=false;
type Actor={id:string;cookie:string};
let owner:Actor,stranger:Actor,requestId:string,previousJobId:string,grantId:string;
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
 return (path.startsWith('/billing') ? new Hono().basePath('/api').route('/billing',createBillingModule({generationChargingEnabled:false}).routes) : createApp({charging:{enabled:false,environment:'live'},videoProvider:provider})).request(`${origin}/api${path}`,{method,headers:{cookie:who.cookie,origin,'content-type':'application/json','X-KakaReel-Owner':who.id,...headers},...(body?{body:JSON.stringify(body)}:{})});
}
async function quote(x=input(),who=owner){const r=await request('/jobs/quote','POST',x,who);assert.equal(r.status,200);return r.json();}
async function create(x=input()) {const q=await quote(x);assert.equal(q.available,true);assert.equal(q.credits,23);const r=await request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await r.json()).job;}
async function job(id=requestId){const j=await database().query.jobs.findFirst({where:eq(jobs.id,id)});assert.ok(j);return j;}
async function balances(available:number,reserved:number,consumed:number){const b=await walletSummary(owner.id);assert.equal(b.availableCredits,available);assert.equal(b.reservedCredits,reserved);const [r]=await pg`SELECT coalesce(sum(consumed),0)::int AS n FROM credit_batches WHERE user_id=${owner.id}::uuid`;assert.equal(r.n,consumed);}
async function auditCount(action:string){const [r]=await pg`SELECT count(*)::int AS n FROM credit_audit WHERE job_id=${requestId}::uuid AND action=${action}`;return r.n;}

before(async()=>{
 if(!url)return;
 const u=new URL(url);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55451');assert.equal(u.pathname,`/${dbName}`);assert.equal(u.username,role);assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
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
 process.env.GENERATION_PAID_ACCEPTANCE_ENABLED='true';
 for(const who of [owner,stranger]){
  const id=randomUUID();await database().insert(billingOrders).values({id,userId:who.id,requestId:randomUUID(),productId:'synthetic',productName:'synthetic',priceVersion:'synthetic',provider:'pancake',environment:'live',merchantAccountId:'synthetic',providerProductId:'synthetic',amountMinor:1900,subtotalMinor:1900,currency:'USD',credits:150,status:'paid'});
  await database().transaction(tx=>grantPurchase(tx,{orderId:id,userId:who.id,environment:'live',credits:150,paidAt:new Date()}));
 }
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:0,enabled:false,capMinor:0,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:budget'}));
 await database().transaction(tx=>confirmGenerationRate(tx,{spec:{provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image',duration:6,resolution:'2K',audio:false,ratio:'adaptive'},expectedRateId:null,maximumMinor:456,sourceRef:'synthetic:rate',observedAt:from(),validFrom:from(),expiresAt:until(),actor:'synthetic'}));
 previousJobId=randomUUID();
 await database().transaction(async tx=>{
  await lockWallet(tx,owner.id,'live');
  await tx.insert(jobs).values({id:previousJobId,owner:owner.id,family:'minimax',mode:'image',prompt:'historical synthetic',duration:6,resolution:'2K',fingerprint:'historical',status:'success',billingMode:'paid',creditEnvironment:'live',credits:23,creditState:'reserved'});
  await reserveCredits(tx,{jobId:previousJobId,userId:owner.id,environment:'live',credits:23});
  await settleCredits(tx,previousJobId,'consumed');
  await tx.update(jobs).set({creditState:'consumed'}).where(eq(jobs.id,previousJobId));
 });
 grantId=(await issue()).grantId;
});
async function issue(overrides:Record<string,unknown>={}) {
 return database().transaction(tx=>issuePaidAcceptance(tx,{userId:owner.id,requestId,previousJobId,expectedRevision:1,
  expiresAt:new Date(Date.now()+15*60_000),actor:'synthetic-owner',evidenceRef:'synthetic:explicit-single-23-credit-456-fen',...overrides}));
}
async function revoke(){await database().transaction(tx=>revokePaidAcceptance(tx,{userId:owner.id.toUpperCase(),grantId:grantId.toUpperCase(),actor:'synthetic-owner',evidenceRef:'synthetic:revoke'}));}

const result=(action:PromptSiftResult['action'],extra:Partial<PromptSiftResult>={}):PromptSiftResult=>({action,requestId:'private-request',reasonCode:'private-reason',semanticStatus:'private-status',retryable:action!=='block',retryAfterMs:null,httpStatus:200,...extra});
const scans:Parameters<PromptScanner>[0][]=[];
const allow:PromptScanner=async x=>{scans.push(x);return result('allow');};
async function auto(){const a=await getAutomation(database(),requestId);assert.ok(a);return a;}
async function noManual(){assert.equal((await pg`SELECT count(*)::int n FROM generation_moderation`)[0].n,0);}
async function released(){await balances(127,0,23);assert.equal((await job()).status,'failed');assert.equal((await getGenerationCost(database(),requestId))!.state,'released');assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);await noManual();}
beforeEach(()=>{scans.length=0;});


test('owner only fixed offer; unrelated plain-text audits safe; quote binds prompt/image and preview cannot use scope',opts,async()=>{
 await pg`INSERT INTO credit_audit(id,action,actor,reason) VALUES(${randomUUID()}::uuid,'unrelated','synthetic','plain text that is not JSON')`;
 const mine=await (await request('/billing')).json();assert.equal(mine.generationChargingEnabled,true);assert.equal(mine.generationPilot.requestId,requestId);assert.equal(mine.checkoutEnabled,false);
 const other=await (await request('/billing','GET',undefined,stranger)).json();assert.equal(other.generationChargingEnabled,false);
 assert.equal((await quote(input(),stranger)).available,false);
 for(const change of [{requestId:randomUUID()},{duration:10},{audio:true},{mode:'text',ratio:'16:9',image:undefined}]) assert.equal((await quote({...input(),...change} as GenerationInput)).available,false);
 const x=input(),q=await quote(x);assert.equal(q.available,true);
 for(const change of [{prompt:'changed'},{image:'data:image/png;base64,iVBORw0KGgoAAAEA'}]){
  const r=await request('/jobs','POST',{...x,...change,billingMode:'paid',quoteId:q.quoteId});assert.equal(r.status,409);assert.equal((await r.json()).code,'QUOTE_MISMATCH');
 }
 const preview=await request('/jobs','POST',x);assert.equal(preview.status,503);assert.equal((await preview.json()).code,'GENERATION_COST_UNAVAILABLE');
 await balances(127,0,23);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);assert.equal(await getGenerationCost(database(),requestId),null);
});
test('concurrent creates/workers reserve and automatically capture exactly once; historical task unchanged',opts,async()=>{
 const old=await job(previousJobId),x=input(),q=await quote();
 const responses=await Promise.all(Array.from({length:5},()=>request('/jobs','POST',{...x,billingMode:'paid',quoteId:q.quoteId})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,200,200,201]);await balances(104,23,23);assert.equal(await auditCount('generation-pilot-created'),1);
 await assert.rejects(database().transaction(tx=>reserveGenerationCost(tx,{jobId:requestId,fingerprint:generationFingerprint(x),spec:{provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image',duration:6,resolution:'2K',audio:false,ratio:'adaptive'}})),/COST_BUDGET_SCOPE_MISMATCH/);
 status='success';contentAvailable=false;
 await Promise.all([processJob(requestId,provider,true,true,allow),processJob(requestId,provider,true,true,allow)]);
 assert.equal(calls.filter(x=>x.method==='POST').length,1);await balances(104,23,23);assert.equal((await job()).resultUrl,null);
 contentAvailable=true;await Promise.all([pollJob(requestId,provider,true),pollJob(requestId,provider,true)]);await balances(104,0,46);await noManual();
 assert.equal(await auditCount('automation-delivery'),1);assert.deepEqual(await job(previousJobId),old);
 await assert.rejects(issue({requestId:randomUUID(),expectedRevision:2}),/ALREADY_ISSUED/);
 assert.equal((await quote(input(randomUUID()))).available,false);
});
for(const mode of ['block','definitive-failure'] as const)test(mode+' releases customer credits once without reopening grant',opts,async()=>{
 await create();
 if(mode==='definitive-failure')status='failed';
 await processJob(requestId,provider,true,true,mode==='block'?async()=>result('block'):allow);
 await processJob(requestId,provider,true,true,allow);await balances(127,0,23);await noManual();
 assert.equal((await job()).creditState,'released');assert.equal(calls.filter(x=>x.method==='POST').length,mode==='block'?0:1);
 assert.equal((await getGenerationCost(database(),requestId))!.exposureMinor,mode==='block'?0:456);
 await assert.rejects(issue({requestId:randomUUID(),expectedRevision:2}),/ALREADY_ISSUED/);
});
for(const mode of ['expiry','revocation','budget-revision'] as const)test('after committed claim final transaction rejects '+mode,opts,async(t)=>{
 await create();let resume!:()=>void,reached!:()=>void;const pause=new Promise<void>(r=>{reached=r;}),resumeClaim=new Promise<void>(r=>{resume=r;});
 const db=database(),transaction=db.transaction.bind(db);
 const spy=t.mock.method(Object.getPrototypeOf(db) as typeof db,'transaction',(async(fn:Parameters<typeof db.transaction>[0])=>{
  const value=await transaction(fn);const claim=value as {submit?:boolean;job?:{id:string}}|null;
  if(claim?.submit&&claim.job?.id===requestId){reached();await resumeClaim;}return value;
 }) as typeof db.transaction);
 const running=processJob(requestId,provider,true,true,allow);
 await Promise.race([pause,running.then(()=>{throw new Error('Expected committed-claim pause');})]);
 try {
  if(mode==='expiry')clock=Date.parse((await acceptanceGrant(database(),owner.id))!.expiresAt)+1;
  if(mode==='revocation')await revoke();
  if(mode==='budget-revision')await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:2,enabled:true,capMinor:456,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:changed',scope:{jobId:requestId,grantId}}));
 } finally {resume();}
 await running;spy.mock.restore();assert.equal(calls.length,0);await released();
 clock=realNow();await assert.rejects(issue({requestId:randomUUID(),expectedRevision:mode==='budget-revision'?3:2}),/ALREADY_ISSUED/);
});
test('lost POST recovers original once after revocation, disabled budget and restart',opts,async()=>{
 await create();lost=true;await processJob(requestId,provider,true,true,allow);assert.equal((await job()).status,'unknown');await balances(104,23,23);
 await revoke();process.env.GENERATION_PAID_ACCEPTANCE_ENABLED='false';
 await database().transaction(tx=>configureGenerationBudget(tx,{expectedRevision:2,enabled:false,capMinor:456,validFrom:from(),expiresAt:until(),actor:'synthetic',evidenceRef:'synthetic:closed'}));
 await closeDatabase();lost=false;status='success';await pollJob(requestId,provider,true);await pollJob(requestId,provider,true);
 assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal(calls[1].path,`?client_request_id=${requestId}`);await balances(104,0,46);await noManual();
});
test('expired/revoked issued slots cannot be reissued and CLI target mismatch is atomic',opts,async()=>{
 await revoke();assert.equal((await quote()).available,false);await assert.rejects(issue({requestId:randomUUID(),expectedRevision:2}),/ALREADY_ISSUED/);
 const b=await getGenerationBudget(database());
 const dir=await mkdtemp(join(tmpdir(),'kakareel-acceptance-test-'));await chmod(dir,0o700);const path=join(dir,'input.json');
 try {
  await writeFile(path,JSON.stringify({action:'issue',target:{database:'wrong-synthetic-db',role:'wrong-synthetic-role'},userId:stranger.id,requestId:randomUUID(),previousJobId,
    expectedRevision:2,expiresAt:new Date(Date.now()+600_000).toISOString(),actor:'synthetic',evidenceRef:'synthetic:target'}),{mode:0o600});
  await assert.rejects(runPaidAcceptanceAdmin(path),/DATABASE_TARGET_MISMATCH/);
  await chmod(path,0o644);await assert.rejects(runPaidAcceptanceAdmin(path),/INPUT_FILE/);
 } finally {await rm(dir,{recursive:true,force:true});}
 assert.deepEqual(await getGenerationBudget(database()),b);assert.equal(await acceptanceGrant(database(),stranger.id),null);
});
test('concurrent issue lifetime constraint, issuance rollback and budget CAS protect atomic grant',opts,async()=>{
 const user=await actor(),old=randomUUID();
 await pg`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,status,billing_mode,credit_environment,credits,credit_state)
 VALUES(${old}::uuid,${user.id}::uuid,'minimax','image','synthetic',6,'2K','synthetic','success','paid','live',23,'consumed')`;
 const args={userId:user.id,requestId:randomUUID(),previousJobId:old,expectedRevision:2,expiresAt:new Date(Date.now()+600_000),actor:'synthetic',evidenceRef:'synthetic:atomic'};
 const b=await getGenerationBudget(database());
 await assert.rejects(database().transaction(async tx=>{await issuePaidAcceptance(tx,args);throw new Error('synthetic rollback');}),/synthetic rollback/);
 assert.equal(await acceptanceGrant(database(),user.id),null);assert.deepEqual(await getGenerationBudget(database()),b);
 const results=await Promise.allSettled(Array.from({length:4},(_,i)=>database().transaction(tx=>issuePaidAcceptance(tx,i%2?{...args,userId:args.userId.toUpperCase(),requestId:args.requestId.toUpperCase(),previousJobId:args.previousJobId.toUpperCase()}:args))));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await getGenerationBudget(database()))!.revision,3);
 await assert.rejects(database().transaction(tx=>issuePaidAcceptance(tx,{...args,userId:args.userId.toUpperCase(),requestId:randomUUID(),previousJobId:args.previousJobId.toUpperCase(),expectedRevision:3})),/ALREADY_ISSUED/);
});

test('late success after audited 24-hour compensation never charges released credits again',opts,async()=>{
 await create();lost=true;await processJob(requestId,provider,true,true,allow);await revoke();
 await pg`UPDATE video_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=${requestId}::uuid`;
 await releaseForReview(requestId,'synthetic-operator','Synthetic unknown result compensation after twenty-five hours');await balances(127,0,23);
 lost=false;status='success';await pollJob(requestId,provider,true);await pollJob(requestId,provider,true);
 await balances(127,0,23);assert.equal((await job()).creditState,'released');assert.equal(calls.filter(x=>x.method==='POST').length,1);
 assert.equal((await getGenerationCost(database(),requestId))!.exposureMinor,456);
});
test('unused expired grant consumes the lifetime slot, and scope rejects forged owner or billing mode',opts,async()=>{
 const x=input(),spec={provider:'vibetoken',model:'minimax/minimax-h3-i2v',mode:'image' as const,duration:6,resolution:'2K',audio:false,ratio:'adaptive'};
 for(const change of [{ownerId:stranger.id},{billingMode:'preview'},{environment:'test'}]){
  await assert.rejects(database().transaction(tx=>reserveGenerationCost(tx,{jobId:requestId,fingerprint:generationFingerprint(x),spec,grantId,ownerId:owner.id,billingMode:'paid',environment:'live',...change})),/COST_BUDGET_SCOPE_MISMATCH/);
 }
 clock=Date.parse((await acceptanceGrant(database(),owner.id))!.expiresAt)+1;
 assert.equal((await quote()).available,false);assert.equal((await (await request('/billing')).json()).generationChargingEnabled,false);
 await assert.rejects(issue({requestId:randomUUID(),expectedRevision:2,expiresAt:new Date(clock+600_000)}),/ALREADY_ISSUED/);
 await balances(127,0,23);assert.equal((await getGenerationBudget(database()))!.exposureMinor,0);
});
