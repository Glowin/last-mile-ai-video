import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import type { Transaction } from "../account";
import type { CreditEnvironment } from "./config";
export class CreditError extends Error {
  constructor(public code: string, public status: 400 | 403 | 409 | 503 = 409) { super(code); }
}
type Purchase = { orderId: string; userId: string; environment: CreditEnvironment; credits: number };
export async function lockWallet(tx: Transaction, userId: string, environment: CreditEnvironment) {
  await tx.execute(sql`INSERT INTO credit_wallets(user_id,environment) VALUES(${userId}::uuid,${environment}) ON CONFLICT DO NOTHING`);
  await tx.execute(sql`SELECT user_id FROM credit_wallets WHERE user_id=${userId}::uuid AND environment=${environment} FOR UPDATE`);
}
function validCredits(n: number) { if (!Number.isSafeInteger(n) || n <= 0) throw new CreditError("INVALID_CREDITS", 400); }
export async function grantPurchase(tx: Transaction, p: Purchase & { paidAt: Date }) {
  validCredits(p.credits);
  await lockWallet(tx, p.userId, p.environment);
  await tx.execute(sql`INSERT INTO credit_batches(order_id,user_id,environment,credits,paid_at)
    VALUES(${p.orderId}::uuid,${p.userId}::uuid,${p.environment},${p.credits},${p.paidAt.toISOString()}::timestamptz) ON CONFLICT(order_id) DO NOTHING`);
  const [b] = await tx.execute(sql`SELECT * FROM credit_batches WHERE order_id=${p.orderId}::uuid`);
  if (b.user_id !== p.userId || b.environment !== p.environment || b.credits !== p.credits) throw new CreditError("PURCHASE_MISMATCH");
}
export async function applyFullRefund(tx: Transaction, p: Purchase) {
  validCredits(p.credits);
  await lockWallet(tx, p.userId, p.environment);
  // A refund may arrive before payment success; a tombstone prevents a later grant.
  await tx.execute(sql`INSERT INTO credit_batches(order_id,user_id,environment,credits,paid_at,refunded)
    VALUES(${p.orderId}::uuid,${p.userId}::uuid,${p.environment},${p.credits},now(),true) ON CONFLICT(order_id) DO NOTHING`);
  const [b] = await tx.execute(sql`SELECT * FROM credit_batches WHERE order_id=${p.orderId}::uuid FOR UPDATE`);
  if (b.user_id !== p.userId || b.environment !== p.environment || b.credits !== p.credits) throw new CreditError("REFUND_MISMATCH");
  if (b.refunded) return;
  await tx.execute(sql`UPDATE credit_batches SET refunded=true,refund_frozen=false WHERE order_id=${p.orderId}::uuid`);
  // External refund truth must commit, even when generation has already spent/reserved credits.
  await tx.execute(sql`UPDATE credit_wallets SET debt=debt+${Number(b.consumed)+Number(b.reserved)} WHERE user_id=${p.userId}::uuid AND environment=${p.environment}`);
  await tx.execute(sql`INSERT INTO credit_audit(id,order_id,action,actor,reason) VALUES(${randomUUID()}::uuid,${p.orderId}::uuid,'refund','payment-event','External full refund recorded; spent or reserved credits become debt')`);
}
type Refund = Omit<Purchase, "credits">;
export async function freezeRefund(tx: Transaction, p: Refund & { now: Date }): Promise<{ ok: boolean; reason?: string }> {
  await lockWallet(tx, p.userId, p.environment);
  const [b] = await tx.execute(sql`SELECT * FROM credit_batches WHERE order_id=${p.orderId}::uuid AND user_id=${p.userId}::uuid AND environment=${p.environment} FOR UPDATE`);
  if (!b || b.refunded) return { ok: false, reason: "PURCHASE_NOT_REFUNDABLE" };
  if (p.now.getTime() < new Date(String(b.paid_at)).getTime() || p.now.getTime() > new Date(String(b.paid_at)).getTime()+14*86400_000) return { ok: false, reason: "REFUND_WINDOW_EXPIRED" };
  if (Number(b.consumed) || Number(b.reserved)) return { ok: false, reason: "PACKAGE_ALREADY_USED_OR_RESERVED" };
  await tx.execute(sql`UPDATE credit_batches SET refund_frozen=true WHERE order_id=${p.orderId}::uuid`);
  return { ok: true };
}
export async function unfreezeRefund(tx: Transaction, p: Refund) {
  await lockWallet(tx,p.userId,p.environment);
  await tx.execute(sql`UPDATE credit_batches SET refund_frozen=false WHERE order_id=${p.orderId}::uuid AND user_id=${p.userId}::uuid AND environment=${p.environment} AND NOT refunded`);
}
export async function balance(tx: Transaction, userId: string, environment: CreditEnvironment) {
  const [b] = await tx.execute(sql`SELECT coalesce(sum(credits-consumed-reserved) FILTER(WHERE NOT refunded AND NOT refund_frozen),0)::int available,
    coalesce(sum(reserved),0)::int reserved FROM credit_batches WHERE user_id=${userId}::uuid AND environment=${environment}`);
  const [w] = await tx.execute(sql`SELECT debt FROM credit_wallets WHERE user_id=${userId}::uuid AND environment=${environment}`);
  const [hold] = await tx.execute(sql`SELECT EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (a.order_id) a.action FROM credit_audit a
      JOIN billing_orders o ON o.id=a.order_id
      WHERE o.user_id=${userId}::uuid AND o.environment=${environment} AND a.action IN ('wallet-review','wallet-review-resolved')
      ORDER BY a.order_id,a.created_at DESC,a.id DESC
    ) latest WHERE latest.action='wallet-review'
  ) AS blocked`);
  return { available: Number(b.available), reserved: Number(b.reserved), blocked: Number(w?.debt ?? 0)>0 || hold.blocked===true };
}
export async function walletSummary(userId: string) {
  return database().transaction(async tx => {
    await lockWallet(tx,userId,"live"); await lockWallet(tx,userId,"test");
    const live=await balance(tx,userId,"live"), test=await balance(tx,userId,"test");
    return { availableCredits:live.available,reservedCredits:live.reserved,testAvailableCredits:test.available,testReservedCredits:test.reserved,blocked:live.blocked,testBlocked:test.blocked };
  });
}
/** Caller holds wallet lock, then job lock. */
export async function reserveCredits(tx: Transaction, p: {jobId: string;userId: string;environment: CreditEnvironment;credits:number}) {
  validCredits(p.credits);
  const b=await balance(tx,p.userId,p.environment);
  if(b.blocked) throw new CreditError("WALLET_BLOCKED");
  if(b.available<p.credits) throw new CreditError("INSUFFICIENT_CREDITS");
  const existing=await tx.execute(sql`SELECT job_id FROM credit_allocations WHERE job_id=${p.jobId}::uuid`);
  if(existing.length) throw new CreditError("ALREADY_RESERVED");
  const batches=await tx.execute(sql`SELECT * FROM credit_batches WHERE user_id=${p.userId}::uuid AND environment=${p.environment} AND NOT refunded AND NOT refund_frozen AND credits>consumed+reserved ORDER BY paid_at,order_id FOR UPDATE`);
  let remaining=p.credits;
  for(const batch of batches) {
    const n=Math.min(remaining,Number(batch.credits)-Number(batch.consumed)-Number(batch.reserved));
    if(!n) break;
    await tx.execute(sql`INSERT INTO credit_allocations(job_id,order_id,credits,state) VALUES(${p.jobId}::uuid,${batch.order_id}::uuid,${n},'reserved')`);
    await tx.execute(sql`UPDATE credit_batches SET reserved=reserved+${n} WHERE order_id=${batch.order_id}::uuid`);
    remaining-=n;
  }
  if(remaining) throw new CreditError("INSUFFICIENT_CREDITS");
}
/** Monotonic settlement: released allocations can never be charged by late success. */
export async function settleCredits(tx: Transaction, jobId: string, state: "consumed"|"released") {
  const allocations=await tx.execute(sql`SELECT a.*,b.refunded,b.user_id,b.environment FROM credit_allocations a JOIN credit_batches b ON b.order_id=a.order_id WHERE a.job_id=${jobId}::uuid AND a.state='reserved' ORDER BY b.paid_at,b.order_id FOR UPDATE OF a,b`);
  for(const a of allocations) {
    await tx.execute(sql`UPDATE credit_batches SET reserved=reserved-${a.credits},consumed=consumed+${state==="consumed"?a.credits:0} WHERE order_id=${a.order_id}::uuid`);
    if(a.refunded && state==="released") await tx.execute(sql`UPDATE credit_wallets SET debt=debt-${a.credits} WHERE user_id=${a.user_id}::uuid AND environment=${a.environment}`);
    await tx.execute(sql`UPDATE credit_allocations SET state=${state} WHERE job_id=${jobId}::uuid AND order_id=${a.order_id}::uuid`);
  }
}

/** An evidence hold is separate from numerical debt. Audit entries are never erased. */
export async function blockWalletForReview(tx: Transaction, p: Refund, reason: string) {
  await lockWallet(tx,p.userId,p.environment);
  await tx.execute(sql`INSERT INTO credit_audit(id,order_id,action,actor,reason,created_at)
    SELECT ${randomUUID()}::uuid,id,'wallet-review','payment-evidence',${reason},clock_timestamp()
    FROM billing_orders WHERE id=${p.orderId}::uuid AND user_id=${p.userId}::uuid AND environment=${p.environment}`);
}
/** Resolve ONLY the specified order's evidence hold, never another order or refund debt. */
export async function resolveWalletReview(tx: Transaction, p: Refund, reason: string) {
  if(reason.trim().length<10) throw new CreditError("REVIEW_RESOLUTION_REASON_REQUIRED");
  await lockWallet(tx,p.userId,p.environment);
  await tx.execute(sql`INSERT INTO credit_audit(id,order_id,action,actor,reason,created_at)
    SELECT ${randomUUID()}::uuid,id,'wallet-review-resolved','payment-evidence',${reason},clock_timestamp()
    FROM billing_orders WHERE id=${p.orderId}::uuid AND user_id=${p.userId}::uuid AND environment=${p.environment}`);
}
