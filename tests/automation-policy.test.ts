import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewPolicy, mvpAutomationEnabled, automationBinding, automationIdentity } from '../src/server/moderation/policy';
import type { jobs } from '../src/server/schema';

test('manual default, explicit emergency switch and bounded frozen policy',()=>{
 const env={NODE_ENV:'test' as const};
 assert.equal(reviewPolicy(env).version,'manual-v1');assert.equal(mvpAutomationEnabled(env),false);
 const p=reviewPolicy({...env,GENERATION_REVIEW_POLICY:'mvp-text-only-v1',GENERATION_REVIEW_MAX_WAIT_SECONDS:'9999',GENERATION_REVIEW_MAX_ATTEMPTS:'10',GENERATION_REVIEW_TIMEOUT_MS:'1'});
 assert.deepEqual([p.maxWaitSeconds,p.maxAttempts,p.timeoutMs],[900,3,1000]);assert.equal(Object.isFrozen(p),true);
 assert.throws(()=>reviewPolicy({...env,GENERATION_REVIEW_POLICY:'typo'}));
 assert.throws(()=>reviewPolicy({...env,GENERATION_REVIEW_MAX_ATTEMPTS:'NaN'}));
});
test('content binding survives owner transfer but rejects content or task changes',()=>{
 const j={id:'job',owner:'guest',fingerprint:'fp',prompt:'bird',family:'minimax',mode:'image',duration:6,resolution:'2K',payload:{image:'exact',prompt:'bird'}} as unknown as typeof jobs.$inferSelect;
 assert.equal(automationBinding(j),automationBinding({...j,owner:'account'}));
 assert.equal(automationIdentity(j),automationIdentity({...j,owner:'account',payload:null}));
 for(const changed of [{id:'other'},{prompt:'other'},{payload:{image:'other'}},{fingerprint:'other'}]) assert.notEqual(automationBinding(j),automationBinding({...j,...changed}));
});
