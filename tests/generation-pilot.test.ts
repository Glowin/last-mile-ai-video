import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generationPilotFromEnvironment, productionChargingPolicy, GENERATION_CHARGING_ENABLED } from '../src/server/credits/config';
import { generationPilotAllows } from '../src/server/credits/pilot';
import type { GenerationInput } from '../src/server/input';
import { generationPilotInputAllowed, type GenerationPilotOffer } from '../src/lib/billing';

const now = Date.parse('2026-10-28T08:00:00Z');
const userId = randomUUID(), requestId = randomUUID();
const env = { NODE_ENV: 'test' as const, GENERATION_LIVE_PILOT_USER_ID: userId, GENERATION_LIVE_PILOT_REQUEST_ID: requestId,
  GENERATION_LIVE_PILOT_EXPIRES_AT: new Date(now + 3600_000).toISOString() };
const input: GenerationInput = { requestId, family:'minimax',mode:'image',duration:6,resolution:'2K',ratio:'adaptive',audio:false,prompt:'Synthetic',image:'synthetic' };
test('pilot config is complete, bounded and fails closed without enabling public charging', () => {
  const pilot = generationPilotFromEnvironment(env, now)!;
  assert.deepEqual(pilot, {userId,requestId,expiresAt:env.GENERATION_LIVE_PILOT_EXPIRES_AT});
  assert.equal(GENERATION_CHARGING_ENABLED,false);
  assert.equal(productionChargingPolicy.enabled,false);
  assert.equal(generationPilotFromEnvironment({NODE_ENV:'test'},now),null);
  for (const key of ['GENERATION_LIVE_PILOT_USER_ID','GENERATION_LIVE_PILOT_REQUEST_ID','GENERATION_LIVE_PILOT_EXPIRES_AT'] as const)
    assert.equal(generationPilotFromEnvironment({...env,[key]:''},now),null);
  for (const extra of [{GENERATION_LIVE_PILOT_USER_ID:'not-uuid'}, {GENERATION_LIVE_PILOT_REQUEST_ID:'not-uuid'},
    {GENERATION_LIVE_PILOT_EXPIRES_AT:'2026-10-28'}, {GENERATION_LIVE_PILOT_EXPIRES_AT:new Date(now+86400_001).toISOString()}])
    assert.equal(generationPilotFromEnvironment({...env,...extra},now),null);
  const expired=generationPilotFromEnvironment({...env,GENERATION_LIVE_PILOT_EXPIRES_AT:new Date(now-1).toISOString()},now);
  assert.ok(expired,'expired config is parseable without blocking restarts or recovery');
  assert.equal(generationPilotAllows(userId,input,productionChargingPolicy,expired,now),false);
});
test('owner, fixed request, exact specification and live wallet are mandatory', () => {
  const pilot=generationPilotFromEnvironment(env,now)!;
  assert.equal(generationPilotAllows(userId,input,productionChargingPolicy,pilot,now),true);
  assert.equal(generationPilotAllows(randomUUID(),input,productionChargingPolicy,pilot,now),false);
  for(const change of [{requestId:randomUUID()},{family:'kling'},{mode:'text'},{duration:10},{resolution:'1080p'},{ratio:'16:9'},{audio:true}])
    assert.equal(generationPilotAllows(userId,{...input,...change} as GenerationInput,productionChargingPolicy,pilot,now),false);
  assert.equal(generationPilotAllows(userId,input,{enabled:false,environment:'test'},pilot,now),false);
  assert.equal(generationPilotAllows(userId,input,{enabled:true,environment:'live'},pilot,now),false,'public path does not acquire pilot restrictions');
});
test('browser trial hint requires exact inputs, an unused slot and unexpired window', () => {
  const offer: GenerationPilotOffer={requestId,expiresAt:env.GENERATION_LIVE_PILOT_EXPIRES_AT,credits:23,available:true,jobId:null,
    spec:{family:'minimax',mode:'image',duration:6,resolution:'2K',ratio:'adaptive',audio:false}};
  assert.equal(generationPilotInputAllowed(offer,input,now),true);
  assert.equal(generationPilotInputAllowed(offer,{...input,audio:true},now),false);
  assert.equal(generationPilotInputAllowed({...offer,available:false,jobId:requestId},input,now),false);
  assert.equal(generationPilotInputAllowed(offer,input,now+3600_000),false);
});
