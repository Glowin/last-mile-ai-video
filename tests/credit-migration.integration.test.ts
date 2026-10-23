import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
const creditTestDatabaseUrl=process.env.CREDIT_TEST_DATABASE_URL;
const integration=!!creditTestDatabaseUrl;
test('migration backfills purchase/refund history and prevents legacy preview resubmission', {skip:!integration},async()=>{
 const u=new URL(creditTestDatabaseUrl!);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55439');assert.equal(u.pathname,'/video_credit_qa');
 const client=postgres(creditTestDatabaseUrl!,{max:1,onnotice:()=>{}});
 const schema=`credit_migration_${randomUUID().replaceAll('-','')}`;
 try {
  await client.begin(async tx=>{
   await tx.unsafe(`CREATE SCHEMA ${schema}`);
   await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
   for(const file of ['0001-init.sql','0002-google-auth.sql','0003-billing.sql']) await tx.unsafe(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
   const user=randomUUID(),order=randomUUID(),purchaseEvent=randomUUID(),refundEvent=randomUUID(),job=randomUUID();
   await tx`INSERT INTO users(id,google_sub,email) VALUES(${user},'legacy-qa','qa@example.test')`;
   await tx`INSERT INTO billing_orders(id,user_id,request_id,product_id,product_name,price_version,provider,environment,merchant_account_id,provider_product_id,amount_minor,currency,credits,status) VALUES(${order},${user},${randomUUID()},'old','Old pack','old','pancake','test','qa','qa',1900,'USD',150,'refunded')`;
   for(const [id,kind] of [[purchaseEvent,'payment.succeeded'],[refundEvent,'payment.refunded']]) await tx`INSERT INTO billing_events(id,provider,environment,merchant_account_id,provider_event_id,order_id,fingerprint,kind,outcome) VALUES(${id},'pancake','test','qa',${id},${order},'qa',${kind},'applied')`;
   await tx`INSERT INTO credit_ledger(id,user_id,order_id,environment,event_id,kind,credits) VALUES(${randomUUID()},${user},${order},'test',${purchaseEvent},'purchase',150),(${randomUUID()},${user},${order},'test',${refundEvent},'refund',-150)`;
   await tx`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,payload,status) VALUES(${job},${user},'seedance','text','legacy',5,'720p','qa','{"model":"qa"}'::jsonb,'submitting')`;
   await tx.unsafe(await readFile(new URL('../db/0004-credit-wallet.sql',import.meta.url),'utf8'));
   const [j]=await tx`SELECT * FROM video_jobs WHERE id=${job}`;
   assert.equal(j.billing_mode,'preview');assert.equal(j.credit_state,'none');assert.equal(j.credits,0);assert.ok(j.payload);
   assert.equal(j.submission_started_at.toISOString(),j.created_at.toISOString());
   const [b]=await tx`SELECT * FROM credit_batches WHERE order_id=${order}`;
   assert.equal(b.credits,150);assert.equal(b.refunded,true);assert.equal(b.reserved,0);
   await tx.unsafe(`DROP SCHEMA ${schema} CASCADE`);
  });
 } finally {await client.end();}
});
