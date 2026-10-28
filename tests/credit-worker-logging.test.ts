import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

test('worker startup errors never expose connection/driver content', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/credit-worker.ts', 'once'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, DATABASE_URL: 'not-a-url-SENSITIVE_SYNTHETIC_SENTINEL' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'credit_worker_failed');
  assert.doesNotMatch(result.stderr, /SENSITIVE_SYNTHETIC_SENTINEL|DATABASE_URL|postgres:/);
});
