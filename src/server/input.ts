import { z } from "zod";
import { getFamily, ratios, resolutions } from "../lib/models";
export const generationSchema = z
  .object({
    requestId: z.string().uuid(),
    family: z.enum(["seedance", "kling", "minimax"]),
    mode: z.enum(["text", "image"]),
    prompt: z.string().trim().min(1).max(7000),
    duration: z.number().int(),
    resolution: z.string(),
    ratio: z.string(),
    audio: z.boolean(),
    image: z.string().max(4_300_000).optional(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const f = getFamily(x.family)!;
    if (!(f.durations as readonly number[]).includes(x.duration))
      ctx.addIssue({ code: "custom", message: "Choose a supported duration." });
    if (x.prompt.length > f.maxPrompt)
      ctx.addIssue({
        code: "custom",
        message: `Prompt must be ${f.maxPrompt} characters or fewer.`,
      });
    if (
      !resolutions(x.family, x.mode).includes(x.resolution) ||
      !ratios(x.family, x.mode).includes(x.ratio)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose supported output settings.",
      });
    if (x.mode === "image") {
      if (!x.image || !validImage(x.image))
        ctx.addIssue({
          code: "custom",
          message: "Upload a valid JPEG or PNG image, up to 3 MB.",
        });
    } else if (x.image)
      ctx.addIssue({
        code: "custom",
        message: "Remove the image or switch to image-to-video.",
      });
  });
export type GenerationInput = z.infer<typeof generationSchema>;
export function validImage(data: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    data,
  );
  if (!match || match[2].length % 4 !== 0) return false;
  const b = Buffer.from(match[2], "base64");
  if (b.length > 3 * 1024 * 1024 || b.length < 12) return false;
  return match[1] === "png"
    ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : b[0] === 255 && b[1] === 216 && b[2] === 255;
}
export function providerPayload(x: GenerationInput) {
  const f = getFamily(x.family)!;
  const body: Record<string, unknown> = {
    model: x.mode === "text" ? f.t2v : f.i2v,
    prompt: x.prompt,
    duration: x.family === "minimax" ? String(x.duration) : x.duration,
  };
  if (x.mode === "image") body.image_urls = [x.image];
  if (x.family === "seedance")
    Object.assign(body, {
      ratio: x.ratio,
      resolution: x.resolution,
      generate_audio: x.audio,
      output_format: "mp4",
    });
  if (x.family === "kling") {
    body.sound = x.audio;
    if (x.mode === "text") body.aspect_ratio = x.ratio;
  }
  if (x.family === "minimax")
    Object.assign(body, { resolution: "2K", aspect_ratio: x.ratio });
  return body;
}
