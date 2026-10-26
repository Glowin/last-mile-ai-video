import assert from 'node:assert/strict';
import postgres from 'postgres';

// Synthetic, disposable identity only. Refuse another agent's or a real database.
export function recoveryDatabaseUrl() {
  const value = process.env.LAUNCH_RECOVERY_DATABASE_URL;
  assert.ok(value, 'Set LAUNCH_RECOVERY_DATABASE_URL to the dedicated disposable database');
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55442');
  assert.equal(url.pathname, '/kakareel_launch_recovery_55442_billing_sandbox');
  assert.equal(url.username, 'kakareel_launch_recovery_55442_test');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return value;
}

export async function assertRecoveryDatabase() {
  const url = recoveryDatabaseUrl();
  const client = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const [row] = await client`SELECT current_database() AS db, current_user AS role`;
    assert.equal(row.db, 'kakareel_launch_recovery_55442_billing_sandbox');
    assert.equal(row.role, 'kakareel_launch_recovery_55442_test');
  } finally { await client.end(); }
  process.env.DATABASE_URL = url;
}
