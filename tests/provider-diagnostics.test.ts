import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ProviderError, ProviderSubmissionBlockedError, providerRequest } from "../src/server/provider";

const sentinel = "SECRET_SENTINEL_never_log";
const id = "11111111-1111-4111-8111-111111111111";
const responseId = "22222222-2222-4222-8222-222222222222";
const body = JSON.stringify({ model: "example", prompt: sentinel,
  image_urls: [`https://example.invalid/${sentinel}`], client_request_id: responseId });
const submit = { method: "POST", headers: { "Idempotency-Key": id }, body };

function setup(t: TestContext) {
  const oldKey = process.env.VIBETOKEN_API_KEY;
  process.env.VIBETOKEN_API_KEY = sentinel;
  t.after(() => {
    if (oldKey === undefined) delete process.env.VIBETOKEN_API_KEY;
    else process.env.VIBETOKEN_API_KEY = oldKey;
  });
  const logs: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); });
  let now = 100;
  t.mock.method(performance, "now", () => now);
  const fetchMock = t.mock.method(globalThis, "fetch", async (): Promise<Response> => {
    assert.fail("Every provider call must use an explicit fake fetch");
  });
  function fake(implementation: () => Promise<Response>) {
    fetchMock.mock.mockImplementation(async () => { now = 137; return implementation(); });
  }
  return { logs, fetchMock, fake };
}

function assertDiagnostic(logs: unknown[][], category: string, status: number | null, jobId: string | null = id) {
  assert.equal(logs.length, 1, "Exactly one diagnostic per failed submit");
  assert.equal(logs[0][0], "video_provider_submit_failed");
  assert.equal(logs[0].length, 2);
  assert.deepEqual(JSON.parse(String(logs[0][1])), {
    operation: "submit", category, status, durationMs: 37,
    ...(jobId === null ? {} : { jobId }),
  });
  assert.ok(!JSON.stringify(logs).includes(sentinel));
  assert.ok(!JSON.stringify(logs).includes(responseId), "Never use an ID from payload/response");
}

test("HTTP rejection and query diagnostics retain their existing allowlist and status", async (t) => {
  const { logs, fetchMock, fake } = setup(t);
  fake(async () => new Response(sentinel, { status: 422 }));
  await assert.rejects(providerRequest("", submit), e => e instanceof ProviderError && e.status === 422);
  assert.deepEqual(logs, [["video_provider_rejected", JSON.stringify({ operation: "submit", status: 422, jobId: id })]]);
  logs.length = 0;
  await assert.rejects(providerRequest(`?client_request_id=${sentinel}`, {
    headers: { "Idempotency-Key": sentinel },
  }), e => e instanceof ProviderError && e.status === 422);
  assert.deepEqual(logs, [["video_provider_rejected", JSON.stringify({ operation: "query", status: 422 })]]);
  assert.equal(fetchMock.mock.callCount(), 2, "Neither submit nor lookup retries");
});

test("submit network failure logs bounded metadata and rethrows the same transport error once", async (t) => {
  const { logs, fetchMock, fake } = setup(t);
  const error = new TypeError(`fetch failed: https://example.invalid/${sentinel}`, {
    cause: new Error(`Authorization: Bearer ${sentinel}`),
  });
  fake(async () => { throw error; });
  await assert.rejects(providerRequest(`?private=${sentinel}`, submit), e => e === error);
  assertDiagnostic(logs, "network", null);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [, sent] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(sent.body, body);
  assert.equal(sent.method, "POST");
  assert.equal(new Headers(sent.headers).get("Idempotency-Key"), id);
});

test("submit timeout retains native TimeoutError and the 45-second timeout without retry", async (t) => {
  const { logs, fetchMock, fake } = setup(t);
  const error = new DOMException(sentinel, "TimeoutError");
  const signal = new AbortController().signal;
  const timeout = t.mock.method(AbortSignal, "timeout", () => signal);
  fake(async () => { throw error; });
  await assert.rejects(providerRequest("", { ...submit, method: "post" }), e => e === error);
  assertDiagnostic(logs, "timeout", null);
  assert.deepEqual(timeout.mock.calls[0].arguments, [45_000]);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [, sent] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(sent.signal, signal);
});

test("timeout while reading a response retains HTTP status and the original abort error", async (t) => {
  const { logs, fetchMock, fake } = setup(t);
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const error = new DOMException(sentinel, "AbortError");
  const response = new Response(null, { status: 202 });
  t.mock.method(response, "json", async () => {
    controller.abort(new DOMException(sentinel, "TimeoutError"));
    throw error;
  });
  fake(async () => response);
  await assert.rejects(providerRequest("", submit), e => e === error);
  assertDiagnostic(logs, "timeout", 202);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("invalid JSON retains its SyntaxError without logging the parser message", async (t) => {
  const { logs, fake } = setup(t);
  const response = new Response(sentinel);
  const parseError = new SyntaxError(`Invalid JSON: ${sentinel}`);
  t.mock.method(response, "json", async () => { throw parseError; });
  fake(async () => response);
  await assert.rejects(providerRequest("", submit), e => e === parseError);
  assertDiagnostic(logs, "invalid_response", 200);
});

test("malformed JSON and invalid task/result shapes preserve ambiguous error semantics", async (t) => {
  const cases = [
    { name: "malformed JSON", response: () => new Response(sentinel), syntax: true },
    { name: "missing task ID", response: () => Response.json({ status: "pending", prompt: sentinel }) },
    { name: "invalid status", response: () => Response.json({ id: responseId, status: sentinel }) },
    { name: "success without output", response: () => Response.json({ id: responseId, status: "success" }) },
    { name: "invalid result URL", response: () => Response.json({ id: responseId, status: "success", data: [{ url: sentinel }] }) },
    { name: "unsafe result URL", response: () => Response.json({ id: responseId, status: "success", data: [{ url: `http://example.invalid/${sentinel}` }] }) },
    { name: "result URL credentials", response: () => Response.json({ id: responseId, status: "success", data: [{ url: `https://${sentinel}@example.invalid/video` }] }) },
  ];
  for (const entry of cases) await t.test(entry.name, async (t) => {
    const { logs, fetchMock, fake } = setup(t);
    fake(async () => entry.response());
    await assert.rejects(providerRequest("", submit), e => entry.syntax
      ? e instanceof SyntaxError && !(e instanceof ProviderError)
      : e instanceof ProviderError && e.status === 502);
    assertDiagnostic(logs, "invalid_response", 200);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

test("response body transport errors stay network failures and retain identity/status", async (t) => {
  const { logs, fake } = setup(t);
  const error = new TypeError(sentinel);
  const response = new Response(null);
  t.mock.method(response, "json", async () => { throw error; });
  fake(async () => response);
  await assert.rejects(providerRequest("", submit), e => e === error);
  assertDiagnostic(logs, "network", 200);
});

test("missing, non-UUID, and oversized original IDs are omitted from diagnostics", async (t) => {
  for (const value of [undefined, sentinel, "x".repeat(1024), `${id}-${sentinel}`, `${id}\n${sentinel}`]) {
    await t.test(value === undefined ? "missing ID" : `invalid ID length ${value.length}`, async (t) => {
      const { logs, fake } = setup(t);
      const error = new Error(sentinel);
      fake(async () => { throw error; });
      await assert.rejects(providerRequest("", {
        ...submit, headers: value === undefined ? {} : { "Idempotency-Key": value },
      }), e => e === error);
      assertDiagnostic(logs, "network", null, null);
    });
  }
});

test("new diagnostics stay silent for valid tasks and query transport/shape errors", async (t) => {
  const { logs, fetchMock, fake } = setup(t);
  for (const task of [
    { id: responseId, status: "pending" },
    { id: responseId, status: "failed" },
    { id: responseId, status: "success", data: [{ url: `https://example.invalid/${sentinel}` }] },
  ]) {
    fake(async () => Response.json(task));
    assert.deepEqual(await providerRequest("", submit), task);
  }
  const error = new TypeError(sentinel);
  fake(async () => { throw error; });
  await assert.rejects(providerRequest(`?client_request_id=${id}`), e => e === error);
  fake(async () => Response.json({ status: sentinel }));
  await assert.rejects(providerRequest(`?client_request_id=${id}`), e => e instanceof ProviderError && e.status === 502);
  assert.deepEqual(logs, []);
  assert.equal(fetchMock.mock.callCount(), 5);
});

test("local payload policy blocks and missing credentials still precede fetch", async (t) => {
  const { logs, fetchMock } = setup(t);
  for (const rejectedBody of ["{", JSON.stringify({ model: "bytedance/seedance-2-5-t2v", resolution: "480p" })]) {
    await assert.rejects(providerRequest("", { ...submit, body: rejectedBody }),
      e => e instanceof ProviderSubmissionBlockedError && !(e instanceof ProviderError));
  }
  delete process.env.VIBETOKEN_API_KEY;
  await assert.rejects(providerRequest("", submit), e => e instanceof ProviderError && e.status === 503);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(logs, []);
});

test("a failing diagnostic sink cannot replace the original error or cause a retry", async (t) => {
  const { fetchMock, fake } = setup(t);
  const error = new TypeError(sentinel);
  t.mock.method(console, "warn", () => { throw new Error("Synthetic logger failure"); });
  fake(async () => { throw error; });
  await assert.rejects(providerRequest("", submit), e => e === error);
  assert.equal(fetchMock.mock.callCount(), 1);
});
