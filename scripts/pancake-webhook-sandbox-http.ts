import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const WEBHOOK_PATH = "/api/billing/webhooks/pancake";
export const MAX_WEBHOOK_BYTES = 262_144;
export type WebhookOutcome = "applied" | "duplicate" | "ignored" | "review_required";
export type WebhookReply = { status: 200; outcome: WebhookOutcome } |
  { status: 400 | 401 | 403 | 404 | 409 | 413 | 503 };
export type SandboxLog = (line: string) => void;

/** Transport only. The executable supplies the existing isolation check and
 * BillingService transaction; this helper never parses payment JSON. */
export async function startSandboxReceiver(options: {
  port: number;
  assertIsolation: () => Promise<void>;
  webhook: (rawBody: Uint8Array, headers: Headers) => Promise<WebhookReply>;
  log?: SandboxLog;
}) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new Error("SANDBOX_INVALID_PORT");
  // No health endpoint or socket becomes available before the actual DB check.
  await options.assertIsolation();
  const log = (line: string) => { try { options.log?.(line); } catch { /* Logging cannot change acknowledgement. */ } };
  const respond = (res: ServerResponse, status: number, body: object) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("aborted", aborted); };
    const fail = (code: "BODY_TOO_LARGE" | "BODY_INCOMPLETE") => {
      cleanup(); req.pause(); reject(new Error(code));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BYTES) { fail("BODY_TOO_LARGE"); return; }
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    const aborted = () => fail("BODY_INCOMPLETE");
    req.on("data", data); req.once("end", end); req.once("aborted", aborted);
    // Keep an error listener after abort, so disconnects never become uncaught errors.
    req.on("error", aborted);
  });
  const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    // Compare the raw request target, not a normalized URL or a path prefix.
    if (req.method === "GET" && req.url === "/health") {
      respond(res, 200, { ok: true, environment: "test" }); return;
    }
    if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
      respond(res, 404, { ok: false, code: "NOT_FOUND" }); return;
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_WEBHOOK_BYTES) {
      log("sandbox_webhook status=413");
      respond(res, 413, { ok: false, code: "BODY_TOO_LARGE" }); return;
    }
    let rawBody: Buffer;
    try { rawBody = await readBody(req); }
    catch (error) {
      const oversized = error instanceof Error && error.message === "BODY_TOO_LARGE";
      const status = oversized ? 413 : 400;
      log(`sandbox_webhook status=${status}`);
      if (!res.destroyed) respond(res, status, { ok: false, code: oversized ? "BODY_TOO_LARGE" : "BODY_INCOMPLETE" });
      return;
    }
    try {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        if (name === "x-waffo-signature" || name === "x-waffo-event")
          headers.append(name, req.rawHeaders[i + 1]);
      }
      const reply = await options.webhook(rawBody, headers);
      if (reply.status === 200 && ["applied", "duplicate", "ignored", "review_required"].includes(reply.outcome)) {
        log(`sandbox_webhook status=200 outcome=${reply.outcome}`);
        respond(res, 200, { ok: true, outcome: reply.outcome });
      } else if ([400, 401, 403, 404, 409, 413, 503].includes(reply.status)) {
        log(`sandbox_webhook status=${reply.status}`);
        respond(res, reply.status, { ok: false, code: "WEBHOOK_REJECTED" });
      } else throw new Error("SANDBOX_INVALID_RESULT");
    } catch {
      log("sandbox_webhook status=503");
      if (!res.destroyed) respond(res, 503, { ok: false, code: "WEBHOOK_UNAVAILABLE" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    else socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once("error", failed);
    server.listen(options.port, "127.0.0.1", () => { server.off("error", failed); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SANDBOX_LISTEN_FAILED");
  log(`sandbox_ready host=127.0.0.1 port=${address.port} environment=test`);
  let closing: Promise<void> | undefined;
  return { port: address.port, host: address.address, close: () => closing ??= new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 5_000);
    timer.unref();
    server.close((error) => { clearTimeout(timer); if (error) reject(error); else resolve(); });
  }) };
}
