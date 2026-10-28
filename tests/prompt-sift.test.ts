import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setImmediate as nextTurn } from "node:timers/promises";
import { scanPrompt, type PromptSiftOptions, type PromptSiftResult } from "../src/server/moderation/prompt-sift";

// Ephemeral SYNTHETIC keys only; real installed SDK signs every stubbed request.
// No DB, credential file, live endpoint, billing client or SDK-client mock.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { PANCAKE_LIVE_MERCHANT_ID: "MER_" + "S".repeat(22), PANCAKE_LIVE_PRIVATE_KEY: pem };
const input = { prompt: "Synthetic bird over a blue lake. 鸟", idempotencyKey: "synthetic-scan-0001", timeoutMs: 2000 };
const verdict = { action: "allow", reasonCode: "allowed", matchedCategories: [], requestId: "REQ_synthetic_0001", semanticStatus: "scored" };
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}
function fixture(t: TestContext, response: () => Response | Promise<Response> = () => json({ data: verdict })) {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Live fetch forbidden"); });
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    assert.ok(init); calls.push({ url: String(url), init });
    return response();
  };
  return { calls, options: { env, fetch: transport } satisfies PromptSiftOptions };
}
function error(result: PromptSiftResult, code: string, httpStatus: number | null, retryable = false) {
  assert.equal(result.action, "error"); assert.equal(result.reasonCode, code);
  assert.equal(result.httpStatus, httpStatus); assert.equal(result.retryable, retryable);
  assert.equal(result.requestId, null); assert.equal(result.semanticStatus, null);
}

test("inactive module import reads no merchant/private key and initializes no network", async () => {
  const script = `
    const empty = process.env;
    process.env = new Proxy(empty, { get(target, key) {
      if (String(key).startsWith('PANCAKE_')) throw new Error('Inactive credential read');
      return Reflect.get(target, key);
    }});
    globalThis.fetch = () => { throw new Error('Inactive network call'); };
    await import(${JSON.stringify(new URL("../src/server/moderation/prompt-sift.ts", import.meta.url).href)});
    process.stdout.write('inactive-ok');
  `;
  const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), env: { NODE_ENV: "test" }, timeout: 10_000 });
  assert.equal(result.stdout, "inactive-ok"); assert.equal(result.stderr, "");
});

test("real SDK signs exact transmitted JSON; explicit enforce and unchanged stable key; one POST per call", async t => {
  const { calls, options } = fixture(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await scanPrompt(input, options), { action: "allow", requestId: verdict.requestId,
      reasonCode: "allowed", semanticStatus: "scored", retryable: false, retryAfterMs: null, httpStatus: 200 });
  }
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, "https://api.waffo.ai/v1/actions/verification/scan-prompt");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(init.body)), { prompt: input.prompt, semantic: "enforce" });
    const headers = new Headers(init.headers);
    assert.equal(headers.get("X-Merchant-Id"), env.PANCAKE_LIVE_MERCHANT_ID);
    assert.equal(headers.get("X-Idempotency-Key"), input.idempotencyKey);
    assert.equal(headers.has("X-Environment"), false); assert.equal(headers.has("Authorization"), false);
    const canonical = `POST\n/v1/actions/verification/scan-prompt\n${headers.get("X-Timestamp")}\n${createHash("sha256").update(String(init.body)).digest("base64")}`;
    assert.equal(verify("RSA-SHA256", Buffer.from(canonical), publicKey, Buffer.from(headers.get("X-Signature")!, "base64")), true);
  }
});

test("input validation happens before credential access; bounds and stable-key syntax are enforced", async t => {
  const { calls, options } = fixture(t);
  const inaccessible = new Proxy({}, { get() { assert.fail("Invalid input must not read credentials"); } });
  for (const change of [{ prompt: " " }, { prompt: "x".repeat(10001) }, { prompt: null }, { idempotencyKey: "" },
    { idempotencyKey: "bad\r\nheader" }, { idempotencyKey: "with:colon" }, { idempotencyKey: "x".repeat(257) },
    { timeoutMs: 0 }, { timeoutMs: 60001 }, { timeoutMs: Infinity }, { timeoutMs: 1.5 }]) {
    error(await scanPrompt({ ...input, ...change } as typeof input, { ...options, env: inaccessible }), "PROMPT_SIFT_INVALID_INPUT", null);
  }
  assert.equal(calls.length, 0);
  const result = await scanPrompt({ ...input, prompt: "x".repeat(10000), idempotencyKey: "x".repeat(256) }, options);
  assert.equal(result.action, "allow"); assert.equal(calls.length, 1);
});

test("missing, invalid or non-RSA config fails safely without transport; SDK-compatible key forms work", async t => {
  const { calls, options } = fixture(t);
  error(await scanPrompt(input, { ...options, env: {} }), "PROMPT_SIFT_NOT_CONFIGURED", null);
  for (const invalid of [{ ...env, PANCAKE_LIVE_PRIVATE_KEY: "PRIVATE_INVALID_KEY" }, { ...env, PANCAKE_LIVE_MERCHANT_ID: "private-invalid-id" },
    { ...env, PANCAKE_LIVE_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() }]) {
    error(await scanPrompt(input, { ...options, env: invalid }), "PROMPT_SIFT_INVALID_CONFIG", null);
  }
  assert.equal(calls.length, 0);
  for (const key of [pem.replace(/\n/g, "\\n"), pem.replace(/-----[^\n]+-----/g, "").replace(/\s/g, ""),
    privateKey.export({ type: "pkcs1", format: "pem" }).toString()]) {
    assert.equal((await scanPrompt(input, { ...options, env: { ...env, PANCAKE_LIVE_PRIVATE_KEY: key } })).action, "allow");
  }
  assert.equal(calls.length, 3);
});

test("review and block retain validated evidence; review returns a delay and never retries internally", async t => {
  let body: unknown = { data: { ...verdict, action: "review", reasonCode: "review_required" } };
  const { calls, options } = fixture(t, () => json(body));
  assert.deepEqual(await scanPrompt(input, options), { action: "review", requestId: verdict.requestId,
    reasonCode: "review_required", semanticStatus: "scored", retryable: true, retryAfterMs: 3600000, httpStatus: 200 });
  body = { data: { ...verdict, action: "block", reasonCode: "restricted_content", semanticStatus: "skipped_rules_block", matchedCategories: ["adult_nsfw"] } };
  assert.deepEqual(await scanPrompt(input, options), { action: "block", requestId: verdict.requestId,
    reasonCode: "restricted_content", semanticStatus: "skipped_rules_block", retryable: false, retryAfterMs: null, httpStatus: 200 });
  assert.equal(calls.length, 2);
});

test("degraded or incomplete semantic results NEVER allow, including contradictory allow verdicts", async t => {
  let data: Record<string, unknown> = verdict;
  const { options, calls } = fixture(t, () => json({ data }));
  for (const change of [{ reasonCode: "service_degraded" }, { semanticStatus: "provider_error" },
    { semanticStatus: "provider_timeout" }, { semanticStatus: "skipped_budget" }]) {
    data = { ...verdict, ...change };
    const r = await scanPrompt(input, options);
    assert.equal(r.action, "review"); assert.equal(r.reasonCode, "service_degraded");
    assert.equal(r.retryable, true); assert.equal(r.retryAfterMs, 3600000);
  }
  for (const change of [{ semanticStatus: "disabled" }, { semanticStatus: "shadow_scored" }, { semanticStatus: "skipped_rules_block" },
    { reasonCode: "restricted_content" }, { reasonCode: "review_required" }, { matchedCategories: ["adult_nsfw"] }]) {
    data = { ...verdict, ...change };
    const r = await scanPrompt(input, options);
    assert.equal(r.action, "error"); assert.equal(r.reasonCode, "PROMPT_SIFT_INVALID_VERDICT");
  }
  assert.equal(calls.length, 10);
});

test("wire HTTP status wins over contradictory allow/envelope status; redirects never follow", async t => {
  let status = 401;
  const { options, calls } = fixture(t, () => json({ status: 200, data: verdict }, status,
    { location: "https://never-follow.invalid/secret" }));
  for (const code of [201, 400, 401, 403, 404, 409, 422, 500, 502, 503]) {
    status = code;
    const r = await scanPrompt(input, options);
    error(r, "PROMPT_SIFT_HTTP_ERROR", code, code >= 500);
    assert.equal(r.retryAfterMs, code >= 500 ? 5000 : null);
  }
  for (const code of [301, 302, 307, 308]) {
    status = code; error(await scanPrompt(input, options), "PROMPT_SIFT_REDIRECT_REFUSED", code);
  }
  assert.equal(calls.length, 14);
  assert.ok(calls.every(call => call.init.redirect === "manual"));
});

test("429 honors seconds/HTTP-date Retry-After, safely falls back, and performs no automatic retry", async t => {
  const now = Date.parse("2026-10-28T08:00:00Z"); t.mock.method(Date, "now", () => now);
  let header: string | undefined;
  const { options, calls } = fixture(t, () => json({ data: verdict }, 429, header ? { "retry-after": header } : {}));
  for (const [value, delay] of [["17", 17000], ["0", 0], ["Wed, 28 Oct 2026 08:02:00 GMT", 120000],
    ["Wed, 28 Oct 2026 07:59:00 GMT", 0], [undefined, 60000], ["1.2", 60000], ["-5", 60000], ["9".repeat(200), 60000], ["SECRET_PROVIDER_TEXT", 60000]] as const) {
    header = value;
    const r = await scanPrompt(input, options);
    error(r, "PROMPT_SIFT_RATE_LIMITED", 429, true); assert.equal(r.retryAfterMs, delay);
  }
  assert.equal(calls.length, 9);
});

test("review and 5xx return Retry-After as metadata for the caller's scheduler", async t => {
  let status = 200;
  const { options, calls } = fixture(t, () => json({ data: { ...verdict, action: "review", reasonCode: "review_required" } }, status, { "retry-after": "3601" }));
  assert.equal((await scanPrompt(input, options)).retryAfterMs, 3601000);
  status = 503;
  const r = await scanPrompt(input, options);
  error(r, "PROMPT_SIFT_HTTP_ERROR", 503, true); assert.equal(r.retryAfterMs, 3601000); assert.equal(calls.length, 2);
});

test("malformed JSON, UTF-8, envelopes, unknown enums, errors and warnings never allow or echo provider text", async t => {
  let response = json(null);
  const { options } = fixture(t, () => response);
  for (const body of [null, [], { data: null }, { data: verdict, errors: "PRIVATE_ERROR" }, { data: verdict, warnings: [{ message: "PRIVATE_WARNING" }] },
    { data: { ...verdict, action: "future_action" } }, { data: { ...verdict, reasonCode: "PRIVATE_TEXT" } },
    { data: { ...verdict, semanticStatus: "unknown" } }, { data: { ...verdict, semanticStatus: null } },
    { data: { ...verdict, requestId: "<private input>" } }, { data: { ...verdict, requestId: "" } },
    { data: { ...verdict, matchedCategories: null } }, { data: { ...verdict, matchedCategories: ["unknown"] } },
    { data: { action: "allow", reasonCode: "allowed" } }]) {
    response = json(body); error(await scanPrompt(input, options), "PROMPT_SIFT_INVALID_RESPONSE", 200);
  }
  response = json({ data: verdict, errors: [{ message: "PRIVATE_PROVIDER_ERROR", layer: "sdk" }] });
  error(await scanPrompt(input, options), "PROMPT_SIFT_API_ERROR", 200);
  for (const raw of ["{", '{"data":', new Uint8Array([0xff, 0xfe])]) {
    response = new Response(raw, { headers: { "content-type": "application/json" } });
    error(await scanPrompt(input, options), "PROMPT_SIFT_INVALID_RESPONSE", 200);
  }
  response = new Response(JSON.stringify({ data: verdict }), { headers: { "content-type": "text/html" } });
  error(await scanPrompt(input, options), "PROMPT_SIFT_INVALID_RESPONSE", 200);
  response = json({ data: verdict, errors: [], warnings: [] });
  assert.equal((await scanPrompt(input, options)).action, "allow");
});

test("duplicate decision fields (including escaped names) and excessive nesting are rejected", async t => {
  let raw = "";
  const { options } = fixture(t, () => new Response(raw, { headers: { "content-type": "application/json" } }));
  const valid = JSON.stringify({ data: verdict });
  for (const value of [valid.replace('"action":"allow"', '"action":"block","action":"allow"'),
    valid.replace('"action":"allow"', '"action":"block","\\u0061ction":"allow"'),
    `{"data":null,"data":${JSON.stringify(verdict)}}`,
    `{"data":${JSON.stringify(verdict)},"extra":${"[".repeat(40)}0${"]".repeat(40)}}`]) {
    raw = value; error(await scanPrompt(input, options), "PROMPT_SIFT_INVALID_RESPONSE", 200);
  }
});

test("stream byte limit is enforced with absent/lying Content-Length and cancels unread remainder", async t => {
  let canceled = 0, length: string | undefined;
  const { options, calls } = fixture(t, () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { canceled++; },
  }), { headers: { "content-type": "application/json", ...(length ? { "content-length": length } : {}) } }));
  for (const header of [undefined, "1", "65537"]) {
    length = header; error(await scanPrompt(input, options), "PROMPT_SIFT_RESPONSE_TOO_LARGE", 200);
  }
  assert.equal(canceled, 3); assert.equal(calls.length, 3);
});

test("response cap includes UTF-8 bytes and permits exactly 64 KiB", async t => {
  let raw = "";
  const { options } = fixture(t, () => new Response(raw, { headers: { "content-type": "application/json" } }));
  const body = JSON.stringify({ data: verdict });
  raw = body + " ".repeat(65536 - Buffer.byteLength(body));
  assert.equal((await scanPrompt(input, options)).action, "allow");
  raw = JSON.stringify({ data: verdict, extra: "鸟".repeat(22000) });
  assert.ok(raw.length < 65536); error(await scanPrompt(input, options), "PROMPT_SIFT_RESPONSE_TOO_LARGE", 200);
});

test("total deadline spans request AND unfinished body; timeout aborts and cancels stream", async t => {
  let canceled = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { options, calls } = fixture(t, async () => {
    await new Promise(resolve => setTimeout(resolve, 60));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); },
      cancel() { canceled++; },
    }), { headers: { "content-type": "application/json" } });
  });
  const pending = scanPrompt({ ...input, timeoutMs: 100 }, options);
  t.mock.timers.tick(60); await nextTurn();
  t.mock.timers.tick(40);
  const r = await pending;
  error(r, "PROMPT_SIFT_TIMEOUT", 200, true); assert.equal(r.retryAfterMs, 5000);
  assert.equal(canceled, 1); assert.equal(calls.length, 1); assert.equal(calls[0].init.signal?.aborted, true);
});

test("fetch ignoring abort cannot hang the adapter; a late response is canceled without retry", async t => {
  let deliver!: (response: Response) => void, canceled = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { options, calls } = fixture(t, () => new Promise<Response>(resolve => { deliver = resolve; }));
  const pending = scanPrompt({ ...input, timeoutMs: 100 }, options);
  t.mock.timers.tick(100);
  const r = await pending; error(r, "PROMPT_SIFT_TIMEOUT", null, true);
  deliver(new Response(new ReadableStream({ cancel() { canceled++; } }), { headers: { "content-type": "application/json" } }));
  await nextTurn(); assert.equal(canceled, 1); assert.equal(calls.length, 1); assert.equal(r.httpStatus, null);
});

test("transport and streaming errors use local safe codes and never log private data", async t => {
  const logs = ["log", "warn", "error"].map(method => t.mock.method(console, method as "log", () => {}));
  let streamFailure = false;
  const { options, calls } = fixture(t, () => {
    if (!streamFailure) throw new Error("PRIVATE_PROMPT PRIVATE_KEY PRIVATE_RESPONSE");
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE_BODY")); } }),
      { headers: { "content-type": "application/json" } });
  });
  error(await scanPrompt(input, options), "PROMPT_SIFT_TRANSPORT_ERROR", null, true);
  streamFailure = true;
  error(await scanPrompt(input, options), "PROMPT_SIFT_TRANSPORT_ERROR", 200, true);
  assert.equal(calls.length, 2); for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
