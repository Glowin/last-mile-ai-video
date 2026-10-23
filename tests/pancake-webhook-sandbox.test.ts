import { test } from "node:test";
import assert from "node:assert/strict";
import { request, createServer } from "node:http";
import { connect } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyWebhook } from "@waffo/pancake-ts";
import { startSandboxReceiver, WEBHOOK_PATH, MAX_WEBHOOK_BYTES, type WebhookReply } from "../scripts/pancake-webhook-sandbox-http";
import { startPancakeWebhookSandbox } from "../scripts/pancake-webhook-sandbox";

// Own ephemeral loopback listeners only. Never use the merchant API, credentials,
// application DB or the main session's tunnel/port. Business transactions already
// have their own integration tests; these tests cover the new transport boundary.
function send(port: number, path = WEBHOOK_PATH, options: {
  method?: string; chunks?: Buffer[]; headers?: Record<string, string | string[]>;
} = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method ?? "POST", headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
      res.on("error", reject);
    });
    req.on("error", reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end();
  });
}
const noIsolationIO = async () => {};

test("receiver refuses to listen until isolation succeeds; rejection releases no ready endpoint", async () => {
  const reserved = createServer();
  await new Promise<void>((resolve) => reserved.listen(0, "127.0.0.1", resolve));
  const address = reserved.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reserved.close((error) => error ? reject(error) : resolve()));
  let allow!: () => void;
  const gate = new Promise<void>((resolve) => { allow = resolve; });
  let ready = false;
  const starting = startSandboxReceiver({ port, assertIsolation: () => gate,
    webhook: async () => ({ status: 200, outcome: "applied" }), log: () => { ready = true; } });
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); reject(new Error("Listener started before isolation")); });
      socket.once("error", (error: NodeJS.ErrnoException) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
    });
    assert.equal(ready, false);
  } finally { allow(); }
  const receiver = await starting;
  try {
    assert.equal(receiver.host, "127.0.0.1");
    assert.equal((await send(receiver.port, "/health", { method: "GET" })).status, 200);
  } finally { await receiver.close(); }
  const logs: string[] = [];
  await assert.rejects(startSandboxReceiver({ port, assertIsolation: async () => { throw new Error("wrong actual DB/role"); },
    webhook: async () => { throw new Error("must not call"); }, log: (line) => logs.push(line) }));
  assert.deepEqual(logs, []);
});

test("only exact POST webhook and GET health routes exist; no auth cookie or Origin needed", async () => {
  let calls = 0;
  const logs: string[] = [];
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    webhook: async () => { calls++; return { status: 200, outcome: "applied" }; }, log: (line) => logs.push(line) });
  try {
    for (const [method, path] of [
      ["GET", WEBHOOK_PATH], ["PUT", WEBHOOK_PATH], ["OPTIONS", WEBHOOK_PATH],
      ["POST", `${WEBHOOK_PATH}/`], ["POST", `${WEBHOOK_PATH}?token=secret`],
      ["POST", `${WEBHOOK_PATH}/extra`], ["POST", "/api/billing/webhooks/stripe"],
      ["POST", "/api/billing/checkout"], ["POST", "/api/billing/webhooks/%70ancake"],
      ["GET", "/health?secret=private"], ["HEAD", "/health"], ["POST", "/health"],
    ]) assert.equal((await send(receiver.port, path, { method })).status, 404, `${method} ${path}`);
    assert.equal(calls, 0);
    const health = await send(receiver.port, "/health", { method: "GET" });
    assert.deepEqual(JSON.parse(health.body), { ok: true, environment: "test" });
    assert.equal((await send(receiver.port)).status, 200);
    assert.equal(calls, 1);
    assert.ok(logs.every((line) => !line.includes("secret") && !line.includes("private")));
  } finally { await receiver.close(); }
});

test("raw chunks and repeated signature headers reach verifier unchanged, without unrelated headers", async () => {
  const raw = Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x20, 0xc3, 0x28, 0x7d, 0x0a]);
  let calls = 0;
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    webhook: async (body, headers) => {
      calls++;
      assert.deepEqual(Buffer.from(body), raw);
      assert.equal(headers.get("x-waffo-signature"), "t=1,v1=first, t=2,v1=second");
      assert.equal(headers.get("x-waffo-event"), "order.completed");
      assert.equal(headers.get("cookie"), null);
      return { status: 400 };
    } });
  try {
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { chunks: [raw.subarray(0, 4), raw.subarray(4)], headers: {
      "X-Waffo-Signature": ["t=1,v1=first", "t=2,v1=second"], "X-Waffo-Event": "order.completed", Cookie: "private",
    } })).status, 400);
    assert.equal(calls, 1);
  } finally { await receiver.close(); }
});

test("pinned SDK verifies a locally signed raw HTTP body; tampering is rejected", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const raw = Buffer.from('{\n  "mode": "test", "eventType": "order.completed", "data": {"text":"中文"}\n}\n');
  const timestamp = String(Date.now());
  const signature = sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}.`), raw]), keys.privateKey).toString("base64");
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    webhook: async (body, headers) => {
      try {
        const event = verifyWebhook(Buffer.from(body).toString("utf8"), headers.get("x-waffo-signature"), { publicKey: keys.publicKey, environment: "test" });
        assert.equal(event.mode, "test"); return { status: 200, outcome: "applied" };
      } catch { return { status: 400 }; }
    } });
  try {
    const headers = { "X-Waffo-Signature": `t=${timestamp},v1=${signature}` };
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { chunks: [raw.subarray(0, 7), raw.subarray(7)], headers })).status, 200);
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { chunks: [raw, Buffer.from(" ")], headers })).status, 400);
  } finally { await receiver.close(); }
});

test("body limit covers declared length and chunked input; exact boundary is retained", async () => {
  const sizes: number[] = [];
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    webhook: async (body) => { sizes.push(body.byteLength); return { status: 400 }; } });
  try {
    const oversized = Buffer.alloc(MAX_WEBHOOK_BYTES + 1, 65);
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { headers: { "Content-Length": String(oversized.length) } })).status, 413);
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { chunks: [oversized.subarray(0, 100_000), oversized.subarray(100_000)] })).status, 413);
    assert.deepEqual(sizes, []);
    assert.equal((await send(receiver.port, WEBHOOK_PATH, { chunks: [oversized.subarray(0, MAX_WEBHOOK_BYTES)] })).status, 400);
    assert.deepEqual(sizes, [MAX_WEBHOOK_BYTES]);
  } finally { await receiver.close(); }
});

test("acknowledgement awaits transaction and emits only fixed outcome/status fields", async () => {
  let finish!: (reply: WebhookReply) => void, enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const transaction = new Promise<WebhookReply>((resolve) => { finish = resolve; });
  const logs: string[] = [];
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    webhook: () => { enter(); return transaction; }, log: (line) => logs.push(line) });
  try {
    let acknowledged = false;
    const response = send(receiver.port, WEBHOOK_PATH, { chunks: [Buffer.from("sensitive-payload-id")],
      headers: { "X-Waffo-Signature": "sensitive-signature" } }).then((result) => { acknowledged = true; return result; });
    await entered;
    assert.equal(acknowledged, false);
    finish({ status: 200, outcome: "review_required" });
    assert.deepEqual(JSON.parse((await response).body), { ok: true, outcome: "review_required" });
    assert.equal(logs.at(-1), "sandbox_webhook status=200 outcome=review_required");
    assert.ok(logs.every((line) => !line.includes("sensitive")));
  } finally { finish({ status: 503 }); await receiver.close(); }
});

test("errors and unexpected results cannot leak data or produce success; explicit 401 is preserved", async () => {
  const logs: string[] = [];
  let mode = 0;
  const receiver = await startSandboxReceiver({ port: 0, assertIsolation: noIsolationIO,
    log: (line) => logs.push(line), webhook: async () => {
      if (mode === 0) throw new Error("secret-db-url private-order-id");
      if (mode === 1) return { status: 200, outcome: "private-order-id" } as unknown as WebhookReply;
      return { status: 401 };
    } });
  try {
    for (mode = 0; mode < 3; mode++) {
      const response = await send(receiver.port);
      assert.equal(response.status, mode === 2 ? 401 : 503);
      assert.doesNotMatch(response.body, /secret|private/);
    }
    assert.doesNotMatch(logs.join("\n"), /secret|private/);
  } finally { await receiver.close(); }
});

test("executable startup rejects disabled/live/production DSN configuration before opening a receiver", async () => {
  const names = ["BILLING_TEST_ENABLED", "BILLING_DEPLOYMENT_MODE", "DATABASE_URL", "APP_URL", "BILLING_TEST_APP_ORIGIN"];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.BILLING_TEST_ENABLED = "false";
    await assert.rejects(startPancakeWebhookSandbox(0), /SANDBOX_TEST_CONFIG_REQUIRED/);
    process.env.BILLING_TEST_ENABLED = "true"; process.env.BILLING_DEPLOYMENT_MODE = "production";
    await assert.rejects(startPancakeWebhookSandbox(0), /SANDBOX_TEST_CONFIG_REQUIRED/);
    process.env.BILLING_DEPLOYMENT_MODE = "isolated-test";
    process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1/production";
    process.env.APP_URL = process.env.BILLING_TEST_APP_ORIGIN = "https://sandbox.invalid";
    await assert.rejects(startPancakeWebhookSandbox(0), /BILLING_TEST_ISOLATION_REQUIRED/);
  } finally {
    for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});
