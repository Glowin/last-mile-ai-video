import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdtemp, chmod, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { database, closeDatabase } from '../src/server/db';
import { jobs } from '../src/server/schema';
import { ensureInputReview, stageOutputReview, decideReview, currentReview, listReviews, publicModeration, reopenOutputReview, digest, type Review, type Decision } from '../src/server/moderation/service';
import { openCase, resolveCase } from '../src/server/moderation/cases';
import { grantPurchase, reserveCredits } from '../src/server/credits/wallet';
const url=process.env.MODERATION_TEST_DATABASE_URL;
const options={skip:!url};
let pg:ReturnType<typeof postgres>;
const originalFetch=global.fetch;
before(async()=>{
 if(!url)return;
 const u=new URL(url);
 assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55444');
 assert.equal(u.username,'kakareel_moderation_55444_test');assert.equal(u.pathname,'/kakareel_moderation_55444_sandbox');
 assert.equal(u.password,'');assert.equal(u.search,'');assert.equal(u.hash,'');
 pg=postgres(url,{onnotice:()=>{}});
 const [i]=await pg`SELECT current_database() db,current_user role`;
 assert.equal(i.db,'kakareel_moderation_55444_sandbox');assert.equal(i.role,'kakareel_moderation_55444_test');
 // Destructive reset only after both URL and live identity checks on our dedicated DB.
 await pg`DROP SCHEMA public CASCADE`;await pg`CREATE SCHEMA public`;
 for(const file of (await readdir(new URL('../db',import.meta.url))).filter(f=>/^\d{4}-.+\.sql$/.test(f)).sort()) await pg.unsafe(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 process.env.DATABASE_URL=url;
 global.fetch=async()=>{throw new Error('External requests forbidden in moderation tests');};
});
after(async()=>{global.fetch=originalFetch;await closeDatabase();if(pg)await pg.end();});
async function seed() {
 const user=randomUUID(),order=randomUUID(),id=randomUUID();
 await pg`INSERT INTO users(id,google_sub,email) VALUES(${user},${user},'synthetic@example.invalid')`;
 await pg`INSERT INTO billing_orders(id,user_id,request_id,product_id,product_name,price_version,provider,environment,merchant_account_id,provider_product_id,amount_minor,subtotal_minor,currency,credits) VALUES(${order},${user},${randomUUID()},'synthetic','synthetic','test','pancake','test','synthetic','synthetic',1900,1900,'USD',150)`;
 await database().transaction(async tx=>{
  await grantPurchase(tx,{userId:user,orderId:order,environment:'test',credits:150,paidAt:new Date()});
  await tx.insert(jobs).values({id,owner:user,family:'seedance',mode:'text',prompt:'synthetic landscape',duration:5,resolution:'720p',fingerprint:digest({prompt:'synthetic landscape'}),payload:{prompt:'synthetic landscape',image_urls:[]},status:'submitting',billingMode:'paid',creditEnvironment:'test',credits:10,creditState:'reserved'});
  await reserveCredits(tx,{userId:user,jobId:id,environment:'test',credits:10});
 });
 return id;
}
async function job(id:string) {return (await database().select().from(jobs).where(eq(jobs.id,id)))[0];}
async function input(id:string) {return database().transaction(async tx=>{const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for('update');return ensureInputReview(tx,j);});}
function decision(r:Review,which:Decision['decision']='approved'):Decision {return {jobId:r.job_id,phase:r.phase,version:r.version,inputHash:r.input_hash,outputHash:r.output_hash,decision:which,actor:'founder-test',reason:'Inspected synthetic policy evidence',viewedContentSha256:String(r.snapshot.contentSha256??'')};}
const contentSha256=digest('synthetic video bytes');
async function output(id:string) {
 await pg`UPDATE video_jobs SET submission_started_at=now(),upstream_id='synthetic-upstream',payload=NULL WHERE id=${id}`;
 return database().transaction(async tx=>{const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for('update');return stageOutputReview(tx,j,{providerTaskId:'synthetic-upstream',url:'https://example.invalid/synthetic.mp4',contentSha256});});
}
test('input is held, deterministic payload hash, canonical key ordering; no network or capture',options,async()=>{
 const id=await seed();const r=await input(id);const j=await job(id);
 assert.equal(r.state,'pending');assert.equal(j.reviewRequired,true);assert.equal(j.submissionStartedAt,null);assert.equal(j.creditState,'reserved');assert.equal(j.resultUrl,null);
 assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));
 const again=await input(id);assert.equal(again.version,r.version);
 assert.ok((await listReviews()).some(r=>r.job_id===id));
 assert.ok(!(JSON.stringify(await publicModeration(id))).includes('snapshot'));
});
test('changed input invalidates earlier approval, exact version/hash required',options,async()=>{
 const id=await seed(),r=await input(id);await decideReview(decision(r));
 await pg`UPDATE video_jobs SET payload='{"prompt":"changed input"}'::jsonb WHERE id=${id}`;
 const newer=await input(id);assert.equal(newer.version,2);assert.notEqual(newer.input_hash,r.input_hash);
 await assert.rejects(decideReview(decision(r)),/STALE_REVIEW/);
 assert.equal((await job(id)).reviewRequired,true);
 await assert.rejects(decideReview({...decision(newer),inputHash:'0'.repeat(64)}),/STALE_REVIEW/);
});
test('input approve wakes queue, output stays private until actual reviewed-byte hash matches',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));
 assert.equal((await job(id)).reviewRequired,false);
 const r=await output(id);const held=await job(id);
 assert.equal(held.status,'unknown');assert.equal(held.resultUrl,null);assert.equal(held.creditState,'reserved');
 await assert.rejects(decideReview({...decision(r),viewedContentSha256:'0'.repeat(64)}),/VIEWED_VIDEO_HASH_REQUIRED/);
 await decideReview(decision(r));
 const done=await job(id);assert.equal(done.status,'success');assert.equal(done.creditState,'consumed');assert.ok(done.resultUrl);
 const [a]=await pg`SELECT count(*)::int n FROM credit_audit WHERE job_id=${id} AND action='moderation-output-approved'`;assert.equal(a.n,1);
});
test('concurrent approval is idempotent, competing rejection cannot double settle',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));const r=await output(id);
 await Promise.all(Array.from({length:8},()=>decideReview(decision(r))));
 await assert.rejects(decideReview(decision(r,'rejected')),/ALREADY_DECIDED/);
 const [b]=await pg`SELECT b.consumed,b.reserved FROM credit_batches b JOIN credit_allocations a ON a.order_id=b.order_id WHERE a.job_id=${id}`;
 assert.equal(b.consumed,10);assert.equal(b.reserved,0);
});
test('input rejection releases once without upstream failure or permission to resubmit',options,async()=>{
 const id=await seed(),r=await input(id);
 await Promise.all([decideReview(decision(r,'rejected')),decideReview(decision(r,'rejected'))]);
 const j=await job(id);assert.equal(j.status,'unknown');assert.equal(j.creditState,'released');assert.equal(j.reviewRequired,true);assert.equal(j.submissionStartedAt,null);
 assert.equal((await input(id)).state,'rejected');
});
test('output rejection releases reservation without pretending provider failed',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));await decideReview(decision(await output(id),'rejected'));
 const j=await job(id);assert.equal(j.status,'unknown');assert.equal(j.creditState,'released');assert.equal(j.resultUrl,null);assert.equal(j.upstreamId,'synthetic-upstream');
});
test('expired review only releases via explicit audited expiry, no approval after deadline',options,async()=>{
 const id=await seed(),r=await input(id);
 await assert.rejects(decideReview(decision(r,'expired')),/NOT_EXPIRED/);
 await pg`UPDATE generation_moderation SET expires_at=now()-interval '1 minute' WHERE job_id=${id}`;
 await assert.rejects(decideReview(decision(r)),/REVIEW_EXPIRED/);
 await decideReview(decision(r,'expired'));
 assert.equal((await job(id)).creditState,'released');assert.equal((await job(id)).status,'unknown');
});
test('input policy/version identity must be approved before staging output',options,async()=>{
 const id=await seed();await input(id);
 await assert.rejects(output(id),/INPUT_APPROVAL_REQUIRED/);
});
test('a report holds delivery; resolving correspondence cannot approve or restore a video',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));const r=await output(id);
 const c=await openCase({sourceReference:'synthetic:'+id,category:'content',summary:'Synthetic report requires a human review',actor:'founder-test',jobId:id});
 await assert.rejects(decideReview(decision(r)),/CONTENT_CASE_HOLD/);
 await resolveCase(String(c.id),'founder-test','Investigated synthetic report and recorded outcome');
 assert.equal((await job(id)).resultUrl,null);await decideReview(decision(r));
 const second=await openCase({sourceReference:'synthetic-second:'+id,category:'rights',summary:'Synthetic rights report requires review',actor:'founder-test',jobId:id});
 assert.equal((await job(id)).resultUrl,null);
 await resolveCase(String(second.id),'founder-test','Verified synthetic rights evidence and closed report');
 const reopened=await reopenOutputReview(id,'founder-test','Reinspect exact video after resolving report');
 assert.equal(reopened.version,r.version+1);await assert.rejects(decideReview(decision(r)),/STALE_REVIEW/);
 await decideReview(decision(reopened));
 const [b]=await pg`SELECT consumed FROM credit_batches b JOIN credit_allocations a ON a.order_id=b.order_id WHERE a.job_id=${id}`;assert.equal(b.consumed,10);
});
test('late reconsideration after release never recharges credits',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));const r=await output(id);await decideReview(decision(r,'rejected'));
 const reopened=await reopenOutputReview(id,'founder-test','New evidence warrants synthetic output reconsideration');
 await decideReview(decision(reopened));assert.equal((await job(id)).creditState,'released');assert.equal((await job(id)).status,'success');
});
test('payload changed after export cannot receive approval; new version must be reviewed',options,async()=>{
 const id=await seed(),r=await input(id);await pg`UPDATE video_jobs SET payload='{"prompt":"different"}' WHERE id=${id}`;
 await assert.rejects(decideReview(decision(r)),/STALE_INPUT/);assert.equal((await job(id)).creditState,'reserved');
});
test('case repeated with same source is idempotent; conflicting data rejected',options,async()=>{
 const id=await seed();const p={sourceReference:'synthetic-case:'+id,category:'account' as const,summary:'Synthetic account support question',actor:'founder-test',jobId:id};
 const a=await openCase(p),b=await openCase(p);assert.equal(a.id,b.id);
 await assert.rejects(openCase({...p,summary:'Different case cannot replace original'}),/CONFLICT/);
});

test('conflicting concurrent decisions serialize to one terminal state and one settlement',options,async()=>{
 const id=await seed();await decideReview(decision(await input(id)));const r=await output(id);
 const outcomes=await Promise.allSettled([decideReview(decision(r)),decideReview(decision(r,'rejected'))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const j=await job(id);assert.ok(['consumed','released'].includes(j.creditState));
 const [n]=await pg`SELECT count(*)::int n FROM credit_audit WHERE job_id=${id} AND action LIKE 'moderation-output-%'`;assert.equal(n.n,1);
});
test('private CLI selects explicit database, exports privately, rejects unsafe permissions and approves exact review',options,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kakareel-moderation-cli-'));await chmod(dir,0o700);
 const config=join(dir,'operator.json'),review=join(dir,'review.json');
 const id=await seed();await input(id);
 await writeFile(config,JSON.stringify({databaseUrl:url,operator:'founder-cli-test'}),{mode:0o600});
 async function run(...args:string[]) {
  return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx','scripts/moderation-review.ts',config,...args],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,NODE_ENV:'test'}});
   let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));
  });
 }
 try {
  const q=await run('queue');assert.equal(q.code,0,q.stderr);assert.ok(!q.stdout.includes('synthetic landscape'));
  const e=await run('export',id,'input',review);assert.equal(e.code,0,e.stderr);assert.equal((await stat(review)).mode&0o077,0);
  const approved=await run('decide',review,'approved','Inspected every synthetic input and settings');assert.equal(approved.code,0,approved.stderr);assert.equal((await job(id)).reviewRequired,false);
  await chmod(config,0o644);const bad=await run('queue');assert.equal(bad.code,1);assert.ok(!bad.stderr.includes(url!));
 } finally {await rm(dir,{recursive:true,force:true});}
});
