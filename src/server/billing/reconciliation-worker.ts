import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { database } from '../db';
import { billingOptionsFromEnvironment } from './config';
import { BillingService, type BillingOptions } from './service';
import { defaultProviders, type BillingProvider, type ProviderRegistry } from './providers';

// Code-level limits: environment variables cannot relax them or enable sales.
export const reconciliationLimits = Object.freeze({ batch: 10, attempts: 64,
  horizonDays: 30, leaseSeconds: 120, queryTimeoutMs: 20_000, maxEvents: 10 });
const denied = async (): Promise<never> => { throw new Error('RECONCILIATION_READ_ONLY'); };
function bounded<T>(operation: () => Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RECONCILIATION_QUERY_TIMEOUT')), ms);
    Promise.resolve().then(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
// Only these query capabilities enter BillingService. Late results after timeout
// are discarded before applyEvent; no background reconciliation can mutate money.
function readOnly(provider: BillingProvider): BillingProvider {
  return {
    id: provider.id, environment: provider.environment, merchantAccountId: provider.merchantAccountId,
    checkoutHosts: [], capabilities: provider.capabilities, isConfigured: () => provider.isConfigured(),
    createCheckout: denied, requestRefund: denied, verifyAndNormalizeWebhook: denied,
    reconcile: async (id) => {
      const events = await bounded(() => provider.reconcile!(id), reconciliationLimits.queryTimeoutMs);
      if (events.length > reconciliationLimits.maxEvents) throw new Error('RECONCILIATION_EVENT_LIMIT');
      return events;
    },
    ...(provider.reconcileRefund ? { reconcileRefund: (command: Parameters<NonNullable<BillingProvider['reconcileRefund']>>[0]) =>
      bounded(() => provider.reconcileRefund!(command), reconciliationLimits.queryTimeoutMs) } : {}),
  };
}
export type ReconciliationTick = { claimed: number; observed: number; failed: number; exhausted: number };
export class BillingReconciliationWorker {
  private readonly scopes: BillingProvider[];
  private readonly service: BillingService;
  constructor(private readonly options: BillingOptions = billingOptionsFromEnvironment()) {
    this.scopes = Object.values(options.providers ?? defaultProviders).filter((p): p is BillingProvider =>
      !!p && p.isConfigured() && !!p.reconcile && !!p.merchantAccountId && ['test','live'].includes(p.environment));
    if (this.scopes.some(p => p.environment === 'test') && !options.assertIsolation)
      throw new Error('RECONCILIATION_TEST_ISOLATION_REQUIRED');
    if (new Set(this.scopes.map(p => p.environment)).size > 1)
      throw new Error('RECONCILIATION_MIXED_ENVIRONMENTS');
    const providers: ProviderRegistry = {};
    for (const p of this.scopes) providers[p.id] = readOnly(p);
    this.service = new BillingService({ ...options, providers, salesEnabled: false, generationChargingEnabled: false });
  }
  async tick(): Promise<ReconciliationTick> {
    const stats = { claimed: 0, observed: 0, failed: 0, exhausted: 0 };
    // Default production config has no adapter: no DB access, no provider calls.
    if (!this.scopes.length) return stats;
    await this.options.assertIsolation?.();
    const scope = sql.join(this.scopes.map(p => sql`(o.provider=${p.id} AND o.environment=${p.environment}
      AND o.merchant_account_id=${p.merchantAccountId})`), sql` OR `);
    // Seed oldest unseen orders in bounded chunks, including paid orders (an
    // externally initiated refund may have lost its callback). Not latest-N.
    await database().execute(sql`INSERT INTO billing_reconciliation(order_id,refund_request_id)
      SELECT o.id,o.refund_request_id FROM billing_orders o
      WHERE (${scope}) AND o.status<>'refunded'
      AND NOT EXISTS(SELECT 1 FROM billing_reconciliation r WHERE r.order_id=o.id)
      ORDER BY o.created_at,o.id LIMIT ${reconciliationLimits.batch}
      ON CONFLICT DO NOTHING`);
    // A genuinely new refund request is a new observation episode. Updated_at
    // churn, failed queries and process restarts must never reset retry budgets.
    await database().execute(sql`WITH changed AS (
      SELECT r.order_id FROM billing_reconciliation r JOIN billing_orders o ON o.id=r.order_id
      WHERE (${scope}) AND o.status<>'refunded' AND o.refund_request_id IS NOT NULL
      AND r.refund_request_id IS DISTINCT FROM o.refund_request_id
      AND (r.lease_until IS NULL OR r.lease_until<now())
      ORDER BY r.next_attempt_at,r.order_id LIMIT ${reconciliationLimits.batch} FOR UPDATE OF r SKIP LOCKED
    ) UPDATE billing_reconciliation r SET refund_request_id=o.refund_request_id,state='scheduled',attempts=0,
      started_at=now(),next_attempt_at=now(),lease_token=NULL,lease_until=NULL,last_result=NULL,updated_at=now()
      FROM changed c,billing_orders o WHERE r.order_id=c.order_id AND o.id=c.order_id`);
    for (let i=0; i<reconciliationLimits.batch; i++) {
      const token = randomUUID();
      const [job] = await database().execute(sql`WITH candidate AS (
        SELECT r.order_id,r.attempts AS prior_attempts FROM billing_reconciliation r JOIN billing_orders o ON o.id=r.order_id
        WHERE (${scope}) AND r.state='scheduled' AND r.next_attempt_at<=now()
        AND (r.lease_until IS NULL OR r.lease_until<now())
        ORDER BY r.next_attempt_at,r.order_id LIMIT 1 FOR UPDATE OF r SKIP LOCKED
      ) UPDATE billing_reconciliation r SET lease_token=${token}::uuid,
        lease_until=now()+make_interval(secs=>${reconciliationLimits.leaseSeconds}),
        last_attempt_at=now(),updated_at=now(),attempts=least(attempts+1,${reconciliationLimits.attempts})
        FROM candidate c WHERE r.order_id=c.order_id
        RETURNING r.order_id,r.attempts,r.started_at,c.prior_attempts`);
      if (!job) break;
      stats.claimed++;
      let state = 'scheduled', result = 'observed';
      const [current] = await database().execute(sql`SELECT status,review_reason,refund_status FROM billing_orders WHERE id=${job.order_id}::uuid`);
      const expired = Date.now()-new Date(String(job.started_at)).getTime() >= reconciliationLimits.horizonDays*86400_000;
      if (current.status === 'refunded') state = 'complete';
      else if (Number(job.prior_attempts) >= reconciliationLimits.attempts || expired) {
        state = 'exhausted'; result = 'limit_reached'; stats.exhausted++;
      } else {
        try {
          const recovered = await this.service.reconcile(String(job.order_id));
          stats.observed++;
          if (recovered.order.status === 'refunded') state = 'complete';
          else if (recovered.order.reviewRequired || recovered.order.refundStatus === 'review_required') {
            state = 'review'; result = 'review_required';
          }
        } catch { result = 'query_failed'; stats.failed++; } // No provider text/credentials in logs.
      }
      const delay = Math.min(21_600, 60 * 2 ** Math.min(Number(job.attempts)-1, 9));
      await database().execute(sql`UPDATE billing_reconciliation SET state=${state},last_result=${result},
        next_attempt_at=now()+make_interval(secs=>${delay}),lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE order_id=${job.order_id}::uuid AND lease_token=${token}::uuid`);
    }
    return stats;
  }
}
