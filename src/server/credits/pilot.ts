import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { GenerationPilotOffer } from "../../lib/billing";
import type { Transaction } from "../account";
import { database } from "../db";
import type { GenerationInput } from "../input";
import type { jobs } from "../schema";
import { GenerationCostError } from "../costs";
import { generationPilotFromEnvironment, type ChargingPolicy, type GenerationPilot } from "./config";
import { CreditError, lockWallet } from "./wallet";

const spec = Object.freeze({ family: "minimax", mode: "image", duration: 6, resolution: "2K", ratio: "adaptive", audio: false } as const);
const action = "generation-pilot-created";
export function generationPilotAllows(userId: string, x: GenerationInput, policy: ChargingPolicy,
  pilot = generationPilotFromEnvironment(), now = Date.now()): boolean {
  return !policy.enabled && policy.environment === "live" && !!pilot && pilot.userId === userId &&
    pilot.requestId === x.requestId && Date.parse(pilot.expiresAt) > now &&
    Object.entries(spec).every(([key, value]) => x[key as keyof GenerationInput] === value);
}

/** Caller holds the LIVE wallet lock. Every status consumes the single slot;
 * changing configured request IDs or restarting does not create another slot. */
export async function pilotJobs(tx: Transaction, userId: string) {
  return tx.execute(sql`SELECT id FROM video_jobs WHERE owner=${userId}::uuid
    AND billing_mode='paid' AND credit_environment='live' LIMIT 2`);
}
export async function assertPilotCreation(tx: Transaction, userId: string, x: GenerationInput, policy: ChargingPolicy): Promise<GenerationPilot> {
  const prior = await pilotJobs(tx, userId);
  // Read config/deadline AFTER waiting for locks and queries.
  const pilot = generationPilotFromEnvironment();
  if (!generationPilotAllows(userId, x, policy, pilot)) throw new CreditError("GENERATION_CHARGING_DISABLED", 503);
  if (prior.length) throw new CreditError("GENERATION_PILOT_JOB_LIMIT");
  return pilot!;
}

function payloadHash(payload: Record<string, unknown> | null) {
  return createHash("sha256").update(JSON.stringify(payload && Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}
/** Same transaction as job + allocations: no new schema or credit minting. */
export async function recordPilotCreation(tx: Transaction, job: typeof jobs.$inferSelect, pilot: GenerationPilot) {
  await tx.execute(sql`INSERT INTO credit_audit(id,job_id,action,actor,reason)
    VALUES(${randomUUID()}::uuid,${job.id}::uuid,${action},'server',${JSON.stringify({
      userId: job.owner, expiresAt: pilot.expiresAt, fingerprint: job.fingerprint, payloadHash: payloadHash(job.payload), credits: 23,
    })})`);
}

/** Called only for an unstarted live paid job, with cost -> wallet -> job locks.
 * Ordinary jobs are unaffected. A pilot stays bound to its original authorization
 * even if public charging opens later. Started jobs never call this function. */
export async function assertPilotSubmission(tx: Transaction, job: typeof jobs.$inferSelect) {
  const rows = await tx.execute(sql`SELECT reason FROM credit_audit WHERE job_id=${job.id}::uuid AND action=${action}`);
  if (!rows.length) return;
  let saved: Record<string, unknown>;
  try { saved = JSON.parse(String(rows[0].reason)); }
  catch { throw new GenerationCostError("GENERATION_PILOT_INVALID_BINDING"); }
  const prior = await pilotJobs(tx, job.owner);
  const pilot = generationPilotFromEnvironment();
  if (rows.length !== 1 || !pilot || pilot.userId !== job.owner || pilot.requestId !== job.id ||
      pilot.expiresAt !== saved.expiresAt || Date.parse(pilot.expiresAt) <= Date.now() ||
      saved.userId !== job.owner || saved.fingerprint !== job.fingerprint || saved.payloadHash !== payloadHash(job.payload) ||
      saved.credits !== 23 || job.credits !== 23 || job.creditState !== "reserved" ||
      prior.length !== 1 || prior[0].id !== job.id)
    throw new GenerationCostError("GENERATION_PILOT_EXPIRED_OR_REVOKED");
  return pilot;
}

/** Synchronous final check: call after preparing the body, immediately before
 * invoking transport. No await may separate this check from that invocation. */
export function pilotPostAllowed(authorization: GenerationPilot, job: typeof jobs.$inferSelect): boolean {
  const current = generationPilotFromEnvironment();
  return !!current && current.userId === authorization.userId && current.userId === job.owner &&
    current.requestId === authorization.requestId && current.requestId === job.id &&
    current.expiresAt === authorization.expiresAt && Date.parse(authorization.expiresAt) > Date.now() &&
    !!job.leaseUntil && job.leaseUntil.getTime() > Date.now();
}

/** Authenticated billing summary only. Never attach this to public catalog/models. */
export async function generationPilotOffer(userId: string): Promise<GenerationPilotOffer | null> {
  const pilot = generationPilotFromEnvironment();
  if (!pilot || pilot.userId !== userId || Date.parse(pilot.expiresAt) <= Date.now()) return null;
  return database().transaction(async tx => {
    await lockWallet(tx, userId, "live");
    const prior = await pilotJobs(tx, userId);
    const current = generationPilotFromEnvironment();
    if (!current || current.userId !== userId || current.requestId !== pilot.requestId ||
        current.expiresAt !== pilot.expiresAt || Date.parse(current.expiresAt) <= Date.now()) return null;
    return { requestId: pilot.requestId, expiresAt: pilot.expiresAt, spec, credits: 23,
      available: prior.length === 0, jobId: prior.length === 1 ? String(prior[0].id) : null };
  });
}
