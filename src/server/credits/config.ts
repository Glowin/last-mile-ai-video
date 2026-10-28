import { z } from "zod";

/** Public release gate: change only after real delivery acceptance. Never enabled by an environment variable. */
export const GENERATION_CHARGING_ENABLED = false;
export type CreditEnvironment = "test" | "live";
export type ChargingPolicy = { enabled: boolean; environment: CreditEnvironment };
export const productionChargingPolicy: ChargingPolicy = Object.freeze({ enabled: GENERATION_CHARGING_ENABLED, environment: "live" });
export type GenerationPilot = Readonly<{ userId: string; requestId: string; expiresAt: string }>;
/** Separate from public charging. Invalid/partial/revoked config fails closed;
 * read at each new authorization, never prevent recovery of started jobs. */
export function generationPilotFromEnvironment(env: NodeJS.ProcessEnv = process.env, now = Date.now()): GenerationPilot | null {
  const parsed = z.object({ userId: z.uuid(), requestId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) })
    .safeParse({ userId: env.GENERATION_LIVE_PILOT_USER_ID, requestId: env.GENERATION_LIVE_PILOT_REQUEST_ID,
      expiresAt: env.GENERATION_LIVE_PILOT_EXPIRES_AT });
  if (!parsed.success || Date.parse(parsed.data.expiresAt) > now + 24 * 3_600_000) return null;
  return Object.freeze({ userId: parsed.data.userId.toLowerCase(), requestId: parsed.data.requestId.toLowerCase(),
    expiresAt: new Date(parsed.data.expiresAt).toISOString() });
}
