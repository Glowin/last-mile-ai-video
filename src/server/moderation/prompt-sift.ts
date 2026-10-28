import { createPrivateKey } from "node:crypto";
import { WaffoPancake, ScanSemanticMode } from "@waffo/pancake-ts";
import { z } from "zod";

export type PromptSiftResult = {
  action: "allow" | "block" | "review" | "error";
  requestId: string | null;
  reasonCode: string;
  semanticStatus: string | null;
  retryable: boolean;
  retryAfterMs: number | null;
  httpStatus: number | null;
};
export type PromptSiftOptions = {
  /** Synthetic credentials in tests; no fallback to process.env when provided. */
  env?: Readonly<Partial<Pick<NodeJS.ProcessEnv, "PANCAKE_LIVE_MERCHANT_ID" | "PANCAKE_LIVE_PRIVATE_KEY">>>;
  fetch?: typeof fetch;
};

const ENDPOINT = "https://api.waffo.ai/v1/actions/verification/scan-prompt";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const ERROR_RETRY_MS = 5_000;
const REVIEW_RETRY_MS = 3_600_000;
const semanticStatuses = ["disabled", "scored", "shadow_scored", "skipped_rules_block",
  "skipped_budget", "provider_timeout", "provider_error"] as const;
const verdictSchema = z.object({
  action: z.enum(["allow", "block", "review"]),
  reasonCode: z.enum(["allowed", "review_required", "restricted_content", "service_degraded"]),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  semanticStatus: z.enum(semanticStatuses),
  matchedCategories: z.array(z.enum(["csam_minor", "sexual_violence_nonconsensual", "undress_transform",
    "face_swap_identity", "bestiality_restricted", "adult_nsfw"])).max(32),
});
const envelopeSchema = z.object({
  data: verdictSchema,
  errors: z.array(z.unknown()).max(0).optional(),
  // Unknown warnings must not silently turn a partial/degraded check into allow.
  warnings: z.array(z.unknown()).max(0).optional(),
});

type FailureCode = "PROMPT_SIFT_INVALID_INPUT" | "PROMPT_SIFT_NOT_CONFIGURED" |
  "PROMPT_SIFT_INVALID_CONFIG" | "PROMPT_SIFT_TIMEOUT" | "PROMPT_SIFT_TRANSPORT_ERROR" |
  "PROMPT_SIFT_HTTP_ERROR" | "PROMPT_SIFT_RATE_LIMITED" | "PROMPT_SIFT_REDIRECT_REFUSED" |
  "PROMPT_SIFT_RESPONSE_TOO_LARGE" | "PROMPT_SIFT_INVALID_RESPONSE" | "PROMPT_SIFT_API_ERROR" |
  "PROMPT_SIFT_INVALID_VERDICT";
class ScanFailure extends Error {
  constructor(readonly code: FailureCode, readonly retryable = false) { super(code); }
}

function retryAfter(header: string | null): number | null {
  if (!header || header.length > 128) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  // Accept an HTTP date, not Date.parse's permissive numeric/date shortcuts.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
  const ms = Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

/** JSON.parse accepts duplicate decision fields. Reject ambiguous objects before
 * trusting the parsed verdict; depth and total bytes are independently bounded. */
function parseEnvelope(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  let index = 0;
  function visit(depth: number): void {
    if (depth > 32) throw new ScanFailure("PROMPT_SIFT_INVALID_RESPONSE");
    const token = tokens[index++];
    if (token === "{") {
      const keys = new Set<string>();
      while (tokens[index] !== "}") {
        const key: string = JSON.parse(tokens[index++]);
        if (keys.has(key)) throw new ScanFailure("PROMPT_SIFT_INVALID_RESPONSE");
        keys.add(key); index++; visit(depth + 1);
        if (tokens[index] !== ",") break;
        index++;
      }
      index++;
    } else if (token === "[") {
      while (tokens[index] !== "]") {
        visit(depth + 1);
        if (tokens[index] !== ",") break;
        index++;
      }
      index++;
    }
  }
  visit(0);
  return parsed;
}

/** One signed scan, ZERO internal retries. Importing this module reads no keys,
 * creates no SDK client, and makes no requests. Inactive callers must not call it.
 * This scans text only; it makes no assertion about images or generated output. */
export async function scanPrompt(input: { prompt: string; idempotencyKey: string; timeoutMs: number },
  options: PromptSiftOptions = {}): Promise<PromptSiftResult> {
  let httpStatus: number | null = null;
  let retryAfterMs: number | null = null;
  const failure = (code: string, retryable = false): PromptSiftResult => ({
    action: "error", requestId: null, reasonCode: code, semanticStatus: null,
    retryable, retryAfterMs: retryable ? retryAfterMs ?? ERROR_RETRY_MS : null, httpStatus,
  });
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 10_000 ||
      typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(input.idempotencyKey) ||
      !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > MAX_TIMEOUT_MS) {
    return failure("PROMPT_SIFT_INVALID_INPUT");
  }

  const controller = new AbortController();
  const deadline = performance.now() + input.timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state: { stage: "config" | "request" | "body" } = { stage: "config" };
  const cancelBody = () => { void reader?.cancel().catch(() => {}); };
  const checkDeadline = () => {
    if (controller.signal.aborted || performance.now() >= deadline) throw new ScanFailure("PROMPT_SIFT_TIMEOUT", true);
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScanFailure("PROMPT_SIFT_TIMEOUT", true));
      controller.abort(); cancelBody();
    }, input.timeoutMs);
  });

  async function run(): Promise<PromptSiftResult> {
    // Same merchant/RSA auth as billing, without importing or initializing billing.
    const env = options.env ?? process.env;
    const merchantId = env.PANCAKE_LIVE_MERCHANT_ID;
    const privateKey = env.PANCAKE_LIVE_PRIVATE_KEY;
    if (!merchantId?.trim() || !privateKey?.trim()) throw new ScanFailure("PROMPT_SIFT_NOT_CONFIGURED");
    if (!/^MER_[A-Za-z0-9]{22}$/.test(merchantId) || privateKey.length > 32_768) {
      throw new ScanFailure("PROMPT_SIFT_INVALID_CONFIG");
    }
    // Match SDK PEM/escaped-PEM/bare PKCS#8 support, and explicitly require RSA.
    let pem = privateKey.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
    if (!pem.includes("-----BEGIN")) pem = `-----BEGIN PRIVATE KEY-----\n${pem.replace(/\s+/g, "")}\n-----END PRIVATE KEY-----`;
    if (createPrivateKey(pem).asymmetricKeyType !== "rsa") throw new ScanFailure("PROMPT_SIFT_INVALID_CONFIG");
    const transport = options.fetch ?? globalThis.fetch;
    let requests = 0;
    const guardedFetch: typeof fetch = async (url, init) => {
      checkDeadline();
      // Defense against SDK drift: never follow another endpoint or make a retry.
      if (String(url) !== ENDPOINT || init?.method !== "POST" || ++requests !== 1) {
        throw new ScanFailure("PROMPT_SIFT_TRANSPORT_ERROR");
      }
      state.stage = "request";
      const response = await transport(url, { ...init, redirect: "manual", signal: controller.signal, cache: "no-store" });
      if (finished || controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new ScanFailure("PROMPT_SIFT_TIMEOUT", true);
      }
      httpStatus = response.status;
      retryAfterMs = retryAfter(response.headers.get("retry-after"));
      const discard = () => { void response.body?.cancel().catch(() => {}); };
      if (performance.now() >= deadline) {
        discard(); throw new ScanFailure("PROMPT_SIFT_TIMEOUT", true);
      }
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        discard(); throw new ScanFailure("PROMPT_SIFT_REDIRECT_REFUSED");
      }
      if (response.status !== 200) {
        discard();
        if (response.status === 429) {
          retryAfterMs ??= 60_000;
          throw new ScanFailure("PROMPT_SIFT_RATE_LIMITED", true);
        }
        throw new ScanFailure("PROMPT_SIFT_HTTP_ERROR", response.status >= 500 && response.status <= 599);
      }
      state.stage = "body";
      const contentLength = response.headers.get("content-length");
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
        discard(); throw new ScanFailure("PROMPT_SIFT_RESPONSE_TOO_LARGE");
      }
      if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
        discard(); throw new ScanFailure("PROMPT_SIFT_INVALID_RESPONSE");
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        checkDeadline();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch { throw new ScanFailure("PROMPT_SIFT_TRANSPORT_ERROR", true); }
        checkDeadline();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new ScanFailure("PROMPT_SIFT_RESPONSE_TOO_LARGE");
        chunks.push(chunk.value);
      }
      reader.releaseLock(); reader = undefined;
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
      const envelope = parseEnvelope(raw);
      if (envelope && typeof envelope === "object" && "errors" in envelope &&
          Array.isArray(envelope.errors) && envelope.errors.length) throw new ScanFailure("PROMPT_SIFT_API_ERROR");
      if (!envelopeSchema.safeParse(envelope).success) throw new ScanFailure("PROMPT_SIFT_INVALID_RESPONSE");
      checkDeadline();
      // SDK still parses/unwraps the real bounded envelope. HTTP truth stays in
      // our closure: an envelope's status field cannot spoof the wire status.
      return new Response(raw, { status: response.status, headers: { "content-type": "application/json" } });
    };
    const client = new WaffoPancake({ merchantId, privateKey, fetch: guardedFetch });
    const verdict = await client.contentSafety.scanPrompt({ prompt: input.prompt, semantic: ScanSemanticMode.Enforce },
      { idempotencyKey: input.idempotencyKey });
    checkDeadline();
    const parsed = verdictSchema.safeParse(verdict);
    if (!parsed.success) throw new ScanFailure("PROMPT_SIFT_INVALID_RESPONSE");
    const v = parsed.data;
    const result = (action: PromptSiftResult["action"], reasonCode: string, retryable = false): PromptSiftResult => ({
      action, reasonCode, requestId: v.requestId, semanticStatus: v.semanticStatus, httpStatus,
      retryable, retryAfterMs: retryable ? retryAfterMs ?? REVIEW_RETRY_MS : null,
    });
    // A contradictory allow can NEVER override a degraded reason/channel.
    if (v.reasonCode === "service_degraded" || ["skipped_budget", "provider_timeout", "provider_error"].includes(v.semanticStatus)) {
      return result("review", "service_degraded", true);
    }
    if (v.action === "allow" && v.reasonCode === "allowed" && v.semanticStatus === "scored" && v.matchedCategories.length === 0) {
      return result("allow", "allowed");
    }
    if (v.action === "block" && v.reasonCode === "restricted_content" && ["scored", "skipped_rules_block"].includes(v.semanticStatus)) {
      return result("block", "restricted_content");
    }
    if (v.action === "review" && v.reasonCode === "review_required") return result("review", "review_required", true);
    return result("error", "PROMPT_SIFT_INVALID_VERDICT");
  }

  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    if (error instanceof ScanFailure) return failure(error.code, error.retryable);
    return failure(state.stage === "config" ? "PROMPT_SIFT_INVALID_CONFIG" :
      state.stage === "body" ? "PROMPT_SIFT_INVALID_RESPONSE" : "PROMPT_SIFT_TRANSPORT_ERROR", state.stage === "request");
  } finally {
    finished = true;
    clearTimeout(timer);
    controller.abort(); cancelBody();
    // Never log prompts, keys, bodies, SDK errors or exception messages.
  }
}
