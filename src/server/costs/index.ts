import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../account';

/** Server-only API. Every mutation requires an actual DB transaction; no network I/O here.
 * Integration lock order: cost budget -> wallet -> video job. Never reverse that order.
 */
export type CostSpec = {
  provider: string; model: string; mode: 'text' | 'image'; duration: number;
  resolution: string; audio: boolean; ratio: string;
};
export class GenerationCostError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'GenerationCostError'; }
}
function fail(code: string): never { throw new GenerationCostError(code); }
function text(value: string, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(`INVALID_${name}`);
  return value;
}
function money(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail('INVALID_CNY_MINOR');
  return value;
}
function instant(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('INVALID_TIME');
  return value.toISOString();
}
function window(from: Date, until: Date) {
  instant(from); instant(until);
  if (until <= from) fail('INVALID_VALIDITY_WINDOW');
}
function jobId(id: string) {
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) fail('INVALID_JOB_ID');
  return id;
}
export function costSpecKey(spec: CostSpec) {
  if (Object.keys(spec).sort().join(',') !== 'audio,duration,mode,model,provider,ratio,resolution' ||
      !['text','image'].includes(spec.mode) || !Number.isSafeInteger(spec.duration) || spec.duration <= 0 || typeof spec.audio !== 'boolean') fail('INVALID_COST_SPEC');
  for (const key of ['provider','model','resolution','ratio'] as const) text(spec[key], 'COST_SPEC');
  return createHash('sha256').update(JSON.stringify([spec.provider,spec.model,spec.mode,spec.duration,spec.resolution,spec.audio,spec.ratio])).digest('hex');
}
type Row = Record<string, unknown>;
export type CostReservation = {
  jobId: string; fingerprint: string; rateId: string; specKey: string;
  reservedMinor: number; exposureMinor: number; actualMinor: number | null;
  state: 'held' | 'submitted' | 'released'; outcome: 'pending' | 'unknown' | 'success' | 'failed';
  snapshot: unknown;
};
function reservation(r: Row): CostReservation {
  return { jobId:String(r.job_id),fingerprint:String(r.fingerprint),rateId:String(r.rate_id),specKey:String(r.spec_key),
    reservedMinor:Number(r.reserved_minor),exposureMinor:Number(r.exposure_minor),actualMinor:r.actual_minor===null?null:Number(r.actual_minor),
    state:r.state as CostReservation['state'],outcome:r.outcome as CostReservation['outcome'],snapshot:r.snapshot };
}
/** Lock even for recovery writes, but never require an enabled policy for querying old jobs. */
export async function lockGenerationCostBudget(tx: Transaction): Promise<Row> {
  const [b] = await tx.execute(sql`SELECT * FROM generation_cost_budget WHERE id=true FOR UPDATE`);
  if (!b) fail('COST_BUDGET_NOT_CONFIGURED');
  // Sample AFTER acquiring the lock; projection expressions can be evaluated before a lock wait.
  const [clock] = await tx.execute(sql`SELECT clock_timestamp() AS db_now`);
  return {...b,db_now:clock.db_now};
}
function activeBudget(b: Row) {
  if (!b.enabled) fail('COST_BUDGET_DISABLED');
  const now = new Date(String(b.db_now));
  if (!b.valid_from || !b.expires_at || now < new Date(String(b.valid_from)) || now >= new Date(String(b.expires_at))) fail('COST_BUDGET_EXPIRED');
}
async function rate(tx: Transaction, key: string) {
  const [r] = await tx.execute(sql`SELECT r.*, s.blocked_reason, clock_timestamp() AS db_now
    FROM generation_cost_specs s JOIN generation_cost_rates r ON r.id=s.rate_id WHERE s.spec_key=${key}`);
  if (!r) fail('COST_RATE_UNCONFIRMED');
  return r;
}
function activeRate(r: Row) {
  if (r.blocked_reason) fail('COST_RATE_BLOCKED');
  const now = new Date(String(r.db_now));
  if (now < new Date(String(r.valid_from)) || now >= new Date(String(r.expires_at))) fail('COST_RATE_EXPIRED');
}
async function audit(tx: Transaction, action: string, actor: string, evidenceRef: string, detail: Record<string,unknown>, id?: string) {
  text(actor,'ACTOR'); text(evidenceRef,'EVIDENCE');
  await tx.execute(sql`INSERT INTO generation_cost_audit(id,job_id,action,actor,evidence_ref,detail)
    VALUES(${randomUUID()}::uuid,${id??null}::uuid,${action},${actor},${evidenceRef},${JSON.stringify(detail)}::jsonb)`);
}
/** Explicit cumulative cap. Updating validity/cap never resets outstanding or spent exposure. */
export async function configureGenerationBudget(tx: Transaction, x: {
  expectedRevision: number; enabled: boolean; capMinor: number; validFrom: Date; expiresAt: Date; actor: string; evidenceRef: string;
}) {
  money(x.capMinor); window(x.validFrom,x.expiresAt);
  if (!Number.isSafeInteger(x.expectedRevision) || typeof x.enabled !== 'boolean') fail('INVALID_BUDGET_CONFIG');
  const b=await lockGenerationCostBudget(tx);
  if (b.revision !== x.expectedRevision) fail('BUDGET_REVISION_CONFLICT');
  await tx.execute(sql`UPDATE generation_cost_budget SET enabled=${x.enabled},cap_minor=${x.capMinor},valid_from=${instant(x.validFrom)}::timestamptz,
    expires_at=${instant(x.expiresAt)}::timestamptz,revision=revision+1 WHERE id=true`);
  await audit(tx,'configure-budget',x.actor,x.evidenceRef,{previousRevision:b.revision,capMinor:x.capMinor,enabled:x.enabled,validFrom:instant(x.validFrom),expiresAt:instant(x.expiresAt)});
  return { revision:Number(b.revision)+1 };
}
/** Manual trusted confirmation only; no provider-price scraper and no implicit default prices. */
export async function confirmGenerationRate(tx: Transaction, x: {
  spec: CostSpec; expectedRateId: string | null; maximumMinor: number;
  sourceRef: string; observedAt: Date; validFrom: Date; expiresAt: Date; actor: string;
}) {
  const key=costSpecKey(x.spec); money(x.maximumMinor,true); window(x.validFrom,x.expiresAt); instant(x.observedAt); text(x.sourceRef,'SOURCE'); text(x.actor,'ACTOR');
  const b=await lockGenerationCostBudget(tx);
  if (x.observedAt > new Date(String(b.db_now)) || x.observedAt > x.validFrom) fail('INVALID_OBSERVATION_TIME');
  const [current]=await tx.execute(sql`SELECT s.*,r.observed_at AS confirmed_observed_at FROM generation_cost_specs s JOIN generation_cost_rates r ON r.id=s.rate_id WHERE s.spec_key=${key}`);
  if ((current?.rate_id??null)!==x.expectedRateId) fail('RATE_REVISION_CONFLICT');
  // A stale approval must not erase newer observed price evidence or a higher known price.
  if (current && (new Date(String(current.confirmed_observed_at)) > x.observedAt ||
      current.observed_at && new Date(String(current.observed_at)) > x.observedAt ||
      current.observed_minor!==null && Number(current.observed_minor)>x.maximumMinor)) fail('STALE_PRICE_CONFIRMATION');
  const id=randomUUID();
  await tx.execute(sql`INSERT INTO generation_cost_rates(id,spec_key,spec,maximum_minor,source_ref,observed_at,valid_from,expires_at,confirmed_by)
    VALUES(${id}::uuid,${key},${JSON.stringify(x.spec)}::jsonb,${x.maximumMinor},${x.sourceRef},${instant(x.observedAt)}::timestamptz,${instant(x.validFrom)}::timestamptz,${instant(x.expiresAt)}::timestamptz,${x.actor})`);
  await tx.execute(sql`INSERT INTO generation_cost_specs(spec_key,rate_id) VALUES(${key},${id}::uuid)
    ON CONFLICT(spec_key) DO UPDATE SET rate_id=excluded.rate_id,blocked_reason=NULL`);
  await audit(tx,'confirm-rate',x.actor,x.sourceRef,{specKey:key,rateId:id,maximumMinor:x.maximumMinor});
  return { rateId:id,specKey:key };
}
/** Returns blocked rather than throwing AFTER a write, so the price halt can commit. */
export async function observeSupplierPrice(tx: Transaction, x: {
  spec: CostSpec; amountMinor: number; observedAt: Date; sourceRef: string; actor: string;
}) {
  const key=costSpecKey(x.spec); money(x.amountMinor); instant(x.observedAt); text(x.sourceRef,'SOURCE');
  const b=await lockGenerationCostBudget(tx); const r=await rate(tx,key);
  if (x.observedAt > new Date(String(b.db_now))) fail('INVALID_OBSERVATION_TIME');
  const [s]=await tx.execute(sql`SELECT * FROM generation_cost_specs WHERE spec_key=${key}`);
  if (s.observed_at && x.observedAt < new Date(String(s.observed_at))) fail('STALE_PRICE_OBSERVATION');
  const increased=x.amountMinor>Number(r.maximum_minor);
  await tx.execute(sql`UPDATE generation_cost_specs SET observed_minor=${x.amountMinor},observation_ref=${x.sourceRef},observed_at=${instant(x.observedAt)}::timestamptz,
    blocked_reason=CASE WHEN ${increased} THEN 'supplier-price-increased' ELSE blocked_reason END WHERE spec_key=${key}`);
  await audit(tx,'observe-price',x.actor,x.sourceRef,{specKey:key,amountMinor:x.amountMinor,increased});
  return { blocked:increased||!!r.blocked_reason };
}
/** Same task/fingerprint/spec is idempotent even after expiry. This is NOT permission to POST. */
export async function reserveGenerationCost(tx: Transaction, x: { jobId: string; fingerprint: string; spec: CostSpec }) {
  jobId(x.jobId); text(x.fingerprint,'FINGERPRINT'); const key=costSpecKey(x.spec);
  const b=await lockGenerationCostBudget(tx);
  const [existing]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${x.jobId}::uuid`);
  if (existing) {
    if (existing.fingerprint!==x.fingerprint || existing.spec_key!==key) fail('COST_RESERVATION_MISMATCH');
    return reservation(existing);
  }
  activeBudget(b); const r=await rate(tx,key); activeRate(r);
  const amount=Number(r.maximum_minor);
  if (BigInt(String(b.exposure_minor))+BigInt(amount)>BigInt(String(b.cap_minor))) fail('COST_BUDGET_EXHAUSTED');
  const snapshot={currency:'CNY',unit:'fen',spec:x.spec,rateId:r.id,maximumMinor:amount,sourceRef:r.source_ref,
    observedAt:r.observed_at,validFrom:r.valid_from,expiresAt:r.expires_at,confirmedBy:r.confirmed_by};
  const [created]=await tx.execute(sql`INSERT INTO generation_cost_reservations(job_id,fingerprint,rate_id,spec_key,snapshot,reserved_minor,exposure_minor,state)
    VALUES(${x.jobId}::uuid,${x.fingerprint},${r.id}::uuid,${key},${JSON.stringify(snapshot)}::jsonb,${amount},${amount},'held') RETURNING *`);
  await tx.execute(sql`UPDATE generation_cost_budget SET exposure_minor=exposure_minor+${amount} WHERE id=true`);
  await audit(tx,'reserve','server','approved-rate',{rateId:r.id,amountMinor:amount},x.jobId);
  return reservation(created);
}
/** Commit before provider POST. Only the ONE caller receiving maySubmit=true may POST.
 * A crash after commit is deliberately unknown: query by original job ID, never re-POST.
 */
export async function markGenerationSubmission(tx: Transaction, id: string) {
  jobId(id); const b=await lockGenerationCostBudget(tx);
  const [r]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${id}::uuid`);
  if (!r) fail('COST_RESERVATION_MISSING');
  if (r.state==='submitted') return {maySubmit:false,reservation:reservation(r)};
  if (r.state==='released') fail('COST_RESERVATION_RELEASED');
  activeBudget(b);
  if (BigInt(String(b.exposure_minor))>BigInt(String(b.cap_minor))) fail('COST_BUDGET_EXHAUSTED');
  const current=await rate(tx,String(r.spec_key)); activeRate(current);
  // Reconfirming even the same amount requires re-planning held jobs; never silently reprice.
  if (current.id!==r.rate_id) fail('COST_RATE_CHANGED');
  const [updated]=await tx.execute(sql`UPDATE generation_cost_reservations SET state='submitted',submitted_at=clock_timestamp() WHERE job_id=${id}::uuid RETURNING *`);
  await audit(tx,'submission-started','worker','before-provider-post',{},id);
  return {maySubmit:true,reservation:reservation(updated)};
}
/** Only a known local rejection BEFORE markGenerationSubmission can release exposure. */
export async function releaseUnsubmittedGenerationCost(tx: Transaction, x: {jobId:string; actor:string; evidenceRef:string}) {
  jobId(x.jobId); text(x.actor,'ACTOR');text(x.evidenceRef,'EVIDENCE');await lockGenerationCostBudget(tx);
  const [r]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${x.jobId}::uuid`);
  if (!r) fail('COST_RESERVATION_MISSING');
  if (r.state==='released') return reservation(r);
  if (r.state!=='held') fail('COST_MAY_HAVE_BEEN_CHARGED');
  await tx.execute(sql`UPDATE generation_cost_budget SET exposure_minor=exposure_minor-${r.exposure_minor}::bigint WHERE id=true`);
  const [updated]=await tx.execute(sql`UPDATE generation_cost_reservations SET state='released',exposure_minor=0,outcome='failed' WHERE job_id=${x.jobId}::uuid RETURNING *`);
  await audit(tx,'release-unsubmitted',x.actor,x.evidenceRef,{},x.jobId);
  return reservation(updated);
}
/** Failure/unknown never refunds provider budget, independently of customer credit releases. */
export async function recordGenerationOutcome(tx: Transaction, x: {jobId:string; outcome:'unknown'|'success'|'failed'; evidenceRef:string}) {
  jobId(x.jobId);text(x.evidenceRef,'EVIDENCE');
  if (!['unknown','success','failed'].includes(x.outcome)) fail('INVALID_OUTCOME');
  await lockGenerationCostBudget(tx);
  const [r]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${x.jobId}::uuid`);
  if (!r || r.state!=='submitted') fail('COST_NOT_SUBMITTED');
  if (r.outcome===x.outcome) return reservation(r);
  if (['success','failed'].includes(String(r.outcome))) fail('COST_OUTCOME_CONFLICT');
  const [updated]=await tx.execute(sql`UPDATE generation_cost_reservations SET outcome=${x.outcome} WHERE job_id=${x.jobId}::uuid RETURNING *`);
  await audit(tx,'outcome','worker',x.evidenceRef,{outcome:x.outcome},x.jobId);
  return reservation(updated);
}
/** Verified FINAL supplier charge only. Unknown stays null, never inferred from success/failure.
 * Lower actual charges do NOT replenish the cumulative safety cap. Higher charges are recorded
 * even beyond cap and halt the SKU; throwing would roll back the money fact, so return flags.
 */
export async function recordActualGenerationCost(tx: Transaction, x: {jobId:string; amountMinor:number; evidenceRef:string; actor:string}) {
  jobId(x.jobId);money(x.amountMinor);text(x.evidenceRef,'EVIDENCE');text(x.actor,'ACTOR');
  const b=await lockGenerationCostBudget(tx);
  const [r]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${x.jobId}::uuid`);
  if (!r || r.state!=='submitted') fail('COST_NOT_SUBMITTED');
  if (r.actual_minor!==null) {
    if (Number(r.actual_minor)!==x.amountMinor || r.actual_evidence_ref!==x.evidenceRef) fail('ACTUAL_COST_CONFLICT');
    return {duplicate:true,priceIncreased:x.amountMinor>Number(r.reserved_minor)};
  }
  const exposure=Math.max(Number(r.exposure_minor),x.amountMinor),delta=exposure-Number(r.exposure_minor);
  if (BigInt(String(b.exposure_minor))+BigInt(delta)>BigInt(Number.MAX_SAFE_INTEGER)) fail('COST_AMOUNT_OVERFLOW');
  await tx.execute(sql`UPDATE generation_cost_budget SET exposure_minor=exposure_minor+${delta} WHERE id=true`);
  await tx.execute(sql`UPDATE generation_cost_reservations SET actual_minor=${x.amountMinor},actual_evidence_ref=${x.evidenceRef},exposure_minor=${exposure} WHERE job_id=${x.jobId}::uuid`);
  const increased=x.amountMinor>Number(r.reserved_minor);
  if (increased) await tx.execute(sql`UPDATE generation_cost_specs SET blocked_reason='actual-cost-exceeded-confirmed',
    observed_minor=greatest(coalesce(observed_minor,0),${x.amountMinor}),observation_ref=${x.evidenceRef},observed_at=clock_timestamp() WHERE spec_key=${r.spec_key}`);
  await audit(tx,'actual-cost',x.actor,x.evidenceRef,{amountMinor:x.amountMinor,priceIncreased:increased},x.jobId);
  return {duplicate:false,priceIncreased:increased};
}
/** Read-only recovery works with policy disabled/expired/unconfirmed. No new reservation or POST. */
export async function getGenerationCost(tx: Pick<Transaction,'execute'>, id:string): Promise<CostReservation|null> {
  jobId(id);
  const [r]=await tx.execute(sql`SELECT * FROM generation_cost_reservations WHERE job_id=${id}::uuid`);
  return r?reservation(r):null;
}
export async function getGenerationBudget(tx: Pick<Transaction,'execute'>) {
  const [b]=await tx.execute(sql`SELECT * FROM generation_cost_budget WHERE id=true`);
  if (!b) return null;
  return {enabled:Boolean(b.enabled),capMinor:Number(b.cap_minor),exposureMinor:Number(b.exposure_minor),revision:Number(b.revision),
    validFrom:b.valid_from,expiresAt:b.expires_at};
}
