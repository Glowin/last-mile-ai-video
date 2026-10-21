export const families = [
  {
    slug: "seedance",
    name: "Seedance 2.5",
    maker: "ByteDance",
    tag: "Scene & sound",
    description:
      "Describe a scene, its movement, and its soundtrack in one prompt.",
    t2v: "bytedance/seedance-2-5-t2v",
    i2v: "bytedance/seedance-2-5-i2v",
    defaultDuration: 5,
    durations: [4, 5, 6, 8, 10, 15, 20, 30],
    maxPrompt: 5000,
  },
  {
    slug: "kling",
    name: "Kling 3.0",
    maker: "Kuaishou",
    tag: "Motion & detail",
    description:
      "Explore camera movement with text or a single starting image.",
    t2v: "kuaishou/kling-v3-4k-t2v",
    i2v: "kuaishou/kling-v3-4k-i2v",
    defaultDuration: 5,
    durations: [3, 4, 5, 6, 8, 10, 15],
    maxPrompt: 2500,
  },
  {
    slug: "minimax",
    name: "MiniMax H3",
    maker: "MiniMax",
    tag: "A new perspective",
    description:
      "Turn a short description or a first frame into a 6- or 10-second clip.",
    t2v: "minimax/minimax-h3-t2v",
    i2v: "minimax/minimax-h3-i2v",
    defaultDuration: 6,
    durations: [6, 10],
    maxPrompt: 7000,
  },
] as const;
export type Family = (typeof families)[number];
export type FamilySlug = Family["slug"];
export type Mode = "text" | "image";
export function getFamily(slug: string): Family | undefined {
  return families.find((x) => x.slug === slug);
}
export function resolutions(slug: FamilySlug, _mode: Mode): string[] {
  // 480p t2v failed on the project account; see docs/vibetoken.md (2026-10-21).
  return slug === "seedance"
    ? ["720p", "1080p"]
    : slug === "minimax"
      ? ["2K"]
      : ["4K"];
}
export function ratios(slug: FamilySlug, mode: Mode): string[] {
  if (mode === "image") return ["adaptive"];
  return slug === "kling"
    ? ["16:9", "9:16", "1:1"]
    : ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
}
export type JobStatus =
  "submitting" | "pending" | "success" | "failed" | "unknown";
export type PublicJob = {
  id: string;
  family: string;
  mode: string;
  prompt: string;
  status: JobStatus;
  resultUrl: string | null;
  createdAt: string;
  duration: number;
  resolution: string;
};
