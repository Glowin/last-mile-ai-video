import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_CREDIT_RATES, videoCredits } from '../src/lib/video-credit-rates';
import { generationFingerprint } from '../src/server/credits/quotes';
import { publicAddress, videoHeader } from '../src/server/jobs/delivery';
import { GENERATION_CHARGING_ENABLED } from '../src/server/credits/config';
import { createApp } from '../src/server/app';
test('only eight verified text prices are billable, with exact integer charges',()=>{
  assert.deepEqual(VIDEO_CREDIT_RATES.map(x=>x.credits),[33,65,80,160,72,143,23,38]);
  for(const r of VIDEO_CREDIT_RATES) {
    assert.equal(videoCredits(r),r.credits);
    assert.equal(videoCredits({...r,mode:'image'}),null);
    assert.equal(videoCredits({...r,duration:30}),null);
  }
  assert.equal(GENERATION_CHARGING_ENABLED,false);
});
test('fingerprint binds full input and is independent of key ordering',()=>{
  const x={requestId:'00000000-0000-4000-8000-000000000001',family:'seedance' as const,mode:'text' as const,prompt:'A leaf',duration:5,resolution:'720p',ratio:'16:9',audio:false};
  assert.equal(generationFingerprint(x),generationFingerprint(Object.fromEntries(Object.entries(x).reverse()) as typeof x));
  for(const change of [{prompt:'different'}, {audio:true}, {ratio:'9:16'}, {image:'data:image/png;base64,changed'}, {requestId:'00000000-0000-4000-8000-000000000002'}]) assert.notEqual(generationFingerprint(x),generationFingerprint({...x,...change}));
});
test('delivery requires both video MIME and actual container header; local addresses rejected',()=>{
  const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]);
  assert.equal(videoHeader('video/mp4',mp4),true);
  assert.equal(videoHeader('text/html',mp4),false);
  assert.equal(videoHeader('video/mp4',Buffer.from('<html>not a video</html>')),false);
  for(const a of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']) assert.equal(publicAddress(a),false,a);
  assert.equal(publicAddress('8.8.8.8'),true);
});
test('sandbox charging cannot use real provider or override live release gate',()=>{
  assert.throws(()=>createApp({charging:{enabled:true,environment:'test'}}),/fake/);
  assert.throws(()=>createApp({charging:{enabled:true,environment:'live'}}),/sandbox-only/);
});
