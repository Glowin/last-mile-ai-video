import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { jobs } from "../schema";
import { ProviderError, providerRequest, type ProviderTask } from "../provider";
import { lockWallet, settleCredits } from "../credits/wallet";
import { verifyVideoDelivery } from "./delivery";
export type VideoProvider = {
  kind: "live" | "fake";
  request: (path:string, options?:RequestInit)=>Promise<ProviderTask>;
  verifyDelivery: (url:string)=>Promise<boolean>;
};
export const liveVideoProvider: VideoProvider=Object.freeze({kind:"live",request:providerRequest,verifyDelivery:verifyVideoDelivery});
export type JobRow=typeof jobs.$inferSelect;
const leaseMs=120_000;
/** Claim commits before I/O. A dead worker's started submission is ONLY looked up. */
export async function claimJob(id:string, provider:VideoProvider, force=false, allowSubmission=true) {
  return database().transaction(async tx=>{
    const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for("update");
    if(!j || ['success','failed'].includes(j.status) || j.reviewRequired&&!force || j.leaseUntil&&j.leaseUntil>new Date() || !force&&j.nextPollAt>new Date()) return null;
    if(j.creditEnvironment==='test' && provider.kind!=='fake') return null;
    if(j.creditEnvironment==='live' && provider.kind!=='live') return null;
    const submit=!j.submissionStartedAt && j.status==='submitting' && !j.upstreamId && !!j.payload;
    // A read/recover endpoint cannot turn an unstarted row into a new provider request.
    // Leave it untouched for the submission worker, including its lease and payload.
    if(submit && !allowSubmission) return null;
    const [claimed]=await tx.update(jobs).set({leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+leaseMs),...(submit?{submissionStartedAt:new Date()}:{}),nextPollAt:new Date(Date.now()+leaseMs)}).where(eq(jobs.id,id)).returning();
    return {job:claimed,submit};
  });
}
export async function finishClaim(j:JobRow, outcome:{task?:ProviderTask;verified?:boolean;definitiveFailure?:boolean}) {
  return database().transaction(async tx=>{
    if(j.billingMode==='paid') await lockWallet(tx,j.owner,j.creditEnvironment!);
    const [current]=await tx.select().from(jobs).where(eq(jobs.id,j.id)).for('update');
    if(!current || current.leaseToken!==j.leaseToken || !current.leaseUntil || current.leaseUntil<=new Date()) return current;
    const task=outcome.task;
    if(current.upstreamId && task && current.upstreamId!==task.id) throw new Error('Provider task identity mismatch');
    const success=task?.status==='success' && outcome.verified===true;
    const failed=outcome.definitiveFailure || task?.status==='failed';
    const review=!success&&!failed && Date.now()-current.createdAt.getTime()>=24*3600_000;
    let creditState=current.creditState;
    if(current.billingMode==='paid' && creditState==='reserved' && (success||failed)) {
      creditState=success?'consumed':'released';
      await settleCredits(tx,current.id,creditState);
    }
    const [updated]=await tx.update(jobs).set({
      status:success?'success':failed?'failed':task?.status==='pending'?'pending':'unknown',
      upstreamId:task?.id??current.upstreamId,
      resultUrl:success?task!.data![0].url:null,
      deliveryVerifiedAt:success?new Date():null,
      creditState,reviewRequired:review,
      // Keep the original input until the remote task is known. Never use it to resubmit.
      payload:task||failed?null:current.payload,
      updatedAt:new Date(),nextPollAt:new Date(Date.now()+15_000),leaseToken:null,leaseUntil:null,
    }).where(and(eq(jobs.id,current.id),eq(jobs.leaseToken,j.leaseToken!))).returning();
    if(review && !current.reviewRequired) await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${j.id}::uuid,'review-required','worker','Unresolved after 24 hours; operator must inspect or release reservation')`);
    return updated;
  });
}
export async function processJob(id:string,provider:VideoProvider=liveVideoProvider,force=false,allowSubmission=true) {
  const claim=await claimJob(id,provider,force,allowSubmission);
  if(!claim) return database().query.jobs.findFirst({where:eq(jobs.id,id)});
  const {job:j,submit}=claim;
  try {
    const task=submit
      ? await provider.request('',{method:'POST',headers:{'Idempotency-Key':j.id},body:JSON.stringify(j.payload)})
      : await provider.request(j.upstreamId?`/${encodeURIComponent(j.upstreamId)}`:`?client_request_id=${encodeURIComponent(j.id)}`);
    if(j.upstreamId && task.id!==j.upstreamId) throw new ProviderError(502);
    const verified=task.status==='success' && !!task.data?.[0] && await provider.verifyDelivery(task.data[0].url);
    return await finishClaim(j,{task,verified});
  } catch(error) {
    return finishClaim(j,{definitiveFailure:submit && error instanceof ProviderError && [400,401,402,403,404,422].includes(error.status)});
  }
}
/** Polling may settle an existing reservation, but can never initiate generation or reserve credits. */
export async function pollJob(id:string,provider:VideoProvider=liveVideoProvider,force=false) {
  return processJob(id,provider,force,false);
}
export async function workerTick(provider:VideoProvider=liveVideoProvider,limit=8) {
  const due=await database().select({id:jobs.id}).from(jobs).where(sql`${jobs.status} NOT IN ('success','failed') AND NOT ${jobs.reviewRequired} AND ${jobs.nextPollAt}<=now() AND (${jobs.leaseUntil} IS NULL OR ${jobs.leaseUntil}<now()) AND (${jobs.creditEnvironment} IS NULL OR ${jobs.creditEnvironment}=${provider.kind==='fake'?'test':'live'})`).orderBy(jobs.nextPollAt).limit(limit);
  for(const j of due) await processJob(j.id,provider);
  return due.length;
}
/** Audit-only compensation; no invented failure and no later re-charge. */
export async function releaseForReview(id:string,actor:string,reason:string) {
  if(actor.trim().length<2 || reason.trim().length<10) throw new Error('Supply an operator and a specific audit reason (10+ characters).');
  return database().transaction(async tx=>{
    const [initial]=await tx.select().from(jobs).where(eq(jobs.id,id));
    if(!initial || initial.billingMode!=='paid') throw new Error('Paid job not found.');
    await lockWallet(tx,initial.owner,initial.creditEnvironment!);
    const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for('update');
    if(j.creditState==='released') return j;
    if(j.creditState!=='reserved' || Date.now()-j.createdAt.getTime()<24*3600_000 || ['success','failed'].includes(j.status)) throw new Error('Only unresolved reservations older than 24 hours may be compensated.');
    await settleCredits(tx,j.id,'released');
    const [updated]=await tx.update(jobs).set({creditState:'released',reviewRequired:true,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,id)).returning();
    await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${id}::uuid,'operator-release',${actor.trim()},${reason.trim()})`);
    return updated;
  });
}
