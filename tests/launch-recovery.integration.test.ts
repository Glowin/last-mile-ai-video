const AGE_POLICY_VERSION = "18-plus-2026-10-26"; // Historical migration fixture only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { sql, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migrate } from '../scripts/migrate.mjs';
import { database, closeDatabase } from '../src/server/db';
import { users, jobs, authSessions } from '../src/server/schema';
import { billingOrders } from '../src/server/billing/schema';
import { grantPurchase, lockWallet, reserveCredits } from '../src/server/credits/wallet';
import { createBillingModule } from '../src/server/billing/routes';
import type { BillingProvider, RefundCommand } from '../src/server/billing/providers';
import { assertRecoveryDatabase, recoveryDatabaseUrl } from './fixtures/launch-recovery-safety';

/* Existing credit-wallet.integration.test.ts covers in-process stale leases and late
 * settlement; billing.test.ts covers ordinary HTTP refund eligibility. New value:
 * SIGKILL during accepted POST, a new OS process and real DB, durable settlement
 * transition counts, and refund eligibility against genuinely recovered allocations.
 * Run only with LAUNCH_RECOVERY_DATABASE_URL pointing at the exact 55442 fixture.
 * Lease/24-hour aging below changes TEST ROW timestamps; we do not wait in real time.
 */
const enabled = !!process.env.LAUNCH_RECOVERY_DATABASE_URL;
const options = { skip: !enabled, timeout: 60_000 };
const original = { database: process.env.DATABASE_URL, app: process.env.APP_URL, session: process.env.SESSION_SECRET, fetch: global.fetch };
const origin = 'https://launch-recovery.example.invalid';
const secret = 'synthetic-launch-recovery-session-secret-only';
const children = new Set<ChildProcess>();
type Remote = { id: string; status: 'success' | 'failed' | 'unknown'; hold: boolean; entered: () => void; response?: ServerResponse };
const remote = new Map<string, Remote>();
const requests: { method: string; path: string; key?: string }[] = [];
let providerOrigin = '';
const server = createServer(async (req, res) => {
  const path = req.url!, method = req.method!;
  const key = req.headers['idempotency-key'] as string | undefined;
  requests.push({ method, path, key });
  if (method === 'POST') {
    // Consume the request first: the synthetic upstream has accepted this submission.
    for await (const _chunk of req) { /* synthetic input only */ }
    const task = remote.get(key!);
    if (!task) { res.writeHead(400).end(); return; }
    task.response = res;
    task.entered();
    if (task.hold) return; // Killed worker never receives upstream ID/response.
  }
  const url = new URL(path, 'http://localhost');
  const task = method === 'POST' ? remote.get(key!) : url.searchParams.has('client_request_id')
    ? remote.get(url.searchParams.get('client_request_id')!)
    : [...remote.values()].find((r) => `/tasks/${r.id}` === url.pathname);
  if (!task || task.status === 'unknown') { res.writeHead(503).end(); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: task.id, status: task.status,
    ...(task.status === 'success' ? { data: [{ url: 'https://synthetic.example.invalid/result.mp4' }] } : {}) }));
});

before(async () => {
  if (!enabled) return;
  await assertRecoveryDatabase(); // Actual role/database check BEFORE any migration or writes.
  // This exact role/database/port is exclusively disposable. Reset also removes
  // unresolved synthetic jobs from an interrupted previous run before workerTick.
  await database().execute(sql`DROP SCHEMA public CASCADE`);
  await database().execute(sql`CREATE SCHEMA public`);
  await migrate(recoveryDatabaseUrl());
  process.env.APP_URL = origin;
  process.env.SESSION_SECRET = secret;
  global.fetch = async () => { throw new Error('External network forbidden in launch tests'); };
  // Observability lives only in the dedicated disposable database; runtime is unchanged.
  await database().execute(sql`CREATE TABLE IF NOT EXISTS launch_recovery_transitions(job_id uuid, state text)`);
  await database().execute(sql`CREATE OR REPLACE FUNCTION launch_recovery_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO launch_recovery_transitions(job_id,state) VALUES(NEW.job_id,NEW.state); RETURN NEW; END; $$`);
  await database().execute(sql`DROP TRIGGER IF EXISTS launch_recovery_transition ON credit_allocations`);
  await database().execute(sql`CREATE TRIGGER launch_recovery_transition AFTER UPDATE OF state ON credit_allocations
    FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION launch_recovery_transition()`);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  providerOrigin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  for (const child of children) {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
  global.fetch = original.fetch;
  for (const [key, value] of Object.entries({ DATABASE_URL: original.database, APP_URL: original.app, SESSION_SECRET: original.session })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function launch(mode = 'tick', id = '') {
  // Whitelist env: no inherited upstream keys or production configuration.
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/launch-recovery-worker.ts', import.meta.url)), mode, id], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: 'test', LAUNCH_RECOVERY_DATABASE_URL: recoveryDatabaseUrl(), LAUNCH_RECOVERY_PROVIDER_ORIGIN: providerOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stderr = '';
  child.stderr!.on('data', (chunk) => { stderr += chunk; });
  // Install immediately so early child termination cannot be missed.
  const done = once(child, 'exit').then(([code, signal]) => { children.delete(child); return { code, signal, stderr }; });
  return { child, done };
}
async function run(mode = 'tick', id = '') {
  const worker = launch(mode, id);
  const result = await worker.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  return worker.child.pid;
}
async function actor() {
  const id = randomUUID(), sid = randomUUID();
  await database().insert(users).values({ id, googleSub: `launch-${id}`, email: `${id}@example.invalid`, ageConfirmedAt: new Date(), agePolicyVersion: AGE_POLICY_VERSION });
  await database().insert(authSessions).values({ id: sid, userId: id, expiresAt: new Date(Date.now() + 3_600_000) });
  const jwt = await new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
    .setIssuer('kakareel').setAudience('kakareel-studio').setExpirationTime('10m').sign(new TextEncoder().encode(secret));
  return { id, cookie: `kr_access=${jwt}` };
}
async function purchase(owner: string, paidAt = new Date()) {
  const id = randomUUID();
  await database().insert(billingOrders).values({ id, userId: owner, requestId: randomUUID(), productId: 'credits-starter', productName: 'Synthetic recovery pack', priceVersion: 'synthetic',
    provider: 'pancake', environment: 'test', merchantAccountId: 'synthetic-recovery', providerProductId: 'synthetic-product',
    providerPaymentId: `synthetic-payment-${id}`, amountMinor: 1900, subtotalMinor: 1900, taxMinor: 0, totalMinor: 1900, paidAmountMinor: 1900,
    currency: 'USD', credits: 150, status: 'paid', paidAt });
  await database().transaction((tx) => grantPurchase(tx, { orderId: id, userId: owner, environment: 'test', credits: 150, paidAt }));
  return id;
}
async function seed() {
  const owner = await actor(), order = await purchase(owner.id), id = randomUUID();
  await database().transaction(async (tx) => {
    await lockWallet(tx, owner.id, 'test');
    await tx.insert(jobs).values({ id, owner: owner.id, family: 'seedance', mode: 'text', prompt: 'Synthetic recovery only', duration: 5, resolution: '720p', fingerprint: `launch-${id}`,
      payload: { model: 'synthetic-only', prompt: 'Synthetic recovery' }, status: 'submitting', billingMode: 'paid', creditEnvironment: 'test', credits: 33, creditState: 'reserved' });
    await reserveCredits(tx, { jobId: id, userId: owner.id, environment: 'test', credits: 33 });
  });
  return { owner, order, id };
}
async function state(id: string) {
  const row = await database().query.jobs.findFirst({ where: eq(jobs.id, id) }); assert.ok(row); return row;
}
async function expireLease(id: string) {
  await database().execute(sql`UPDATE video_jobs SET lease_until=now()-interval '1 second', next_poll_at=now()-interval '1 second' WHERE id=${id}::uuid`);
}
async function accounting(id: string, order: string, consumed: number, reserved: number, transitions: string[]) {
  const [batch] = await database().execute(sql`SELECT consumed,reserved FROM credit_batches WHERE order_id=${order}::uuid`);
  assert.deepEqual(batch, { consumed, reserved });
  const rows = await database().execute(sql`SELECT state FROM launch_recovery_transitions WHERE job_id=${id}::uuid`);
  assert.deepEqual(rows.map((r) => r.state), transitions);
  const allocations = await database().execute(sql`SELECT credits,state FROM credit_allocations WHERE job_id=${id}::uuid`);
  assert.deepEqual([...allocations], [{ credits: 33, state: consumed ? 'consumed' : reserved ? 'reserved' : 'released' }]);
}
async function crashDuringPost(id: string, status: Remote['status']) {
  let entered!: () => void;
  const accepted = new Promise<void>((resolve) => { entered = resolve; });
  const task: Remote = { id: `original-${id}`, status, hold: true, entered };
  remote.set(id, task);
  const worker = launch();
  await Promise.race([accepted, worker.done.then((r) => { throw new Error(`Worker exited before accepted POST: ${r.stderr}`); })]);
  const before = await state(id);
  assert.ok(before.submissionStartedAt && before.leaseToken && before.leaseUntil);
  assert.equal(before.upstreamId, null, 'crash occurs before response persistence');
  worker.child.kill('SIGKILL');
  const result = await worker.done;
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.code, null);
  task.response?.destroy(); task.hold = false;
  // A fresh worker during the still-live lease must do nothing.
  const count = requests.length;
  assert.notEqual(await run(), worker.child.pid);
  assert.equal(requests.length, count);
  await expireLease(id);
  return task;
}
function assertOriginalOnly(id: string) {
  const seen = requests.filter((r) => r.key === id || r.path.includes(id));
  assert.equal(seen.filter((r) => r.method === 'POST').length, 1, 'never resubmit an ambiguous accepted request');
  assert.ok(seen.some((r) => r.method === 'GET' && r.path === `/tasks?client_request_id=${id}`));
  assert.ok(seen.filter((r) => r.method === 'GET').every((r) => r.path === `/tasks?client_request_id=${id}` || r.path === `/tasks/original-${id}`));
}

test('SIGKILL after upstream accepts POST: fresh competing workers query original and capture exactly once', options, async () => {
  const { id, order } = await seed();
  await crashDuringPost(id, 'success');
  await Promise.all([run(), run()]);
  assert.equal((await state(id)).status, 'success');
  assert.equal((await state(id)).creditState, 'consumed');
  await run('poll', id); await run();
  await accounting(id, order, 33, 0, ['consumed']);
  assertOriginalOnly(id);
});

test('SIGKILL with definitive upstream failure: restarted worker releases once and repeated recovery does nothing', options, async () => {
  const { id, order } = await seed();
  await crashDuringPost(id, 'failed');
  await run(); await run('poll', id); await run();
  assert.equal((await state(id)).status, 'failed');
  assert.equal((await state(id)).creditState, 'released');
  await accounting(id, order, 0, 0, ['released']);
  assertOriginalOnly(id);
});

test('unknown survives process restarts; late success captures once, operator compensation never recharges', options, async () => {
  for (const compensate of [false, true]) {
    const { id, order } = await seed();
    const task = await crashDuringPost(id, 'unknown');
    await run();
    assert.equal((await state(id)).status, 'unknown');
    await accounting(id, order, 0, 33, []);
    if (compensate) {
      await database().execute(sql`UPDATE video_jobs SET created_at=now()-interval '25 hours' WHERE id=${id}::uuid`);
      await run('poll', id);
      assert.equal((await state(id)).reviewRequired, true);
      await run('release', id); await run('release', id);
      await accounting(id, order, 0, 0, ['released']);
    }
    task.status = 'success';
    await run('poll', id); await run('poll', id);
    assert.equal((await state(id)).status, 'success');
    assert.equal((await state(id)).upstreamId, task.id);
    assert.equal((await state(id)).creditState, compensate ? 'released' : 'consumed');
    await accounting(id, order, compensate ? 0 : 33, 0, [compensate ? 'released' : 'consumed']);
    const audit = await database().execute(sql`SELECT action FROM credit_audit WHERE job_id=${id}::uuid AND action='operator-release'`);
    assert.equal(audit.length, compensate ? 1 : 0);
    assertOriginalOnly(id);
  }
});

test('refund API rejects expired/recovered-used/inflight-reserved/foreign packs without any channel call or state mutation', options, async () => {
  const calls: RefundCommand[] = [];
  const provider: BillingProvider = {
    id: 'pancake', environment: 'test', merchantAccountId: 'synthetic-recovery', checkoutHosts: [],
    capabilities: { hostedCheckout: true, fullRefundEvents: true, subscriptions: false }, isConfigured: () => true,
    createCheckout: async () => { throw new Error('Unexpected checkout'); },
    verifyAndNormalizeWebhook: async () => { throw new Error('Unexpected webhook'); },
    requestRefund: async (command) => { calls.push(command); return { ticketId: `synthetic-${command.requestId}`, status: 'processing' }; },
  };
  const module = createBillingModule({ providers: { pancake: provider }, assertIsolation: assertRecoveryDatabase });
  const app = new Hono().route('/api/billing', module.routes);
  const call = (who: Awaited<ReturnType<typeof actor>>, order: string) => app.request(`${origin}/api/billing/orders/${order}/refund`, {
    method: 'POST', headers: { cookie: who.cookie, origin, 'content-type': 'application/json', 'X-KakaReel-Owner': who.id }, body: '{}',
  });
  const snapshot = async (order: string) => {
    const [row] = await database().execute(sql`SELECT o.refund_status,o.refund_request_id,b.refund_frozen,b.reserved,b.consumed
      FROM billing_orders o JOIN credit_batches b ON b.order_id=o.id WHERE o.id=${order}::uuid`);
    return row;
  };
  const used = await seed(); await crashDuringPost(used.id, 'success'); await run();
  const reserved = await seed(); await crashDuringPost(reserved.id, 'unknown'); await run();
  // Suppress unrelated polls in later ticks; this row remains a real reserved unknown.
  await database().execute(sql`UPDATE video_jobs SET next_poll_at=now()+interval '1 day' WHERE id=${reserved.id}::uuid`);
  const owner = await actor(), other = await actor();
  const expired = await purchase(owner.id, new Date(Date.now() - 15 * 86_400_000));
  const fresh = await purchase(owner.id);
  for (const [who, order, status, code] of [
    [owner, expired, 409, 'REFUND_WINDOW_CLOSED'],
    [used.owner, used.order, 409, 'REFUND_PACK_USED_OR_RESERVED'],
    [reserved.owner, reserved.order, 409, 'REFUND_PACK_USED_OR_RESERVED'],
    [other, fresh, 404, 'ORDER_NOT_FOUND'],
  ] as const) {
    const before = await snapshot(order);
    for (const response of await Promise.all([call(who, order), call(who, order)])) {
      assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    }
    assert.equal(calls.length, 0); assert.deepEqual(await snapshot(order), before);
  }
  // Counterexample proves that the configured channel spy is reachable for eligible owner.
  const allowed = await call(owner, fresh);
  assert.equal(allowed.status, 200, await allowed.clone().text());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].orderId, fresh);
  assert.equal((await snapshot(fresh)).refund_frozen, true);
  assert.equal((await call(other, fresh)).status, 404, 'foreign user cannot read/reuse a now-processing refund');
  assert.equal((await call(owner, fresh)).status, 200);
  assert.equal(calls.length, 1);
});
