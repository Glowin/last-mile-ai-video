import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { jobs } from "../schema";
import { ProviderError, providerRequest, safeResultUrl, type ProviderTask } from "../provider";
import { lockWallet, settleCredits } from "../credits/wallet";
import { assertPilotSubmission, pilotPostAllowed } from "../credits/pilot";
import type { GenerationPilot } from "../credits/config";
import { verifyVideoDelivery, verifyVideoContent, type VerifiedVideoContent } from "./delivery";
import { ensureInputReview, stageOutputReview, moderationApplies, hasModerationHold } from "../moderation/service";
import { getAutomation, isMvp, advanceAutomation, automationMaySubmit, automationPostAllowed, authorizeAutomationPost,
  cancelUnsentAutomationClaim, recordAutomationDelivery, noteAutomationCancellation, stopAutomation, type PromptScanner } from "../moderation/automation";
import { GenerationCostError, getGenerationCost, lockGenerationCostBudget,
  markGenerationSubmission, releaseUnsubmittedGenerationCost, cancelUnsentPilotCost, recordGenerationOutcome } from "../costs";
export type VideoProvider = {
  kind: "live" | "fake";
  request: (path:string, options?:RequestInit)=>Promise<ProviderTask>;
  verifyDelivery: (url:string)=>Promise<boolean>;
  verifyContent?: (url:string)=>Promise<VerifiedVideoContent|null>;
};
export const liveVideoProvider: VideoProvider=Object.freeze({kind:"live",request:providerRequest,verifyDelivery:verifyVideoDelivery,verifyContent:verifyVideoContent});
export type JobRow=typeof jobs.$inferSelect;
const leaseMs=120_000;
/** Claim commits before I/O. A dead worker's started submission is ONLY looked up. */
export async function claimJob(id:string, provider:VideoProvider, force=false, allowSubmission=true) {
  return database().transaction(async tx=>{
    if(provider.kind==='live') await lockGenerationCostBudget(tx);
    const [initial]=await tx.select().from(jobs).where(eq(jobs.id,id));
    if(!initial) return null;
    if(initial.billingMode==='paid') await lockWallet(tx,initial.owner,initial.creditEnvironment!);
    const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for("update");
    if(!j || ['success','failed'].includes(j.status) || j.reviewRequired&&!force || j.leaseUntil&&j.leaseUntil>new Date() || !force&&j.nextPollAt>new Date()) return null;
    if(j.creditEnvironment==='test' && provider.kind!=='fake') return null;
    if(j.creditEnvironment==='live' && provider.kind!=='live') return null;
    if(await hasModerationHold(tx,j.id)) return null;
    const automation=await getAutomation(tx,j.id);
    const automated=isMvp(automation);
    const reviewOutput=automated || provider.kind==='live' && await moderationApplies(tx,j);
    const unstarted=!j.submissionStartedAt && !j.upstreamId;
    let submit=unstarted && j.status==='submitting' && !!j.payload;
    let pilotAuthorization: GenerationPilot | undefined;
    // A prior local rejection remains a hold even under force/recovery.
    if(!j.submissionStartedAt && j.reviewRequired) return null;
    // A read/recover endpoint cannot turn an unstarted row into a new provider request.
    // Leave it untouched for the submission worker, including its lease and payload.
    if((submit || provider.kind==='live' && unstarted) && !allowSubmission) return null;
    if(unstarted && automated && !await automationMaySubmit(tx,j,automation)) return null;
    if(submit && reviewOutput && !automated) {
      const inputReview=await ensureInputReview(tx,j);
      if(inputReview.state!=='approved') return null;
    }
    if(unstarted && provider.kind==='live') {
      try {
        if(j.billingMode==='paid') pilotAuthorization=await assertPilotSubmission(tx,j);
        // No historical backfill here: a legacy unstarted job without a snapshot
        // is locally held and released, never grandfathered into a paid POST.
        if(!submit && (await getGenerationCost(tx,j.id))?.state!=='submitted') throw new GenerationCostError('COST_JOB_INPUT_MISSING');
        const permission=await markGenerationSubmission(tx,j.id);
        submit=permission.maySubmit;
      } catch(error) {
        if(!(error instanceof GenerationCostError)) throw error;
        const cost=await getGenerationCost(tx,j.id);
        // A committed submission is ambiguous even if the job marker is absent.
        // Never release possibly incurred supplier costs or retry that POST.
        if(cost?.state==='submitted') throw error;
        if(automated) {
          await stopAutomation(tx,j,automation,'canceled','GENERATION_NOT_STARTED');
          return null;
        }
        if(cost?.state==='held') await releaseUnsubmittedGenerationCost(tx,{
          jobId:j.id,actor:'worker',evidenceRef:`local-pre-submit:${error.code}`,
        });
        if(j.billingMode==='paid' && j.creditState==='reserved') await settleCredits(tx,j.id,'released');
        await tx.update(jobs).set({status:'unknown',reviewRequired:true,
          creditState:j.creditState==='reserved'?'released':j.creditState,
          payload:null,leaseToken:null,leaseUntil:null,updatedAt:new Date(),
        }).where(eq(jobs.id,j.id));
        await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason)
          VALUES(${randomUUID()}::uuid,${j.id}::uuid,'cost-local-rejection','worker',${error.code})`);
        return null; // Commit releases and audit, then return without any provider I/O.
      }
    }
    const [claimed]=await tx.update(jobs).set({leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+leaseMs),...((submit || provider.kind==='live'&&unstarted)?{submissionStartedAt:new Date()}:{}),nextPollAt:new Date(Date.now()+leaseMs)}).where(eq(jobs.id,id)).returning();
    return {job:claimed,submit,reviewOutput,pilotAuthorization,automation:automated?automation:null};
  });
}
export async function finishClaim(j:JobRow, outcome:{task?:ProviderTask;verified?:boolean;contentSha256?:string;definitiveFailure?:boolean}, provider:VideoProvider=liveVideoProvider) {
  return database().transaction(async tx=>{
    if(provider.kind==='live' && j.creditEnvironment!=='test') await lockGenerationCostBudget(tx);
    if(j.billingMode==='paid') await lockWallet(tx,j.owner,j.creditEnvironment!);
    const [current]=await tx.select().from(jobs).where(eq(jobs.id,j.id)).for('update');
    if(!current || current.leaseToken!==j.leaseToken || !current.leaseUntil || current.leaseUntil<=new Date()) return current;
    if(await hasModerationHold(tx,current.id)) return current;
    const task=outcome.task;
    if(current.upstreamId && task && current.upstreamId!==task.id) throw new Error('Provider task identity mismatch');
    const automation=await getAutomation(tx,current.id);
    const automated=isMvp(automation);
    const success=task?.status==='success' && outcome.verified===true && !!task.data?.[0] && safeResultUrl(task.data[0].url);
    const failed=outcome.definitiveFailure || task?.status==='failed';
    const review=!success&&!failed && Date.now()-current.createdAt.getTime()>=24*3600_000;
    if(provider.kind==='live' && current.creditEnvironment!=='test') {
      const cost=await getGenerationCost(tx,current.id);
      // Legacy submitted jobs remain queryable without inventing a cost snapshot.
      if(cost?.state==='submitted') await recordGenerationOutcome(tx,{
        jobId:current.id,outcome:success?'success':failed?'failed':'unknown',evidenceRef:'provider-task-status',
      });
      // No actualMinor inference from HTTP codes, task status, or delivery.
    }
    if(success && automated) await recordAutomationDelivery(tx,current,outcome.contentSha256);
    if(success && !automated && provider.kind==='live' && await moderationApplies(tx,current)) {
      if(!outcome.contentSha256) throw new Error('Complete output evidence required');
      await stageOutputReview(tx,current,{providerTaskId:task!.id,url:task!.data![0].url,contentSha256:outcome.contentSha256});
      return (await tx.select().from(jobs).where(eq(jobs.id,current.id)))[0];
    }
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
/** Only the still-owning first claimant can prove transport was never invoked.
 * This is deliberately private and outside processJob's transport error handler. */
async function cancelUnsentPilotClaim(j:JobRow) {
  return database().transaction(async tx=>{
    await lockGenerationCostBudget(tx);
    await lockWallet(tx,j.owner,'live');
    const [current]=await tx.select().from(jobs).where(eq(jobs.id,j.id)).for('update');
    if(!current || !j.leaseToken || current.leaseToken!==j.leaseToken) return current;
    await cancelUnsentPilotCost(tx,{jobId:j.id,leaseToken:j.leaseToken});
    await settleCredits(tx,j.id,'released');
    const [canceled]=await tx.update(jobs).set({status:'failed',creditState:'released',reviewRequired:false,
      submissionStartedAt:null,payload:null,resultUrl:null,deliveryVerifiedAt:null,
      leaseToken:null,leaseUntil:null,updatedAt:new Date(),
    }).where(eq(jobs.id,j.id)).returning();
    await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason)
      VALUES(${randomUUID()}::uuid,${j.id}::uuid,'pilot-unsent-cancellation','worker',
        'Authorization expired or revoked after claim; original claimant did not invoke transport; trial slot remains consumed')`);
    await noteAutomationCancellation(tx,current,'PILOT_AUTHORIZATION_ENDED');
    return canceled;
  });
}
export async function processJob(id:string,provider:VideoProvider=liveVideoProvider,force=false,allowSubmission=true,scanner?:PromptScanner) {
  if(allowSubmission) await advanceAutomation(id,provider.kind,scanner);
  const claim=await claimJob(id,provider,force,allowSubmission);
  if(!claim) return database().query.jobs.findFirst({where:eq(jobs.id,id)});
  const {job:j,submit,reviewOutput,pilotAuthorization,automation}=claim;
  // Prepare potentially large JSON BEFORE the final check. A refusal here is
  // known-unsent, unlike every error after invoking the transport below.
  const submission=submit?{method:'POST',headers:{'Idempotency-Key':j.id},body:JSON.stringify(j.payload)}:undefined;
  if(submit && automation && !await authorizeAutomationPost(j,provider.kind)) return cancelUnsentAutomationClaim(j);
  if(submit && automation && !automationPostAllowed(automation,j)) return cancelUnsentAutomationClaim(j);
  if(submit && pilotAuthorization && !pilotPostAllowed(pilotAuthorization,j)) return cancelUnsentPilotClaim(j);
  try {
    const task=submit
      ? await provider.request('',submission)
      : await provider.request(j.upstreamId?`/${encodeURIComponent(j.upstreamId)}`:`?client_request_id=${encodeURIComponent(j.id)}`);
    if(j.upstreamId && task.id!==j.upstreamId) throw new ProviderError(502);
    if(task.status==='success' && (!task.data?.[0] || !safeResultUrl(task.data[0].url))) throw new ProviderError(502);
    const content=task.status==='success' && !!task.data?.[0] && reviewOutput
      ? await provider.verifyContent?.(task.data[0].url) : null;
    const verified=task.status==='success' && !!task.data?.[0] && (reviewOutput
      ? !!content : await provider.verifyDelivery(task.data[0].url));
    return await finishClaim(j,{task,verified,contentSha256:content?.contentSha256},provider);
  } catch(error) {
    return finishClaim(j,{definitiveFailure:submit && error instanceof ProviderError && [400,401,402,403,404,422].includes(error.status)},provider);
  }
}
/** Polling may settle an existing reservation, but can never initiate generation or reserve credits. */
export async function pollJob(id:string,provider:VideoProvider=liveVideoProvider,force=false) {
  return processJob(id,provider,force,false);
}
export async function workerTick(provider:VideoProvider=liveVideoProvider,limit=8,scanner?:PromptScanner) {
  // Report-held, known-unsubmitted MVP jobs still need bounded cancellation and
  // release. Historical/manual holds and started jobs keep their old behavior.
  const due=await database().select({id:jobs.id}).from(jobs).where(sql`${jobs.status} NOT IN ('success','failed') AND
    (NOT ${jobs.reviewRequired} OR (${jobs.submissionStartedAt} IS NULL AND ${jobs.upstreamId} IS NULL AND EXISTS (
      SELECT 1 FROM generation_automation a WHERE a.job_id=${jobs.id} AND a.policy_version='mvp-text-only-v1'
    ))) AND ${jobs.nextPollAt}<=now() AND (${jobs.leaseUntil} IS NULL OR ${jobs.leaseUntil}<now()) AND (${jobs.creditEnvironment} IS NULL OR ${jobs.creditEnvironment}=${provider.kind==='fake'?'test':'live'})`).orderBy(jobs.nextPollAt).limit(limit);
  for(const j of due) await processJob(j.id,provider,false,true,scanner);
  return due.length;
}
/** Audit-only compensation; no invented failure and no later re-charge. */
export async function releaseForReview(id:string,actor:string,reason:string) {
  if(actor.trim().length<2 || reason.trim().length<10) throw new Error('Supply an operator and a specific audit reason (10+ characters).');
  return database().transaction(async tx=>{
    const [initial]=await tx.select().from(jobs).where(eq(jobs.id,id));
    if(!initial || initial.billingMode!=='paid') throw new Error('Paid job not found.');
    if(initial.creditEnvironment!=='test') await lockGenerationCostBudget(tx);
    await lockWallet(tx,initial.owner,initial.creditEnvironment!);
    const [j]=await tx.select().from(jobs).where(eq(jobs.id,id)).for('update');
    if(j.creditState==='released') return j;
    if(j.creditState!=='reserved' || Date.now()-j.createdAt.getTime()<24*3600_000 || ['success','failed'].includes(j.status)) throw new Error('Only unresolved reservations older than 24 hours may be compensated.');
    if(j.creditEnvironment!=='test' && !j.submissionStartedAt && !j.upstreamId) {
      const cost=await getGenerationCost(tx,j.id);
      if(cost?.state==='held') await releaseUnsubmittedGenerationCost(tx,{
        jobId:j.id,actor:actor.trim(),evidenceRef:'operator-release-before-submission',
      });
    }
    await settleCredits(tx,j.id,'released');
    const [updated]=await tx.update(jobs).set({creditState:'released',reviewRequired:true,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,id)).returning();
    await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${id}::uuid,'operator-release',${actor.trim()},${reason.trim()})`);
    return updated;
  });
}
