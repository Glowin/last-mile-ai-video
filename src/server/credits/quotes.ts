import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { VIDEO_PRICE_VERSION, videoCredits } from "../../lib/video-credit-rates";
import { database } from "../db";
import type { GenerationInput } from "../input";
import type { Transaction } from "../account";
import { balance, CreditError, lockWallet } from "./wallet";
import type { ChargingPolicy } from "./config";
import { generationPilotAllows, pilotJobs } from "./pilot";
/** Hash every validated field, including request id, prompt, audio and full upload reference. */
export function generationFingerprint(x: GenerationInput) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
}
export async function createQuote(userId: string, x: GenerationInput, policy: ChargingPolicy) {
  const credits=videoCredits(x), quoteId=randomUUID(), expiresAt=new Date(Date.now()+300_000);
  if(credits===null) return {quoteId:null,credits:null,priceVersion:VIDEO_PRICE_VERSION,expiresAt:expiresAt.toISOString(),available:false,reason:"UNVERIFIED_VIDEO_PRICE"};
  return database().transaction(async tx=>{
    await lockWallet(tx,userId,policy.environment);
    const b=await balance(tx,userId,policy.environment);
    const prior = !policy.enabled && policy.environment === "live" ? await pilotJobs(tx, userId) : [];
    const allowed = policy.enabled || generationPilotAllows(userId, x, policy);
    const reason=!allowed?"GENERATION_CHARGING_DISABLED":!policy.enabled&&prior.length?"GENERATION_PILOT_JOB_LIMIT":b.blocked?"WALLET_BLOCKED":b.available<credits?"INSUFFICIENT_CREDITS":undefined;
    if (reason) return {quoteId:null,credits,priceVersion:VIDEO_PRICE_VERSION,expiresAt:expiresAt.toISOString(),available:false,reason};
    await tx.execute(sql`INSERT INTO video_quotes(id,user_id,environment,fingerprint,credits,price_version,expires_at)
      VALUES(${quoteId}::uuid,${userId}::uuid,${policy.environment},${generationFingerprint(x)},${credits},${VIDEO_PRICE_VERSION},${expiresAt.toISOString()}::timestamptz)`);
    return {quoteId,credits,priceVersion:VIDEO_PRICE_VERSION,expiresAt:expiresAt.toISOString(),available:!reason,...(reason?{reason}:{})};
  });
}
export async function useQuote(tx: Transaction, userId:string, x:GenerationInput, quoteId:string, policy:ChargingPolicy) {
  if (!policy.enabled && !generationPilotAllows(userId, x, policy)) throw new CreditError("GENERATION_CHARGING_DISABLED", 503);
  const [q]=await tx.execute(sql`SELECT * FROM video_quotes WHERE id=${quoteId}::uuid AND user_id=${userId}::uuid AND environment=${policy.environment} FOR UPDATE`);
  if(!q || q.fingerprint!==generationFingerprint(x)) throw new CreditError("QUOTE_MISMATCH");
  if(q.job_id) throw new CreditError("QUOTE_ALREADY_USED");
  if(new Date(String(q.expires_at)).getTime()<=Date.now()) throw new CreditError("QUOTE_EXPIRED");
  if(q.price_version!==VIDEO_PRICE_VERSION || q.credits!==videoCredits(x)) throw new CreditError("QUOTE_PRICE_CHANGED");
  await tx.execute(sql`UPDATE video_quotes SET job_id=${x.requestId}::uuid WHERE id=${quoteId}::uuid`);
  return Number(q.credits);
}
