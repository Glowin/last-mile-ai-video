import { createHash } from 'node:crypto';
import type { jobs } from '../schema';

export const MVP_POLICY = 'mvp-text-only-v1' as const;
export const MANUAL_POLICY = 'manual-v1' as const;
export type ReviewPolicy = {
  version: typeof MVP_POLICY | typeof MANUAL_POLICY;
  maxWaitSeconds: number;
  maxAttempts: number;
  timeoutMs: number;
  retryDelaysMs: readonly [5000, 10000];
  reviewDelayMs: 60000;
};
function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('INVALID_REVIEW_POLICY_CONFIG');
  return Math.max(min, Math.min(max, n));
}
/** Read only at NEW job creation; the resulting policy is immutable in the DB. */
export function reviewPolicy(env: NodeJS.ProcessEnv = process.env): ReviewPolicy {
  const selected = env.GENERATION_REVIEW_POLICY || MANUAL_POLICY;
  if (![MANUAL_POLICY, 'manual', MVP_POLICY].includes(selected)) throw new Error('INVALID_REVIEW_POLICY');
  return Object.freeze({ version: selected === MVP_POLICY ? MVP_POLICY : MANUAL_POLICY,
    maxWaitSeconds: bounded(env.GENERATION_REVIEW_MAX_WAIT_SECONDS, 300, 30, 900),
    maxAttempts: bounded(env.GENERATION_REVIEW_MAX_ATTEMPTS, 3, 1, 3),
    timeoutMs: bounded(env.GENERATION_REVIEW_TIMEOUT_MS, 10000, 1000, 30000),
    retryDelaysMs: [5000, 10000] as const, reviewDelayMs: 60000 });
}
/** Independent emergency switch, not the policy selector or public charging gate. */
export function mvpAutomationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.GENERATION_MVP_AUTOMATION_ENABLED === 'true';
}
function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => JSON.stringify(key) + ':' + canonical(value)).join(',') + '}';
}
export function automationBinding(job: typeof jobs.$inferSelect) {
  // Guest sign-in changes owner without changing content. Ownership is enforced
  // by the authenticated API; it is deliberately not a content-review binding.
  return createHash('sha256').update(canonical({ id: job.id, fingerprint: job.fingerprint,
    prompt: job.prompt, family: job.family, mode: job.mode, duration: job.duration,
    resolution: job.resolution, payload: job.payload })).digest('hex');
}
export function automationIdentity(job: typeof jobs.$inferSelect) {
  return automationBinding({ ...job, payload: null });
}
