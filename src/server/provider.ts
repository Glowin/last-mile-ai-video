import { z } from "zod";
import { getFamily } from "../lib/models";
const taskSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["pending", "success", "failed"]),
  data: z.array(z.object({ url: z.string().url() })).optional(),
});
export type ProviderTask = z.infer<typeof taskSchema>;
export class ProviderError extends Error {
  constructor(public status: number) {
    super("Video service request failed.");
  }
}
// A local policy block says nothing about a previous remote submission.
// Keep this separate from ProviderError so submit retains unknown + payload.
export class ProviderSubmissionBlockedError extends Error {
  constructor() {
    super("Video submission blocked locally; remote task status is unknown.");
    this.name = "ProviderSubmissionBlockedError";
  }
}
export async function providerRequest(
  path: string,
  options: RequestInit = {},
): Promise<ProviderTask> {
  // Recovery submits stored JSON without re-running the current input schema.
  // Reject the known-bad setting before credentials/fetch; never upgrade or retry it.
  if (options.method?.toUpperCase() === "POST" && typeof options.body === "string") {
    let body: unknown;
    try {
      body = JSON.parse(options.body);
    } catch {
      throw new ProviderSubmissionBlockedError();
    }
    const blocked = z.object({
      model: z.string(),
      resolution: z.literal("480p"),
    }).safeParse(body);
    const seedance = getFamily("seedance")!;
    if (
      blocked.success &&
      (blocked.data.model === seedance.t2v || blocked.data.model === seedance.i2v)
    )
      throw new ProviderSubmissionBlockedError();
  }
  const key = process.env.VIBETOKEN_API_KEY;
  if (!key) throw new ProviderError(503);
  const response = await fetch(
    `https://vibetoken.cn/v1/videos/generations${path}`,
    {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: `Bearer ${key}`,
      },
    },
  );
  if (!response.ok) {
    // Keep enough evidence to distinguish submission rejection from a failed
    // remote task without copying response bodies, credentials or result URLs.
    const requestId = new Headers(options.headers).get("Idempotency-Key");
    console.warn("video_provider_rejected", JSON.stringify({
      operation: options.method?.toUpperCase() === "POST" ? "submit" : "query",
      status: response.status,
      ...(requestId && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(requestId)
        ? { jobId: requestId } : {}),
    }));
    throw new ProviderError(response.status);
  }
  const parsed = taskSchema.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError(502);
  if (
    parsed.data.status === "success" &&
    (!parsed.data.data?.[0] || !safeResultUrl(parsed.data.data[0].url))
  )
    throw new ProviderError(502);
  return parsed.data;
}
export function safeResultUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
