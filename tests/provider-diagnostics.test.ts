import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError, providerRequest } from '../src/server/provider';

test('provider rejection records only status, operation and a validated task ID', async () => {
  const oldFetch=global.fetch, oldWarn=console.warn, oldKey=process.env.VIBETOKEN_API_KEY;
  const logs:unknown[][]=[];
  const id='11111111-1111-4111-8111-111111111111';
  process.env.VIBETOKEN_API_KEY='synthetic-secret';
  console.warn=(...args:unknown[])=>{ logs.push(args); };
  global.fetch=async()=>new Response('private prompt, synthetic-secret, signed URL',{status:422});
  try {
    await assert.rejects(providerRequest('',{method:'POST',headers:{'Idempotency-Key':id},body:JSON.stringify({model:'example',prompt:'private'})}),
      e=>e instanceof ProviderError && e.status===422);
    assert.deepEqual(logs,[['video_provider_rejected',JSON.stringify({operation:'submit',status:422,jobId:id})]]);
    logs.length=0;
    await assert.rejects(providerRequest('?client_request_id=private',{headers:{'Idempotency-Key':'do-not-log-me'}}));
    assert.deepEqual(logs,[['video_provider_rejected',JSON.stringify({operation:'query',status:422})]]);
  } finally {
    global.fetch=oldFetch;console.warn=oldWarn;
    if(oldKey===undefined) delete process.env.VIBETOKEN_API_KEY; else process.env.VIBETOKEN_API_KEY=oldKey;
  }
});
