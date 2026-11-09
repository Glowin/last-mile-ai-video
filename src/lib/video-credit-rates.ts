import { ratios } from "./models";

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

/** Paid release is independent of published prices. Every input still requires
 * a current, exact supplier-cost rate and capacity before quoting/reserving. */
export type PublicPaidGenerationSpec = {
  family: string; mode: string; duration: number; resolution: string; ratio: string; audio: boolean;
};
export const PUBLIC_PAID_GENERATION_SPEC = Object.freeze({
  family: "minimax", mode: "image", duration: 6, resolution: "2K", ratio: "adaptive", audio: false,
} as const);
export const PUBLIC_PAID_GENERATION_SPECS: readonly PublicPaidGenerationSpec[] = Object.freeze([
  PUBLIC_PAID_GENERATION_SPEC,
  ...([
    {family: "seedance", mode: "text", resolution: "720p", duration: 5},
    {family: "seedance", mode: "text", resolution: "720p", duration: 10},
    {family: "seedance", mode: "text", resolution: "1080p", duration: 5},
    {family: "seedance", mode: "text", resolution: "1080p", duration: 10},
    {family: "kling", mode: "text", resolution: "4K", duration: 5},
    {family: "kling", mode: "text", resolution: "4K", duration: 10},
  ] as const)
    .flatMap(({family, mode, duration, resolution}) =>
      ratios(family, mode).map(ratio => Object.freeze({family, mode, duration, resolution, ratio, audio: false}))),
]);
export const PUBLIC_PAID_GENERATION_DESCRIPTION = "Paid generation supports Seedance 2.5 text-to-video (720p or 1080p, 5 or 10 seconds), Kling 3.0 text-to-video (4K, 5 or 10 seconds), and MiniMax H3 image-to-video (2K, 6 seconds, Match input image). Seedance and Kling use audio off. Request a current quote for your exact settings.";
export function publicPaidGenerationAllowed(input: PublicPaidGenerationSpec): boolean {
  return PUBLIC_PAID_GENERATION_SPECS.some(spec =>
    Object.entries(spec).every(([key,value]) => input[key as keyof typeof input] === value));
}
export function publicPaidRateAvailable(rate: {family: string; mode: string; duration: number; resolution: string}): boolean {
  return PUBLIC_PAID_GENERATION_SPECS.some(spec =>
    spec.family === rate.family && spec.mode === rate.mode && spec.duration === rate.duration && spec.resolution === rate.resolution);
}
