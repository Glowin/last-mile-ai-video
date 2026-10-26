import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { database } from '../db';
import type { Transaction } from '../account';
import { jobs } from '../schema';
import { lockWallet, settleCredits } from '../credits/wallet';
import { getGenerationCost, lockGenerationCostBudget, releaseUnsubmittedGenerationCost } from '../costs';

export const POLICY_VERSION = '2026-10-26.1';
export type Job = typeof jobs.$inferSelect;
export type Phase = 'input' | 'output';
export type Review = {
 job_id:string; phase:Phase; version:number; policy_version:string; input_hash:string;
 output_hash:string|null; binding_hash:string; snapshot:Record<string,unknown>;
 state:'pending'|'approved'|'rejected'|'expired'; expires_at:Date; actor:string|null; reason:string|null;
};
export class ModerationError extends Error {
 constructor(public code:string) {super(code);}
}
function canonical(value:unknown):string {
 if(value===null || typeof value!=='object') return JSON.stringify(value);
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 return '{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export function digest(value:unknown) {return createHash('sha256').update(canonical(value)).digest('hex');}
function binding(j:Job) {return digest({id:j.id,fingerprint:j.fingerprint,family:j.family,mode:j.mode,prompt:j.prompt,duration:j.duration,resolution:j.resolution});}
function operator(actor:string,reason:string) {
 if(actor.trim().length<2 || actor.length>200 || reason.trim().length<10 || reason.length>2000) throw new ModerationError('OPERATOR_AND_SPECIFIC_REASON_REQUIRED');
}
export async function currentReview(tx:Transaction,id:string,phase:Phase):Promise<Review|undefined> {
 const [row]=await tx.execute(sql`SELECT * FROM generation_moderation WHERE job_id=${id}::uuid AND phase=${phase} ORDER BY version DESC LIMIT 1`);
 return row as unknown as Review|undefined;
}
/** Rollout is a persisted database boundary, not an environment bypass. Existing
 * jobs keep their prior delivery behavior; reports still hold jobs of any age. */
export async function moderationApplies(tx:Transaction,j:Job):Promise<boolean> {
 const [r]=await tx.execute(sql`SELECT started_at FROM generation_moderation_rollout WHERE id=true`);
 if(!r) throw new ModerationError('MODERATION_ROLLOUT_MISSING');
 return j.createdAt>=new Date(String(r.started_at));
}
export async function hasModerationHold(tx:Transaction,id:string):Promise<boolean> {
 if(await hasOpenContentCase(tx,id)) return true;
 const [r]=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM generation_moderation m WHERE job_id=${id}::uuid
  AND version=(SELECT max(x.version) FROM generation_moderation x WHERE x.job_id=m.job_id AND x.phase=m.phase)
  AND state IN ('pending','rejected','expired')) AS held`);
 return r.held===true;
}
async function enqueue(tx:Transaction,j:Job,phase:Phase,snapshot:Record<string,unknown>,inputHash:string,outputHash:string|null) {
 const previous=await currentReview(tx,j.id,phase);
 if(previous && previous.policy_version===POLICY_VERSION && previous.binding_hash===binding(j) && previous.input_hash===inputHash && previous.output_hash===outputHash && digest(previous.snapshot)===digest(snapshot)) return previous;
 if(previous && ['rejected','expired'].includes(previous.state)) throw new ModerationError('REVIEW_TERMINAL_CREATE_NEW_JOB');
 const [row]=await tx.execute(sql`INSERT INTO generation_moderation(job_id,phase,version,policy_version,input_hash,output_hash,binding_hash,snapshot,expires_at)
 VALUES(${j.id}::uuid,${phase},${(previous?.version??0)+1},${POLICY_VERSION},${inputHash},${outputHash},${binding(j)},${JSON.stringify(snapshot)}::jsonb,now()+interval '24 hours') RETURNING *`);
 await tx.update(jobs).set({reviewRequired:true,resultUrl:null,deliveryVerifiedAt:null,updatedAt:new Date()}).where(eq(jobs.id,j.id));
 return row as unknown as Review;
}
/** Caller must hold job FOR UPDATE before invoking, in the same claim transaction.
 * Return approved only for these exact inputs. No network call or credit capture here. */
export async function ensureInputReview(tx:Transaction,j:Job):Promise<Review> {
 if(await hasOpenContentCase(tx,j.id)) throw new ModerationError('CONTENT_CASE_HOLD');
 if(!j.payload || j.submissionStartedAt || j.upstreamId) throw new ModerationError('INPUT_REVIEW_REQUIRES_UNSUBMITTED_PAYLOAD');
 const snapshot={jobId:j.id,binding:binding(j),payload:j.payload,policyVersion:POLICY_VERSION};
 return enqueue(tx,j,'input',snapshot,digest(snapshot),null);
}
export type OutputCandidate = {providerTaskId:string;url:string;contentSha256:string};
/** Caller holds the wallet (paid), job lock and a valid worker lease. Verified full
 * video bytes must yield contentSha256; never supply a URL/header-only hash. */
export async function stageOutputReview(tx:Transaction,j:Job,candidate:OutputCandidate):Promise<Review> {
 const u=new URL(candidate.url);
 if(u.protocol!=='https:' || u.username || u.password || !/^[a-f0-9]{64}$/.test(candidate.contentSha256) || !candidate.providerTaskId || j.upstreamId && j.upstreamId!==candidate.providerTaskId) throw new ModerationError('INVALID_OUTPUT_EVIDENCE');
 const input=await currentReview(tx,j.id,'input');
 if(!input || input.state!=='approved' || input.policy_version!==POLICY_VERSION || input.binding_hash!==binding(j)) throw new ModerationError('INPUT_APPROVAL_REQUIRED');
 const snapshot={jobId:j.id,inputVersion:input.version,inputHash:input.input_hash,...candidate,policyVersion:POLICY_VERSION};
 const review=await enqueue(tx,j,'output',snapshot,input.input_hash,digest(snapshot));
 // Hold the upstream success privately. Public state must not claim a failed generation.
 if(review.state==='pending') await tx.update(jobs).set({status:'unknown',upstreamId:candidate.providerTaskId,payload:null,resultUrl:null,deliveryVerifiedAt:null,reviewRequired:true,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,j.id));
 return review;
}
export type Decision = {jobId:string;phase:Phase;version:number;inputHash:string;outputHash:string|null;decision:'approved'|'rejected'|'expired';actor:string;reason:string;viewedContentSha256?:string};
/** Host-authenticated operator only. Exact version/hash compare + serialized job lock.
 * Caller supplies evidence from the exported review, never just a bare job ID. */
export async function decideReview(d:Decision) {
 operator(d.actor,d.reason);
 return database().transaction(async tx=>{
  await lockGenerationCostBudget(tx);
  const [initial]=await tx.select().from(jobs).where(eq(jobs.id,d.jobId));
  if(!initial) throw new ModerationError('JOB_NOT_FOUND');
  if(initial.billingMode==='paid') await lockWallet(tx,initial.owner,initial.creditEnvironment!);
  const [j]=await tx.select().from(jobs).where(eq(jobs.id,d.jobId)).for('update');
  const r=await currentReview(tx,j.id,d.phase);
  if(!r || r.version!==d.version || r.input_hash!==d.inputHash || r.output_hash!==d.outputHash || r.binding_hash!==binding(j) || r.policy_version!==POLICY_VERSION) throw new ModerationError('STALE_REVIEW');
  if(r.state!=='pending') {
   if(r.state===d.decision && r.actor===d.actor.trim() && r.reason===d.reason.trim()) return r;
   throw new ModerationError('REVIEW_ALREADY_DECIDED');
  }
  const [clock]=await tx.execute(sql`SELECT clock_timestamp() AS at`);
  const now=new Date(String(clock.at));
  if(d.decision==='expired' && new Date(r.expires_at)>now) throw new ModerationError('REVIEW_NOT_EXPIRED');
  if(d.decision!=='expired' && new Date(r.expires_at)<=now) throw new ModerationError('REVIEW_EXPIRED');
  if(d.phase==='input' && (j.submissionStartedAt || j.upstreamId || !j.payload || digest({jobId:j.id,binding:binding(j),payload:j.payload,policyVersion:POLICY_VERSION})!==r.input_hash)) throw new ModerationError('STALE_INPUT');
  if(d.phase==='output') {
   const input=await currentReview(tx,j.id,'input');
   if(!input || input.state!=='approved' || input.version!==r.snapshot.inputVersion || input.input_hash!==r.input_hash || j.upstreamId!==r.snapshot.providerTaskId) throw new ModerationError('STALE_OUTPUT');
   if(d.decision==='approved' && d.viewedContentSha256!==r.snapshot.contentSha256) throw new ModerationError('VIEWED_VIDEO_HASH_REQUIRED');
  }
  if(d.decision==='approved' && await hasOpenContentCase(tx,j.id)) throw new ModerationError('CONTENT_CASE_HOLD');
  const rejected=d.decision!=='approved';
  if(rejected && d.phase==='input' && !j.submissionStartedAt && !j.upstreamId) {
   const cost=await getGenerationCost(tx,j.id);
   if(cost?.state==='held') await releaseUnsubmittedGenerationCost(tx,{jobId:j.id,actor:d.actor.trim(),evidenceRef:'moderation-input-'+d.decision});
  }
  let creditState=j.creditState;
  if(creditState==='reserved' && (rejected || d.phase==='output')) {
   creditState=rejected?'released':'consumed';
   await settleCredits(tx,j.id,creditState);
  }
  // Never recharge a previously released reservation, even on a late output approval.
  const delivered=d.decision==='approved' && d.phase==='output';
  await tx.update(jobs).set({creditState,reviewRequired:rejected,
   ...(rejected?{status:'unknown' as const,resultUrl:null,deliveryVerifiedAt:null}:{}),
   ...(delivered?{status:'success' as const,resultUrl:String(r.snapshot.url),deliveryVerifiedAt:new Date(),payload:null}:{}),
   leaseToken:null,leaseUntil:null,nextPollAt:new Date(),updatedAt:new Date(),
  }).where(eq(jobs.id,j.id));
  const [done]=await tx.execute(sql`UPDATE generation_moderation SET state=${d.decision},actor=${d.actor.trim()},reason=${d.reason.trim()},decided_at=now() WHERE job_id=${j.id}::uuid AND phase=${d.phase} AND version=${d.version} AND state='pending' RETURNING *`);
  await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${j.id}::uuid,${'moderation-'+d.phase+'-'+d.decision},${d.actor.trim()},${d.reason.trim()})`);
  return done as unknown as Review;
 });
}
/** Safe public summary. Never serialize private snapshot/URLs in a pending response. */
export async function publicModeration(id:string) {
 const rows=await database().execute(sql`SELECT DISTINCT ON (phase) phase,state,version FROM generation_moderation WHERE job_id=${id}::uuid ORDER BY phase,version DESC`);
 return rows.map(r=>({phase:r.phase,state:r.state,version:r.version}));
}
export async function listReviews() {
 return database().execute(sql`SELECT m.job_id,m.phase,m.version,m.state,m.input_hash,m.output_hash,m.created_at,m.expires_at FROM generation_moderation m WHERE version=(SELECT max(x.version) FROM generation_moderation x WHERE x.job_id=m.job_id AND x.phase=m.phase) AND m.state='pending' ORDER BY m.created_at LIMIT 100`);
}

export async function hasOpenContentCase(tx:Transaction,id:string):Promise<boolean> {
 const [r]=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM moderation_cases WHERE job_id=${id}::uuid AND status='open' AND category IN ('content','rights','privacy')) AS held`);
 return r.held===true;
}
/** A resolved report does not restore delivery. Start a new output review explicitly,
 * then inspect/export and decide its new version using the normal CLI. */
export async function reopenOutputReview(id:string,actor:string,reason:string) {
 operator(actor,reason);
 return database().transaction(async tx=>{
  const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for('update');
  if(!j) throw new ModerationError('JOB_NOT_FOUND');
  if(await hasOpenContentCase(tx,id)) throw new ModerationError('CONTENT_CASE_HOLD');
  const r=await currentReview(tx,id,'output');
  if(!r || r.state==='pending' || r.binding_hash!==binding(j) || r.policy_version!==POLICY_VERSION || j.upstreamId!==r.snapshot.providerTaskId) throw new ModerationError('OUTPUT_REVIEW_NOT_REOPENABLE');
  const [next]=await tx.execute(sql`INSERT INTO generation_moderation(job_id,phase,version,policy_version,input_hash,output_hash,binding_hash,snapshot,expires_at)
   VALUES(${id}::uuid,'output',${r.version+1},${POLICY_VERSION},${r.input_hash},${r.output_hash},${r.binding_hash},${JSON.stringify(r.snapshot)}::jsonb,now()+interval '24 hours') RETURNING *`);
  await tx.update(jobs).set({status:'unknown',reviewRequired:true,resultUrl:null,deliveryVerifiedAt:null,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,id));
  await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${id}::uuid,'moderation-output-reopened',${actor.trim()},${reason.trim()})`);
  return next as unknown as Review;
 });
}
