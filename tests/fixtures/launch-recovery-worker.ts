import assert from 'node:assert/strict';
import { assertRecoveryDatabase } from './launch-recovery-safety';
import { closeDatabase } from '../../src/server/db';
import { workerTick, processJob, releaseForReview, type VideoProvider } from '../../src/server/jobs/runner';
import type { ProviderTask } from '../../src/server/provider';

// This is a fresh OS process running the production runner, not a mocked runner.
// The ONLY provider transport is the parent test's loopback HTTP server.
await assertRecoveryDatabase();
const origin = new URL(process.env.LAUNCH_RECOVERY_PROVIDER_ORIGIN!);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
assert.ok(Number(origin.port) > 0);
assert.equal(origin.pathname, '/');
assert.equal(origin.username, '');
assert.equal(origin.password, '');
const fetchLocal = global.fetch;
global.fetch = async () => { throw new Error('Real network forbidden in recovery worker'); };
const provider: VideoProvider = {
  kind: 'fake',
  async request(path, init) {
    const target = new URL(`/tasks${path}`, origin);
    assert.equal(target.origin, origin.origin);
    const response = await fetchLocal(target, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Synthetic provider unavailable');
    return await response.json() as ProviderTask;
  },
  // Delivery validation itself is covered by video-delivery.test.ts; no video network here.
  verifyDelivery: async (url) => url === 'https://synthetic.example.invalid/result.mp4',
};
try {
  const [mode, id] = process.argv.slice(2);
  if (mode === 'tick') await workerTick(provider, 100);
  else if (mode === 'poll') await processJob(id, provider, true, false);
  else if (mode === 'release') await releaseForReview(id, 'launch-recovery-fixture', 'Synthetic task unresolved after 24 hours; compensate once');
  else throw new Error('Unknown recovery worker mode');
} finally { await closeDatabase(); }
