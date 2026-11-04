/** Public retail credits only. Unverified settings deliberately have no price. */
export const VIDEO_PRICE_VERSION = "video-2026-10-28-v1";
export const VIDEO_CREDIT_RATES = [
  { family: "seedance", mode: "text", resolution: "720p", duration: 5, credits: 33 },
  { family: "seedance", mode: "text", resolution: "720p", duration: 10, credits: 65 },
  { family: "seedance", mode: "text", resolution: "1080p", duration: 5, credits: 80 },
  { family: "seedance", mode: "text", resolution: "1080p", duration: 10, credits: 160 },
  { family: "kling", mode: "text", resolution: "4K", duration: 5, credits: 72 },
  { family: "kling", mode: "text", resolution: "4K", duration: 10, credits: 143 },
  { family: "minimax", mode: "text", resolution: "2K", duration: 6, credits: 23 },
  { family: "minimax", mode: "text", resolution: "2K", duration: 10, credits: 38 },
  { family: "minimax", mode: "image", resolution: "2K", duration: 6, credits: 23 },
] as const;
export function videoCredits(input: { family: string; mode: string; resolution: string; duration: number }): number | null {
  return VIDEO_CREDIT_RATES.find(r => r.family === input.family && r.mode === input.mode && r.resolution === input.resolution && r.duration === input.duration)?.credits ?? null;
}

/** Initially released paid specification, verified end to end on 2026-11-04.
 * Publishing other retail prices does not release their supplier capacity. */
export const PUBLIC_PAID_GENERATION_SPEC = Object.freeze({
  family: "minimax", mode: "image", duration: 6, resolution: "2K", ratio: "adaptive", audio: false,
} as const);
export function publicPaidGenerationAllowed(input: { family: string; mode: string; duration: number; resolution: string; ratio: string; audio: boolean }): boolean {
  return Object.entries(PUBLIC_PAID_GENERATION_SPEC).every(([key,value]) => input[key as keyof typeof input] === value);
}
