import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "../account";
import type { GenerationInput } from "../input";
import type { GenerationPilot } from "./config";
import { lockWallet, CreditError } from "./wallet";
import { configureGenerationBudget, lockGenerationCostBudget, assertGenerationBudgetScope, GenerationCostError } from "../costs";

/** Fixed-purpose, lifetime-once owner acceptance. Audit is append-only by application convention,
 * not a new database immutability guarantee. No environment value can mint another grant. */
export const ACCEPTANCE_PURPOSE = "unattended-paid-acceptance-v1";
const issued = "unattended-paid-acceptance-issued", revoked = "unattended-paid-acceptance-revoked";
export const acceptanceSpec = Object.freeze({ family: "minimax", mode: "image", duration: 6, resolution: "2K", ratio: "adaptive", audio: false } as const);
export type AcceptanceGrant = GenerationPilot & { grantId: string; budgetRevision: number; previousJobId: string };
export const paidAcceptanceEnabled = () => process.env.GENERATION_PAID_ACCEPTANCE_ENABLED === "true";
function parse(row: Record<string, unknown>): AcceptanceGrant {
  try {
    const x = JSON.parse(String(row.reason));
    if (x.purpose !== ACCEPTANCE_PURPOSE || x.credits !== 23 || x.maximumMinor !== 456 ||
        ![row.id, x.userId, x.requestId, x.previousJobId].every(v => typeof v === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v)) ||
        !Number.isSafeInteger(x.budgetRevision) || !Number.isFinite(Date.parse(x.expiresAt))) throw new Error();
    return { grantId: String(row.id), userId: x.userId.toLowerCase(), requestId: x.requestId.toLowerCase(), previousJobId: x.previousJobId.toLowerCase(),
      expiresAt: x.expiresAt, budgetRevision: x.budgetRevision };
  } catch { throw new GenerationCostError("PAID_ACCEPTANCE_INVALID_GRANT"); }
}
export async function acceptanceGrant(tx: Pick<Transaction, "execute">, userId: string): Promise<AcceptanceGrant | null> {
  const rows = await tx.execute(sql`SELECT id,reason FROM credit_audit WHERE action=${issued} AND lower((CASE WHEN action=${issued} THEN reason::jsonb ELSE NULL END)->>'userId')=${userId.toLowerCase()}`);
  if (!rows.length) return null;
  if (rows.length !== 1) throw new GenerationCostError("PAID_ACCEPTANCE_INVALID_GRANT");
  return parse(rows[0]);
}
async function grantActive(tx: Pick<Transaction, "execute">, g: AcceptanceGrant) {
  if (!paidAcceptanceEnabled() || Date.parse(g.expiresAt) <= Date.now()) return false;
  const [r] = await tx.execute(sql`SELECT id FROM credit_audit WHERE action=${revoked} AND lower((CASE WHEN action=${revoked} THEN reason::jsonb ELSE NULL END)->>'grantId')=${g.grantId} LIMIT 1`);
  return !r && paidAcceptanceEnabled() && Date.parse(g.expiresAt) > Date.now();
}
/** Wallet lock required. Historical pilot is excluded only by its exact immutable identity. */
async function validJobs(tx: Pick<Transaction, "execute">, g: AcceptanceGrant, created: boolean) {
  const rows = await tx.execute(sql`SELECT id,status,credit_state,credits FROM video_jobs WHERE owner=${g.userId}::uuid AND billing_mode='paid' AND credit_environment='live'`);
  const prior = rows.find(x => x.id === g.previousJobId);
  return !!prior && prior.status === "success" && prior.credit_state === "consumed" && prior.credits === 23 &&
    rows.length === (created ? 2 : 1) && rows.every(x => x.id === g.previousJobId || created && x.id === g.requestId);
}
export async function acceptanceForInput(tx: Transaction, userId: string, x: GenerationInput, created = false): Promise<AcceptanceGrant | null> {
  if (!paidAcceptanceEnabled()) return null;
  const g = await acceptanceGrant(tx, userId);
  if (!g || !await grantActive(tx, g) || g.requestId !== x.requestId ||
      !Object.entries(acceptanceSpec).every(([k, v]) => x[k as keyof GenerationInput] === v) ||
      process.env.GENERATION_REVIEW_POLICY !== "mvp-text-only-v1" || process.env.GENERATION_MVP_AUTOMATION_ENABLED !== "true" ||
      !await validJobs(tx, g, created)) return null;
  return Date.parse(g.expiresAt) > Date.now() && paidAcceptanceEnabled() ? g : null;
}
export async function acceptanceOffer(tx: Transaction, userId: string) {
  const g = await acceptanceGrant(tx, userId);
  if (!g) return null;
  const [created] = await tx.execute(sql`SELECT id FROM video_jobs WHERE id=${g.requestId}::uuid AND owner=${userId}::uuid`);
  const available = await grantActive(tx, g) && await validJobs(tx, g, false) &&
    process.env.GENERATION_REVIEW_POLICY === "mvp-text-only-v1" && process.env.GENERATION_MVP_AUTOMATION_ENABLED === "true";
  return { requestId: g.requestId, expiresAt: g.expiresAt, spec: acceptanceSpec, credits: 23 as const,
    available, jobId: created ? String(created.id) : null };
}
/** Caller holds cost -> wallet -> job. Also used in the final durable send authorization. */
export async function assertAcceptanceSubmission(tx: Transaction, job: { id: string; owner: string; credits: number | null; creditState: string }, saved: Record<string, unknown>) {
  const g = await acceptanceGrant(tx, job.owner);
  if (!g || saved.grantId !== g.grantId || saved.budgetRevision !== g.budgetRevision || saved.expiresAt !== g.expiresAt ||
      g.requestId !== job.id || job.credits !== 23 || job.creditState !== "reserved" || !await grantActive(tx, g) || !await validJobs(tx, g, true))
    throw new GenerationCostError("PAID_ACCEPTANCE_EXPIRED_OR_REVOKED");
  const b = await assertGenerationBudgetScope(tx, job.id, g.grantId);
  if (Number(b.revision) !== g.budgetRevision) throw new GenerationCostError("PAID_ACCEPTANCE_BUDGET_CHANGED");
  return g;
}
export async function issuePaidAcceptance(tx: Transaction, x: { userId: string; requestId: string; previousJobId: string;
  expectedRevision: number; expiresAt: Date; actor: string; evidenceRef: string }) {
  x = {...x,userId:x.userId.toLowerCase(),requestId:x.requestId.toLowerCase(),previousJobId:x.previousJobId.toLowerCase()};
  const b = await lockGenerationCostBudget(tx);
  await lockWallet(tx, x.userId, "live");
  const now = new Date(String(b.db_now));
  if (!paidAcceptanceEnabled() || process.env.GENERATION_REVIEW_POLICY !== "mvp-text-only-v1" ||
      process.env.GENERATION_MVP_AUTOMATION_ENABLED !== "true" || x.expiresAt <= now || x.expiresAt.getTime() > now.getTime() + 3600_000)
    throw new CreditError("PAID_ACCEPTANCE_CONFIG_INVALID");
  if (await acceptanceGrant(tx, x.userId)) throw new CreditError("PAID_ACCEPTANCE_ALREADY_ISSUED");
  const g: AcceptanceGrant = { grantId: randomUUID(), userId: x.userId, requestId: x.requestId, previousJobId: x.previousJobId,
    expiresAt: x.expiresAt.toISOString(), budgetRevision: Number(b.revision) + 1 };
  if (!await validJobs(tx, g, false)) throw new CreditError("PAID_ACCEPTANCE_BASELINE_MISMATCH");
  const [existing] = await tx.execute(sql`SELECT id FROM video_jobs WHERE id=${x.requestId}::uuid`);
  if (existing) throw new CreditError("PAID_ACCEPTANCE_REQUEST_EXISTS");
  const capMinor = Number(b.exposure_minor) + 456;
  if (!Number.isSafeInteger(capMinor)) throw new CreditError("PAID_ACCEPTANCE_AMOUNT_INVALID");
  const result = await configureGenerationBudget(tx, { expectedRevision: x.expectedRevision, enabled: true, capMinor,
    validFrom: now, expiresAt: x.expiresAt, actor: x.actor, evidenceRef: x.evidenceRef,
    scope: { jobId: x.requestId, grantId: g.grantId } });
  await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${g.grantId}::uuid,NULL,${issued},${x.actor},
    ${JSON.stringify({ purpose: ACCEPTANCE_PURPOSE, userId: g.userId, requestId: g.requestId, previousJobId: g.previousJobId,
      expiresAt: g.expiresAt, budgetRevision: result.revision, credits: 23, maximumMinor: 456, evidenceRef: x.evidenceRef })})`);
  return { grantId: g.grantId, budgetRevision: result.revision };
}
export async function revokePaidAcceptance(tx: Transaction, x: { userId: string; grantId: string; actor: string; evidenceRef: string }) {
  x = {...x,userId:x.userId.toLowerCase(),grantId:x.grantId.toLowerCase()};
  await lockGenerationCostBudget(tx); await lockWallet(tx, x.userId, "live");
  const g = await acceptanceGrant(tx, x.userId);
  if (!g || g.grantId !== x.grantId) throw new CreditError("PAID_ACCEPTANCE_GRANT_MISMATCH");
  const [prior] = await tx.execute(sql`SELECT id FROM credit_audit WHERE action=${revoked} AND lower((CASE WHEN action=${revoked} THEN reason::jsonb ELSE NULL END)->>'grantId')=${g.grantId} LIMIT 1`);
  if (!prior) await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason) VALUES(${randomUUID()}::uuid,NULL,${revoked},${x.actor},
    ${JSON.stringify({ purpose: ACCEPTANCE_PURPOSE, userId: x.userId, grantId: g.grantId, evidenceRef: x.evidenceRef })})`);
  return { revoked: true };
}
