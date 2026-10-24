import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { database, closeDatabase } from '../src/server/db';
import { migrate } from '../scripts/migrate.mjs';
import { BillingReconciliationWorker } from '../src/server/billing/reconciliation-worker';
import { BillingService } from '../src/server/billing/service';
import type { BillingProvider, PancakePaymentEvent } from '../src/server/billing/providers';

const input = process.env.BILLING_RECONCILIATION_TEST_DATABASE_URL;
const dbName = 'reconciliation_55443_billing_sandbox', role = 'reconciliation_55443_billing_test';
async function isolation() {
  const [r] = await database().execute(sql`SELECT current_database() AS name,current_user AS role`);
  assert.equal(r.name, dbName); assert.equal(r.role, role);
}
test('reconciliation without configured providers does not access DB or enable sales', async () => {
  assert.deepEqual(await new BillingReconciliationWorker({}).tick(), { claimed:0,observed:0,failed:0,exhausted:0 });
  assert.equal(new BillingService({}).catalog().checkoutEnabled,false);
});
test('isolated PostgreSQL scheduling and actual BillingService ledger recovery', { skip: !input }, async t => {
  const url = new URL(input!);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55443');
  assert.equal(url.pathname,`/${dbName}`); assert.equal(url.username,role); assert.equal(url.search,'');
  process.env.DATABASE_URL = input;
  await isolation(); // Validate actual database/role before any migration or fixture mutation.
  await migrate(input);
  await database().execute(sql`TRUNCATE users CASCADE`); // Dedicated verified test DB only.
  const events = new Map<string,PancakePaymentEvent[]>(), counts = new Map<string,number>();
  const errors = new Set<string>();
  let gate: (()=>Promise<void>) | undefined, writes=0, refundQueries=0;
  const provider: BillingProvider = {
    id:'pancake',environment:'test',merchantAccountId:'fixture-store',checkoutHosts:[],
    capabilities:{hostedCheckout:true,fullRefundEvents:true,subscriptions:false},isConfigured:()=>true,
    createCheckout:async()=>{writes++;throw Error('forbidden');},requestRefund:async()=>{writes++;throw Error('forbidden');},
    verifyAndNormalizeWebhook:async()=>{throw Error('unused');},
    reconcile:async id=>{ counts.set(id,(counts.get(id)??0)+1); if(gate) await gate(); if(errors.has(id)) throw Error('fixture failure'); return events.get(id)??[]; },
    reconcileRefund:async()=>{refundQueries++;return {ticketId:null,status:'unknown'};},
  };
  const options={providers:{pancake:provider},assertIsolation:isolation,salesEnabled:false};
  const worker=()=>new BillingReconciliationWorker(options);
  async function seed(environment='test', merchant='fixture-store') {
    const id=randomUUID(),user=randomUUID();
    await database().execute(sql`INSERT INTO users(id,google_sub,email) VALUES(${user}::uuid,${user},'fixture@example.invalid')`);
    await database().execute(sql`INSERT INTO billing_orders(id,user_id,request_id,product_id,product_name,price_version,
      provider,environment,merchant_account_id,provider_product_id,amount_minor,subtotal_minor,currency,credits)
      VALUES(${id}::uuid,${user}::uuid,${randomUUID()}::uuid,'fixture','Fixture','v1','pancake',${environment},${merchant},'external-fixture',1900,1900,'USD',150)`);
    const e: PancakePaymentEvent={evidenceType:'pancake',eventId:`paid-${id}`,environment:'test',merchantAccountId:'fixture-store',orderId:id,userId:user,
      productId:'fixture',providerProductId:'external-fixture',priceVersion:'v1',providerOrderId:`external-${id}`,paymentId:`payment-${id}`,
      kind:'payment.succeeded',currency:'USD',amountMinor:1900,subtotalMinor:1900,taxMinor:0,totalMinor:1900,originalPaidAmountMinor:1900,
      reviewReason:null,paidAt:new Date().toISOString()};
    events.set(id,[e]);return {id,user,e};
  }
  async function row(id:string) { const [r]=await database().execute(sql`SELECT * FROM billing_reconciliation WHERE order_id=${id}::uuid`);return r; }
  async function due(id:string) {await database().execute(sql`UPDATE billing_reconciliation SET next_attempt_at=now()-interval '1 second' WHERE order_id=${id}::uuid`);}
  async function ledger(id:string) { const [r]=await database().execute(sql`SELECT count(*)::int n,coalesce(sum(credits),0)::int credits FROM credit_ledger WHERE order_id=${id}::uuid`);return {...r}; }
  try {
    await t.test('requires test isolation and refuses mixed test/live adapters',()=>{
      assert.throws(()=>new BillingReconciliationWorker({providers:{pancake:provider}}),/ISOLATION/);
      assert.throws(()=>new BillingReconciliationWorker({...options,providers:{pancake:provider,stripe:{...provider,id:'stripe',environment:'live'}}}),/MIXED/);
    });
    await t.test('two concurrent workers recover missing payment callback only once and exclude foreign scope',async()=>{
      const a=await seed(), live=await seed('live'),foreign=await seed('test','other-store');
      let release!:()=>void,entered!:()=>void;
      const started=new Promise<void>(r=>entered=r), hold=new Promise<void>(r=>release=r);
      gate=async()=>{entered();await hold;};
      const first=worker().tick();await started;
      try { assert.equal((await worker().tick()).claimed,0); } finally {gate=undefined;release();}
      await first;
      assert.equal(counts.get(a.id),1);assert.equal(counts.get(live.id),undefined);assert.equal(counts.get(foreign.id),undefined);
      assert.deepEqual(await ledger(a.id),{n:1,credits:150});
      await due(a.id);await worker().tick();assert.deepEqual(await ledger(a.id),{n:1,credits:150});
    });
    await t.test('SIGKILL leaves durable lease; restarted worker only recovers after expiry',async()=>{
      const a=await seed();
      const source = `
        import { BillingReconciliationWorker } from './src/server/billing/reconciliation-worker.ts';
        import { database } from './src/server/db.ts';
        import { sql } from 'drizzle-orm';
        const provider={id:'pancake',environment:'test',merchantAccountId:'fixture-store',checkoutHosts:[],
          capabilities:{hostedCheckout:true,fullRefundEvents:true,subscriptions:false},isConfigured:()=>true,
          createCheckout:async()=>{throw Error('forbidden')},verifyAndNormalizeWebhook:async()=>{throw Error('unused')},
          reconcile:async()=>{process.stdout.write('QUERY_STARTED\\n');await new Promise(()=>{});return []}};
        const assertIsolation=async()=>{const [r]=await database().execute(sql\`SELECT current_database() AS name,current_user AS role\`);
          if(r.name!=='${dbName}'||r.role!=='${role}')throw Error('scope');};
        await new BillingReconciliationWorker({providers:{pancake:provider},assertIsolation}).tick();`;
      const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{
        cwd:process.cwd(),env:{NODE_ENV:'test',PATH:process.env.PATH,DATABASE_URL:input},stdio:['ignore','pipe','pipe']});
      const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
      try {
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('child query did not start')),10_000);
          child.stdout.on('data',chunk=>{if(String(chunk).includes('QUERY_STARTED')){clearTimeout(timer);resolve();}});
          child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited early'));});
          child.once('error',reject);
        });
      } finally {child.kill('SIGKILL');await exited;}
      const persisted=await row(a.id);assert.ok(persisted.lease_token);assert.equal(persisted.attempts,1);
      await closeDatabase();await isolation();await worker().tick();assert.equal(counts.get(a.id),undefined);
      await database().execute(sql`UPDATE billing_reconciliation SET lease_until=now()-interval '1 second' WHERE order_id=${a.id}::uuid`);
      await worker().tick();assert.equal(counts.get(a.id),1);assert.deepEqual(await ledger(a.id),{n:1,credits:150});
    });
    await t.test('stale worker cannot clear another claimant lease',async()=>{
      const a=await seed();let release!:()=>void,entered!:()=>void;
      const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
      gate=async()=>{entered();await held;};const pending=worker().tick();await started;
      const replacement=randomUUID();
      try {await database().execute(sql`UPDATE billing_reconciliation SET lease_token=${replacement}::uuid,lease_until=now()+interval '120 seconds' WHERE order_id=${a.id}::uuid`);}
      finally {gate=undefined;release();}
      await pending;assert.equal((await row(a.id)).lease_token,replacement);
      assert.deepEqual(await ledger(a.id),{n:1,credits:150});
    });
    await t.test('one failed query does not abort batch; backoff persists and later orders are fairly discovered',async()=>{
      const fixtures=[];for(let i=0;i<23;i++) fixtures.push(await seed());
      errors.add(fixtures[0].id);
      for(let i=0;i<3;i++) assert.ok((await worker().tick()).claimed<=10);
      for(const a of fixtures) assert.equal(counts.get(a.id),1);
      const a=fixtures[0],r=await row(a.id);assert.equal(r.last_result,'query_failed');assert.equal(r.attempts,1);
      assert.ok(new Date(String(r.next_attempt_at)).getTime()>Date.now()+40_000);
      await closeDatabase();await worker().tick();assert.equal(counts.get(a.id),1);
      await due(a.id);await worker().tick();assert.equal((await row(a.id)).attempts,2);
      assert.ok(new Date(String((await row(a.id)).next_attempt_at)).getTime()>Date.now()+100_000);
      errors.delete(a.id);
    });
    await t.test('refund unknown remains frozen through exhaustion; original request query never creates another refund',async()=>{
      const a=await seed();await worker().tick();
      await database().execute(sql`UPDATE credit_batches SET refund_frozen=true WHERE order_id=${a.id}::uuid`);
      await database().execute(sql`UPDATE billing_orders SET refund_status='unknown',refund_request_id=${randomUUID()}::uuid WHERE id=${a.id}::uuid`);
      await worker().tick();assert.ok(refundQueries>0);
      const [b]=await database().execute(sql`SELECT refund_frozen FROM credit_batches WHERE order_id=${a.id}::uuid`);assert.equal(b.refund_frozen,true);
      await database().execute(sql`UPDATE billing_reconciliation SET attempts=64,next_attempt_at=now() WHERE order_id=${a.id}::uuid`);
      const before=counts.get(a.id);await worker().tick();assert.equal((await row(a.id)).state,'exhausted');assert.equal(counts.get(a.id),before);
      await due(a.id);await worker().tick();assert.equal(counts.get(a.id),before);
      const [o]=await database().execute(sql`SELECT refund_status FROM billing_orders WHERE id=${a.id}::uuid`);assert.equal(o.refund_status,'unknown');
      assert.deepEqual(await ledger(a.id),{n:1,credits:150});
    });
    await t.test('missing refund callback recovers one reversal; callback/re-query races do not duplicate credits',async()=>{
      const a=await seed();await worker().tick();
      events.set(a.id,[{...a.e,eventId:`refund-${a.id}`,kind:'payment.refunded'},a.e]);
      await due(a.id);
      await Promise.all([worker().tick(),new BillingService(options).reconcile(a.id)]);
      assert.deepEqual(await ledger(a.id),{n:2,credits:0});assert.equal((await row(a.id)).state,'complete');
      await new BillingService(options).reconcile(a.id);assert.deepEqual(await ledger(a.id),{n:2,credits:0});
    });
    await t.test('age limit stops queries; incomplete evidence enters review without fabricated credits',async()=>{
      const a=await seed();events.set(a.id,[]);await worker().tick();
      await database().execute(sql`UPDATE billing_reconciliation SET started_at=now()-interval '31 days',next_attempt_at=now() WHERE order_id=${a.id}::uuid`);
      await worker().tick();assert.equal(counts.get(a.id),1);assert.equal((await row(a.id)).state,'exhausted');
      const b=await seed();events.set(b.id,[{...b.e,amountMinor:null,reviewReason:'MISSING_RECEIPT'}]);await worker().tick();
      assert.equal((await row(b.id)).state,'review');assert.deepEqual(await ledger(b.id),{n:0,credits:0});
    });
    await t.test('timed-out provider result is discarded before money application; later explicit query recovers',async()=>{
      const a=await seed();let release!:()=>void;
      const hold=new Promise<void>(r=>release=r);gate=()=>hold;
      try {await worker().tick();} finally {gate=undefined;release();}
      await new Promise(r=>setImmediate(r));
      assert.equal((await row(a.id)).last_result,'query_failed');assert.deepEqual(await ledger(a.id),{n:0,credits:0});
      await due(a.id);await worker().tick();assert.deepEqual(await ledger(a.id),{n:1,credits:150});
    });
    assert.equal(writes,0,'no new checkout or refund request across all recovery paths');
  } finally {await closeDatabase();}
});
