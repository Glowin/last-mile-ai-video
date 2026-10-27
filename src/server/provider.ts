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
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(45_000);
  let status: number | null = null;
  let category: "network" | "invalid_response" | "http" = "network";
  try {
    const response = await fetch(
      `https://vibetoken.cn/v1/videos/generations${path}`,
      {
        ...options,
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    status = response.status;
    if (!response.ok) {
      category = "http";
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
    category = "invalid_response";
    const parsed = taskSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError(502);
    if (
      parsed.data.status === "success" &&
      (!parsed.data.data?.[0] || !safeResultUrl(parsed.data.data[0].url))
    )
      throw new ProviderError(502);
    return parsed.data;
  } catch (error) {
    // A lost/invalid submit response cannot prove whether a remote task exists.
    // Log only allowlisted metadata, then rethrow the original error unchanged.
    if (options.method?.toUpperCase() === "POST" && category !== "http") {
      try {
        let requestId: string | null = null;
        try {
          requestId = new Headers(options.headers).get("Idempotency-Key");
        } catch {
          // Malformed headers must not suppress a diagnostic or expose their value.
        }
        console.warn("video_provider_submit_failed", JSON.stringify({
          operation: "submit",
          category: signal.aborted || error instanceof Error && error.name === "TimeoutError"
            ? "timeout" : error instanceof TypeError ? "network" : category,
          status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...(requestId && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(requestId)
            ? { jobId: requestId } : {}),
        }));
      } catch {
        // Diagnostics must never replace the provider/transport error.
      }
    }
    throw error;
  }
}
export function safeResultUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
