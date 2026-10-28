import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../account';
import { database } from '../db';
import { jobs } from '../schema';
import { lockWallet, settleCredits } from '../credits/wallet';
import { getGenerationCost, lockGenerationCostBudget, releaseUnsubmittedGenerationCost } from '../costs';
import { hasOpenContentCase, hasModerationHold } from './service';
import { scanPrompt, type PromptSiftResult } from './prompt-sift';
import { MVP_POLICY, reviewPolicy, mvpAutomationEnabled, automationBinding, automationIdentity, type ReviewPolicy } from './policy';

type Job = typeof jobs.$inferSelect;
export type SafetyStatus = 'checking' | 'review' | 'allowed' | 'blocked' | 'expired' | 'error' | 'canceled';
export type Automation = {
  job_id: string; policy_version: string; policy_snapshot: ReviewPolicy; fingerprint: string; binding_hash: string; identity_hash: string;
  idempotency_key: string; max_attempts: number; timeout_ms: number; deadline_at: Date;
  status: SafetyStatus | 'manual'; reason: string | null; attempts: number; next_attempt_at: Date;
  lease_token: string | null; lease_until: Date | null;
  image_review: 'manual' | 'not_applicable' | 'not_reviewed_mvp'; output_review: 'manual' | 'not_reviewed_mvp';
};
export type PromptScanner = (input: { prompt: string; idempotencyKey: string; timeoutMs: number }) => Promise<PromptSiftResult>;
const terminal = new Set(['blocked', 'expired', 'error', 'canceled']);
const date = (x: Date | string) => new Date(x).getTime();
const instant = () => new Date(Date.now());
export async function getAutomation(tx: Pick<Transaction, 'execute'>, id: string): Promise<Automation | null> {
  const [row] = await tx.execute(sql`SELECT * FROM generation_automation WHERE job_id=${id}::uuid`);
  return row ? row as unknown as Automation : null;
}
export function isMvp(a: Automation | null): a is Automation { return a?.policy_version === MVP_POLICY; }
/** NEW insertion only. Called inside job/cost/credit creation; never from recovery. */
export async function createAutomation(tx: Transaction, job: Job, policy = reviewPolicy()) {
  const now = instant(), deadline = new Date(now.getTime() + policy.maxWaitSeconds * 1000);
  await tx.execute(sql`INSERT INTO generation_automation(job_id,policy_version,policy_snapshot,fingerprint,binding_hash,identity_hash,
    idempotency_key,max_attempts,timeout_ms,created_at,deadline_at,status,next_attempt_at,image_review,output_review)
    VALUES(${job.id}::uuid,${policy.version},${JSON.stringify(policy)}::jsonb,${job.fingerprint},${automationBinding(job)},${automationIdentity(job)},
      ${randomUUID()}::uuid,${policy.maxAttempts},${policy.timeoutMs},${now.toISOString()}::timestamptz,${deadline.toISOString()}::timestamptz,
      ${policy.version === MVP_POLICY ? 'checking' : 'manual'},${now.toISOString()}::timestamptz,
      ${job.mode === 'image' ? policy.version === MVP_POLICY ? 'not_reviewed_mvp' : 'manual' : 'not_applicable'},
      ${policy.version === MVP_POLICY ? 'not_reviewed_mvp' : 'manual'})`);
}
export async function publicSafety(id: string) {
  const a = await getAutomation(database(), id);
  return isMvp(a) ? { policyVersion: a.policy_version, status: a.status as SafetyStatus, reason: a.reason,
    attempts: a.attempts, deadlineAt: new Date(a.deadline_at).toISOString(),
    imageReview: a.image_review as 'not_applicable' | 'not_reviewed_mvp', outputReview: 'not_reviewed_mvp' as const } : null;
}
async function audit(tx: Transaction, job: Job, action: string, reason: string) {
  await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason)
    VALUES(${randomUUID()}::uuid,${job.id}::uuid,${action},'automation',${reason})`);
}
/** Caller holds cost -> wallet -> job. This NEVER refunds possibly submitted cost. */
export async function stopAutomation(tx: Transaction, job: Job, a: Automation,
  status: 'blocked' | 'expired' | 'error' | 'canceled', reason: string) {
  if (!isMvp(a) || terminal.has(a.status)) return;
  if (job.submissionStartedAt || job.upstreamId) throw new Error('AUTOMATION_ALREADY_SUBMITTED');
  const cost = await getGenerationCost(tx, job.id);
  if (cost?.state === 'submitted') throw new Error('AUTOMATION_COST_MAY_HAVE_BEEN_CHARGED');
  if (cost?.state === 'held') await releaseUnsubmittedGenerationCost(tx, { jobId: job.id, actor: 'automation', evidenceRef: reason });
  if (job.billingMode === 'paid' && job.creditState === 'reserved') await settleCredits(tx, job.id, 'released');
  await tx.update(jobs).set({ status: 'failed', creditState: job.creditState === 'reserved' ? 'released' : job.creditState,
    reviewRequired: false, payload: null, resultUrl: null, leaseToken: null, leaseUntil: null, updatedAt: instant() }).where(eq(jobs.id, job.id));
  await setTerminal(tx, job, status, reason);
}
async function setTerminal(tx: Transaction, job: Job, status: SafetyStatus, reason: string) {
  await tx.execute(sql`UPDATE generation_automation SET status=${status},reason=${reason},lease_token=NULL,lease_until=NULL WHERE job_id=${job.id}::uuid`);
  await tx.execute(sql`UPDATE generation_automation_attempts SET action='abandoned',reason_code=${reason},finished_at=${instant().toISOString()}::timestamptz
    WHERE job_id=${job.id}::uuid AND finished_at IS NULL`);
  await audit(tx, job, 'automation-' + status, reason);
}
/** Used when a separate pilot/cost gate has already released the unsubmitted job. */
export async function noteAutomationCancellation(tx: Transaction, job: Job, reason: string) {
  const a = await getAutomation(tx, job.id);
  if (isMvp(a) && !terminal.has(a.status)) await setTerminal(tx, job, 'canceled', reason);
}
export function automationPostAllowed(a: Automation, job: Job) {
  return mvpAutomationEnabled() && a.status === 'allowed' && Date.now() < date(a.deadline_at) &&
    automationBinding(job) === a.binding_hash && !!job.leaseUntil && Date.now() < date(job.leaseUntil);
}
/** Last durable send authorization. A report/lease revocation committed before
 * this transaction wins; after its commit the request is authorized/in flight.
 * DB commit and remote transport cannot be atomic. No network runs in this tx. */
export async function authorizeAutomationPost(job: Job, kind: 'live' | 'fake') {
  return database().transaction(async tx => {
    const current = await lockJob(tx, job.id, kind);
    if (!current || !job.leaseToken || current.leaseToken !== job.leaseToken ||
      current.status !== 'submitting' || current.upstreamId || !current.submissionStartedAt || current.reviewRequired) return false;
    const a = await getAutomation(tx, job.id);
    if (!isMvp(a) || !automationPostAllowed(a, current) || await hasModerationHold(tx, job.id)) return false;
    await audit(tx, current, 'automation-send-authorized', 'Final lease/content-case check committed before transport');
    return true;
  });
}
/** Same narrow known-unsent proof as the pilot path, for MVP preview OR paid jobs.
 * ONLY the original claimant, before transport invocation; never after errors or
 * lost-worker recovery. No generic submitted-cost refund API is introduced. */
export async function cancelUnsentAutomationClaim(job: Job) {
  return database().transaction(async tx => {
    await lockGenerationCostBudget(tx);
    if (job.billingMode === 'paid') await lockWallet(tx, job.owner, job.creditEnvironment!);
    const [current] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for('update');
    if (!current || !job.leaseToken || current.leaseToken !== job.leaseToken) return current;
    const a = await getAutomation(tx, job.id);
    if (!isMvp(a) || a.status !== 'allowed' || current.status !== 'submitting' || current.upstreamId || !current.submissionStartedAt)
      throw new Error('AUTOMATION_UNSENT_PROOF_REQUIRED');
    const cost = await getGenerationCost(tx, job.id);
    if (cost) {
      if (cost.state !== 'submitted' || cost.outcome !== 'pending' || cost.actualMinor !== null) throw new Error('AUTOMATION_UNSENT_COST_PROOF_REQUIRED');
      await tx.execute(sql`UPDATE generation_cost_budget SET exposure_minor=exposure_minor-${cost.exposureMinor}::bigint WHERE id=true`);
      await tx.execute(sql`UPDATE generation_cost_reservations SET state='released',submitted_at=NULL,exposure_minor=0,outcome='failed' WHERE job_id=${job.id}::uuid`);
      await tx.execute(sql`INSERT INTO generation_cost_audit(id,job_id,action,actor,evidence_ref,detail)
        VALUES(${randomUUID()}::uuid,${job.id}::uuid,'cancel-unsent-automation','automation','pre-transport-authorization-ended',
          ${JSON.stringify({ leaseToken: job.leaseToken, transportInvoked: false })}::jsonb)`);
    }
    if (current.billingMode === 'paid' && current.creditState === 'reserved') await settleCredits(tx, current.id, 'released');
    const [canceled] = await tx.update(jobs).set({ status: 'failed', creditState: current.creditState === 'reserved' ? 'released' : current.creditState,
      submissionStartedAt: null, payload: null, resultUrl: null, deliveryVerifiedAt: null, reviewRequired: false,
      leaseToken: null, leaseUntil: null, updatedAt: instant() }).where(eq(jobs.id, current.id)).returning();
    await setTerminal(tx, current, 'canceled', 'AUTOMATION_AUTHORIZATION_ENDED');
    return canceled;
  });
}
export async function recordAutomationDelivery(tx: Transaction, job: Job, contentSha256: string | undefined) {
  const a = await getAutomation(tx, job.id);
  if (!isMvp(a)) return;
  if (a.status !== 'allowed' || automationIdentity(job) !== a.identity_hash || !contentSha256 || !/^[a-f0-9]{64}$/.test(contentSha256))
    throw new Error('AUTOMATION_FULL_OUTPUT_EVIDENCE_REQUIRED');
  await tx.execute(sql`UPDATE generation_automation SET output_content_sha256=${contentSha256},output_verified_at=${instant().toISOString()}::timestamptz WHERE job_id=${job.id}::uuid`);
  await audit(tx, job, 'automation-delivery', 'Complete file transport verified; image/output NOT_REVIEWED_MVP; no human approval');
}

async function lockJob(tx: Transaction, id: string, kind: 'live' | 'fake') {
  if (kind === 'live') await lockGenerationCostBudget(tx);
  const [initial] = await tx.select().from(jobs).where(eq(jobs.id, id));
  if (!initial || initial.creditEnvironment === 'test' && kind !== 'fake' || initial.creditEnvironment === 'live' && kind !== 'live') return null;
  if (initial.billingMode === 'paid') await lockWallet(tx, initial.owner, initial.creditEnvironment!);
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
  return job ?? null;
}
function ended(job: Job) { return !!job.submissionStartedAt || !!job.upstreamId || ['failed', 'success'].includes(job.status); }
async function preflight(tx: Transaction, job: Job, a: Automation) {
  if (!mvpAutomationEnabled()) { await stopAutomation(tx, job, a, 'canceled', 'AUTOMATION_DISABLED'); return false; }
  if (Date.now() >= date(a.deadline_at)) { await stopAutomation(tx, job, a, 'expired', 'CHECK_DEADLINE_EXCEEDED'); return false; }
  if (automationBinding(job) !== a.binding_hash) { await stopAutomation(tx, job, a, 'error', 'INPUT_CHANGED'); return false; }
  if (await hasOpenContentCase(tx, job.id)) { await stopAutomation(tx, job, a, 'canceled', 'CONTENT_CASE_HOLD'); return false; }
  return true;
}
export async function automationMaySubmit(tx: Transaction, job: Job, a: Automation) {
  return !terminal.has(a.status) && await preflight(tx, job, a) && a.status === 'allowed';
}
const scanError = (reasonCode: string, retryable = true): PromptSiftResult => ({ action: 'error', requestId: null,
  reasonCode, semanticStatus: null, retryable, retryAfterMs: null, httpStatus: null });
/** Durably reserve an attempt, commit, THEN call the scanner. No sleeps or I/O
 * inside a transaction. Restart/retry always reuse the one frozen idempotency key. */
export async function advanceAutomation(id: string, kind: 'live' | 'fake', scanner?: PromptScanner) {
  if (!isMvp(await getAutomation(database(), id))) return;
  const claim = await database().transaction(async tx => {
    const job = await lockJob(tx, id, kind);
    if (!job || ended(job)) return null;
    const a = await getAutomation(tx, id);
    if (!isMvp(a) || terminal.has(a.status) || !await preflight(tx, job, a)) return null;
    if (a.status === 'allowed') return null;
    const now = Date.now();
    if (a.lease_until && date(a.lease_until) > now) return null;
    if (date(a.next_attempt_at) > now) return null;
    if (a.attempts >= a.max_attempts) {
      await stopAutomation(tx, job, a, a.status === 'review' ? 'expired' : 'error', 'CHECK_ATTEMPTS_EXHAUSTED'); return null;
    }
    await tx.execute(sql`UPDATE generation_automation_attempts SET action='abandoned',reason_code='CHECK_LEASE_EXPIRED',finished_at=${instant().toISOString()}::timestamptz
      WHERE job_id=${id}::uuid AND finished_at IS NULL`);
    const token = randomUUID(), attempt = a.attempts + 1, timeoutMs = Math.min(a.timeout_ms, date(a.deadline_at) - now);
    const leaseUntil = new Date(now + timeoutMs + 5000), next = new Date(Math.min(leaseUntil.getTime(), date(a.deadline_at)));
    await tx.execute(sql`UPDATE generation_automation SET attempts=${attempt},lease_token=${token}::uuid,lease_until=${leaseUntil.toISOString()}::timestamptz WHERE job_id=${id}::uuid`);
    await tx.execute(sql`INSERT INTO generation_automation_attempts(job_id,attempt,lease_token,started_at,action)
      VALUES(${id}::uuid,${attempt},${token}::uuid,${instant().toISOString()}::timestamptz,'started')`);
    await tx.update(jobs).set({ nextPollAt: next }).where(eq(jobs.id, id));
    return { job, a, token, attempt, timeoutMs };
  });
  if (!claim) return;
  let result: PromptSiftResult, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = !mvpAutomationEnabled() || Date.now() >= date(claim.a.deadline_at) ? scanError('CHECK_CANCELED', false) : await Promise.race([
      (scanner ?? (kind === 'live' ? scanPrompt : async () => scanError('TEST_SCANNER_REQUIRED', false)))({ prompt: claim.job.prompt, idempotencyKey: claim.a.idempotency_key, timeoutMs: claim.timeoutMs }),
      new Promise<PromptSiftResult>(resolve => { timer = setTimeout(() => resolve(scanError('CHECK_TIMEOUT')), claim.timeoutMs); }),
    ]);
    if (!result || !['allow', 'block', 'review', 'error'].includes(result.action)) result = scanError('CHECK_INVALID_RESULT', false);
  } catch { result = scanError('CHECK_TRANSPORT_ERROR'); }
  finally { if (timer) clearTimeout(timer); }
  await database().transaction(async tx => {
    const job = await lockJob(tx, id, kind);
    if (!job || ended(job)) return;
    const a = await getAutomation(tx, id);
    if (!isMvp(a) || a.lease_token !== claim.token || a.attempts !== claim.attempt || terminal.has(a.status)) return;
    if (!await preflight(tx, job, a)) return;
    if (!a.lease_until || date(a.lease_until) <= Date.now()) return;
    const safe = (x: string | null) => typeof x === 'string' ? x.slice(0, 200) : null;
    const retryAfter = Number.isSafeInteger(result.retryAfterMs) && result.retryAfterMs! >= 0 ? result.retryAfterMs : null;
    await tx.execute(sql`UPDATE generation_automation_attempts SET finished_at=${instant().toISOString()}::timestamptz,
      action=${result.action},request_id=${safe(result.requestId)},reason_code=${safe(result.reasonCode)},semantic_status=${safe(result.semanticStatus)},
      retryable=${result.retryable === true},retry_after_ms=${retryAfter},http_status=${Number.isInteger(result.httpStatus) ? result.httpStatus : null}
      WHERE job_id=${id}::uuid AND attempt=${claim.attempt} AND lease_token=${claim.token}::uuid`);
    if (result.action === 'block') { await stopAutomation(tx, job, a, 'blocked', 'TEXT_BLOCKED'); return; }
    if (result.action === 'allow') {
      await tx.execute(sql`UPDATE generation_automation SET status='allowed',reason=NULL,allowed_at=${instant().toISOString()}::timestamptz,
        lease_token=NULL,lease_until=NULL WHERE job_id=${id}::uuid`);
      await tx.update(jobs).set({ nextPollAt: instant() }).where(eq(jobs.id, id));
      await audit(tx, job, 'automation-text-allowed', 'Bound text check allowed; image/output NOT_REVIEWED_MVP'); return;
    }
    if (a.attempts >= a.max_attempts || result.action === 'error' && !result.retryable) {
      await stopAutomation(tx, job, a, result.action === 'review' ? 'expired' : 'error',
        result.action === 'review' ? 'REVIEW_UNRESOLVED' : 'CHECK_UNAVAILABLE'); return;
    }
    // A cached review may remain unresolved beyond our deadline. Respect the
    // adapter's delay (including its 1h recommendation), never rotate keys.
    const delay = Math.max(result.action === 'review' ? 60000 : a.attempts === 1 ? 5000 : 10000,
      retryAfter ?? (result.httpStatus === 429 ? 60000 : 0));
    const next = new Date(Math.min(date(a.deadline_at), Date.now() + delay));
    await tx.execute(sql`UPDATE generation_automation SET status=${result.action === 'review' ? 'review' : 'checking'},
      reason=${result.action === 'review' ? 'TEXT_REVIEW_PENDING' : 'CHECK_RETRY_PENDING'},next_attempt_at=${next.toISOString()}::timestamptz,
      lease_token=NULL,lease_until=NULL WHERE job_id=${id}::uuid`);
    await tx.update(jobs).set({ nextPollAt: next }).where(eq(jobs.id, id));
  });
}
