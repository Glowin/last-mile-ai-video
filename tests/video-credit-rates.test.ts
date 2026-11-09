import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_CREDIT_RATES, videoCredits, publicPaidGenerationAllowed, PUBLIC_PAID_GENERATION_SPECS } from '../src/lib/video-credit-rates';
import { generationFingerprint } from '../src/server/credits/quotes';
import { publicAddress, videoHeader } from '../src/server/jobs/delivery';
import { GENERATION_CHARGING_ENABLED } from '../src/server/credits/config';
import { families, ratios, resolutions } from '../src/lib/models';
import { generationSchema, providerPayload } from '../src/server/input';
import { createApp } from '../src/server/app';
test('eight text rates stay unchanged and only MiniMax 6s 2K image is added at 23 credits',()=>{
  assert.deepEqual(VIDEO_CREDIT_RATES.map(x=>x.credits),[33,65,80,160,72,143,23,38,23]);
  for(const r of VIDEO_CREDIT_RATES) {
    assert.equal(videoCredits(r),r.credits);
    assert.equal(videoCredits({...r,mode:'image'}),r.family==='minimax' && r.duration===6 ? 23 : null);
    assert.equal(videoCredits({...r,duration:30}),null);
  }
  assert.equal(GENERATION_CHARGING_ENABLED,true);
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

test('public paid release preserves the verified MiniMax image specification',()=>{
 const x={family:'minimax',mode:'image',duration:6,resolution:'2K',ratio:'adaptive',audio:false};
 assert.equal(publicPaidGenerationAllowed(x),true);
 for(const change of [{family:'kling'},{mode:'text'},{duration:10},{resolution:'768P'},{ratio:'16:9'},{audio:true}])
  assert.equal(publicPaidGenerationAllowed({...x,...change}),false);
});


test('paid release is exactly six silent text tiers across supported ratios plus original MiniMax image',()=>{
 assert.equal(PUBLIC_PAID_GENERATION_SPECS.length,31);
 let allowed=0;
 for(const family of families) for(const mode of ['text','image'] as const)
 for(const resolution of resolutions(family.slug,mode)) for(const duration of family.durations)
 for(const ratio of ratios(family.slug,mode)) for(const audio of [false,true]) {
  const spec={family:family.slug,mode,resolution,duration,ratio,audio};
  const expected=!audio && (family.slug==='minimax'
   ? mode==='image' && duration===6
   : mode==='text' && [5,10].includes(duration));
  assert.equal(publicPaidGenerationAllowed(spec),expected,JSON.stringify(spec));
  if(expected) {
   allowed++;
   const parsed=generationSchema.parse({...spec,requestId:'00000000-0000-4000-8000-000000000001',prompt:'A leaf',...(mode==='image'?{image:'data:image/png;base64,iVBORw0KGgoAAAAA'}:{})});
   const payload=providerPayload(parsed);
   assert.equal(payload.model,mode==='text'?family.t2v:family.i2v);
   if(family.slug==='seedance') {assert.equal(payload.generate_audio,false);assert.equal(payload.ratio,ratio);}
   if(family.slug==='kling') {assert.equal(payload.sound,false);assert.equal(payload.aspect_ratio,ratio);}
  }
 }
 assert.equal(allowed,31);
 for(const change of [{ratio:'adaptive'},{ratio:'2:1'},{resolution:'480p'},{duration:30},{family:'unknown'}])
  assert.equal(publicPaidGenerationAllowed({family:'seedance',mode:'text',resolution:'720p',duration:5,ratio:'16:9',audio:false,...change}),false);
});
