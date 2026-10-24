/** Host supplies configuration. No credential files, write-provider calls or sales gate override. */
import { setTimeout as sleep } from 'node:timers/promises';
import { BillingReconciliationWorker } from '../src/server/billing/reconciliation-worker';
import { closeDatabase } from '../src/server/db';
const command = process.argv[2] ?? 'once';
const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());
try {
  if (!['once','run'].includes(command)) throw new Error('INVALID_COMMAND');
  const worker = new BillingReconciliationWorker();
  do {
    try { console.log(JSON.stringify(await worker.tick())); }
    catch { console.error('BILLING_RECONCILIATION_TICK_FAILED'); if (command==='once') process.exitCode=1; }
    if (command==='run' && !stop.signal.aborted)
      await sleep(5_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (command==='run' && !stop.signal.aborted);
} catch { console.error('BILLING_RECONCILIATION_START_FAILED'); process.exitCode=1; }
finally { await closeDatabase(); }
