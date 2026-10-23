import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { database, closeDatabase } from "../src/server/db";
import { jobs } from "../src/server/schema";
import { processJob, type VideoProvider } from "../src/server/jobs/runner";
import { families, resolutions, type Mode } from "../src/lib/models";
import { generationSchema, providerPayload } from "../src/server/input";
import { providerRequest, ProviderError, ProviderSubmissionBlockedError } from "../src/server/provider";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=";
const base = {
  requestId: "95ce170b-a815-4c4a-869e-7ec7dc147130",
  family: "seedance" as const,
  mode: "text" as const,
  prompt: "A leaf moving gently in sunlight",
  duration: 4,
  resolution: "720p",
  ratio: "16:9",
  audio: false,
};
const modes: Mode[] = ["text", "image"];
const modeInput = (mode: Mode) => ({
  mode,
  ratio: mode === "image" ? "adaptive" : "16:9",
  ...(mode === "image" ? { image: png } : {}),
});

test("model options exclude Seedance 480p in both modes and retain other resolutions", () => {
  for (const mode of modes) {
    assert.deepEqual(resolutions("seedance", mode), ["720p", "1080p"]);
    assert.deepEqual(resolutions("kling", mode), ["4K"]);
    assert.deepEqual(resolutions("minimax", mode), ["2K"]);
  }
});

test("server input rejects Seedance 480p without silently changing the request", () => {
  for (const mode of modes) {
    for (const duration of [4, 5, 30]) {
      const input = { ...base, ...modeInput(mode), duration, resolution: "480p" };
      const result = generationSchema.safeParse(input);
      assert.equal(result.success, false);
      if (!result.success)
        assert.ok(result.error.issues.some((issue) =>
          issue.message === "Choose supported output settings."));
      assert.equal(input.resolution, "480p");
    }
  }
});

test("Seedance 720p and 1080p keep explicit ratio, audio, duration and model payloads", () => {
  for (const mode of modes) {
    for (const resolution of ["720p", "1080p"]) {
      for (const audio of [false, true]) {
        const input = { ...base, ...modeInput(mode), resolution, audio };
        assert.deepEqual(providerPayload(generationSchema.parse(input)), {
          model: mode === "text"
            ? "bytedance/seedance-2-5-t2v"
            : "bytedance/seedance-2-5-i2v",
          prompt: base.prompt,
          duration: 4,
          ratio: input.ratio,
          resolution,
          generate_audio: audio,
          output_format: "mp4",
          ...(mode === "image" ? { image_urls: [png] } : {}),
        });
      }
    }
  }
});

test("Kling and MiniMax retain both modes, durations and exact payload contracts", () => {
  for (const family of ["kling", "minimax"] as const) {
    const f = families.find((entry) => entry.slug === family)!;
    for (const mode of modes) {
      for (const duration of f.durations) {
        for (const audio of [false, true]) {
          const input = {
            ...base, ...modeInput(mode), family, duration, audio,
            resolution: family === "kling" ? "4K" : "2K",
          };
          assert.deepEqual(providerPayload(generationSchema.parse(input)), {
            model: mode === "text" ? f.t2v : f.i2v,
            prompt: base.prompt,
            duration: family === "minimax" ? String(duration) : duration,
            ...(mode === "image" ? { image_urls: [png] } : {}),
            ...(family === "kling"
              ? { sound: audio, ...(mode === "text" ? { aspect_ratio: "16:9" } : {}) }
              : { resolution: "2K", aspect_ratio: input.ratio }),
          });
        }
      }
    }
  }
});

test("provider blocks stored Seedance 480p payloads before credentials or fetch", async (t) => {
  delete process.env.VIBETOKEN_API_KEY;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    assert.fail("Blocked payload must never reach fetch");
  });
  for (const model of ["bytedance/seedance-2-5-t2v", "bytedance/seedance-2-5-i2v"]) {
    for (const method of ["POST", "post"]) {
      const body = JSON.stringify({ model, duration: 4, resolution: "480p" });
      await assert.rejects(providerRequest("", { method, body }),
        (error: unknown) => error instanceof ProviderSubmissionBlockedError &&
          !(error instanceof ProviderError));
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("provider passes allowed model payloads unchanged exactly once using mock fetch", async (t) => {
  process.env.VIBETOKEN_API_KEY = "offline-test-key";
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: "offline-task", status: "pending" }));
  let calls = 0;
  for (const f of families) {
    for (const mode of modes) {
      for (const resolution of resolutions(f.slug, mode)) {
        const body = JSON.stringify(providerPayload(generationSchema.parse({
          ...base, ...modeInput(mode), family: f.slug,
          duration: f.defaultDuration, resolution,
        })));
        const headers = { "Idempotency-Key": base.requestId };
        await providerRequest("", { method: "POST", headers, body });
        assert.equal(fetchMock.mock.callCount(), ++calls);
        const [url, sent] = fetchMock.mock.calls[calls - 1].arguments as unknown as
          [string, RequestInit];
        assert.equal(url, "https://vibetoken.cn/v1/videos/generations");
        assert.equal(sent.body, body);
        assert.equal(new Headers(sent.headers).get("Idempotency-Key"), base.requestId);
      }
    }
  }
});

test("provider still permits status lookup and never retries an upstream rejection", async (t) => {
  process.env.VIBETOKEN_API_KEY = "offline-test-key";
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: "offline-task", status: "failed" }));
  assert.equal((await providerRequest("/offline-task")).status, "failed");
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 400 }));
  const body = JSON.stringify(providerPayload(generationSchema.parse(base)));
  await assert.rejects(providerRequest("", { method: "POST", body }),
    (error: unknown) => error instanceof ProviderError && error.status === 400);
  assert.equal(fetchMock.mock.callCount(), 2);
  const [, sent] = fetchMock.mock.calls[1].arguments as unknown as [string, RequestInit];
  assert.equal(sent.body, body);
});

// Exercise the production runner and real database state, never extracted source.
// Keep this suite on the credit QA database even when the legacy API uses video_qa.
const creditTestDatabaseUrl = process.env.CREDIT_TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalProviderKey = process.env.VIBETOKEN_API_KEY;
const runnerJobs: string[] = [];
before(() => {
  if (!creditTestDatabaseUrl) return;
  const u = new URL(creditTestDatabaseUrl);
  assert.equal(u.hostname, "127.0.0.1");
  assert.equal(u.port, "55439");
  assert.equal(u.pathname, "/video_credit_qa");
  process.env.DATABASE_URL = creditTestDatabaseUrl;
});
after(async () => {
  try {
    if (runnerJobs.length)
      await database().delete(jobs).where(inArray(jobs.id, runnerJobs));
  } finally {
    await closeDatabase();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalProviderKey === undefined) delete process.env.VIBETOKEN_API_KEY;
    else process.env.VIBETOKEN_API_KEY = originalProviderKey;
  }
});
const runnerProvider: VideoProvider = {
  kind: "fake",
  request: providerRequest,
  verifyDelivery: async () => assert.fail("Rejected submissions cannot verify a delivery"),
};
async function storedJob(payload: Record<string, unknown>) {
  const id = randomUUID();
  await database().insert(jobs).values({
    id, owner: randomUUID(), family: "seedance",
    mode: String(payload.model).endsWith("i2v") ? "image" : "text",
    prompt: base.prompt, duration: 4, resolution: String(payload.resolution),
    fingerprint: `model-regression-${id}`, payload, status: "submitting",
    // Only this test's force claim may take a new fixture; another test's worker
    // can run concurrently in the same isolated database.
    nextPollAt: new Date(Date.now() + 3600_000),
  });
  runnerJobs.push(id);
  return id;
}
async function readJob(id: string) {
  const row = await database().query.jobs.findFirst({ where: eq(jobs.id, id) });
  assert.ok(row, "Persisted runner job must exist");
  return row;
}

test("production runner preserves unknown and payload after local 480p block; recovery only looks up original task", { skip: !creditTestDatabaseUrl }, async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(null, { status: 404 }));
  let localBlocks = 0;
  const provider: VideoProvider = {
    ...runnerProvider,
    request: async (path, options) => {
      try { return await providerRequest(path, options); }
      catch (error) {
        if (error instanceof ProviderSubmissionBlockedError) localBlocks++;
        throw error;
      }
    },
  };
  for (const model of ["bytedance/seedance-2-5-t2v", "bytedance/seedance-2-5-i2v"]) {
    delete process.env.VIBETOKEN_API_KEY;
    const payload = { model, duration: 4, resolution: "480p" };
    const id = await storedJob(payload);
    const callsBefore = fetchMock.mock.callCount(), blocksBefore = localBlocks;
    await processJob(id, provider, true);
    const blocked = await readJob(id);
    assert.equal(localBlocks, blocksBefore + 1, "Production provider must reject 480p locally");
    assert.equal(fetchMock.mock.callCount(), callsBefore, "Local policy block must not fetch");
    assert.equal(blocked.status, "unknown");
    assert.deepEqual(blocked.payload, payload);
    assert.equal(blocked.upstreamId, null);
    assert.equal(blocked.resultUrl, null);
    assert.equal(blocked.creditState, "none");
    assert.ok(blocked.submissionStartedAt);
    assert.equal(blocked.leaseToken, null);

    // An unknown remote task must remain unknown after a lookup miss. Never
    // re-POST the stored 480p payload, upgrade it, or pretend remote failure.
    process.env.VIBETOKEN_API_KEY = "offline-test-key";
    await processJob(id, provider, true);
    const recovered = await readJob(id);
    assert.equal(recovered.status, "unknown");
    assert.deepEqual(recovered.payload, payload);
    assert.equal(recovered.id, id);
    assert.equal(recovered.upstreamId, null);
    assert.equal(localBlocks, blocksBefore + 1);
    assert.equal(fetchMock.mock.callCount(), callsBefore + 1);
    const [url, sent] = fetchMock.mock.calls[callsBefore].arguments as unknown as [string, RequestInit];
    assert.equal(url, `https://vibetoken.cn/v1/videos/generations?client_request_id=${id}`);
    assert.equal(sent.method ?? "GET", "GET");
    assert.equal(sent.body, undefined);
  }
});

test("production runner persists 400 submission as failed but 503 and lookup errors as unknown", { skip: !creditTestDatabaseUrl }, async (t) => {
  process.env.VIBETOKEN_API_KEY = "offline-test-key";
  let remoteStatus = 400;
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(null, { status: remoteStatus }));
  const payload = providerPayload(generationSchema.parse(base));
  const rejectedId = await storedJob(payload);
  await processJob(rejectedId, runnerProvider, true);
  const rejected = await readJob(rejectedId);
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.payload, null);
  assert.equal(rejected.upstreamId, null);
  assert.equal(rejected.leaseToken, null);
  assert.equal(fetchMock.mock.callCount(), 1);
  await processJob(rejectedId, runnerProvider, true);
  assert.equal(fetchMock.mock.callCount(), 1, "Terminal rejection must not retry");

  remoteStatus = 503;
  const uncertainId = await storedJob(payload);
  await processJob(uncertainId, runnerProvider, true);
  const uncertain = await readJob(uncertainId);
  assert.equal(uncertain.status, "unknown");
  assert.deepEqual(uncertain.payload, payload);
  assert.equal(uncertain.upstreamId, null);
  assert.equal(uncertain.leaseToken, null);
  assert.equal(fetchMock.mock.callCount(), 2);
  for (const [index, id] of [[0, rejectedId], [1, uncertainId]] as const) {
    const [url, sent] = fetchMock.mock.calls[index].arguments as unknown as [string, RequestInit];
    assert.equal(url, "https://vibetoken.cn/v1/videos/generations");
    assert.equal(sent.method, "POST");
    assert.deepEqual(JSON.parse(String(sent.body)), payload);
    assert.equal(new Headers(sent.headers).get("Idempotency-Key"), id);
  }
  remoteStatus = 400;
  await processJob(uncertainId, runnerProvider, true);
  const lookupError = await readJob(uncertainId);
  assert.equal(lookupError.status, "unknown", "A lookup HTTP 400 cannot prove generation failed");
  assert.deepEqual(lookupError.payload, payload);
  assert.equal(fetchMock.mock.callCount(), 3);
  const [url, sent] = fetchMock.mock.calls[2].arguments as unknown as [string, RequestInit];
  assert.equal(url, `https://vibetoken.cn/v1/videos/generations?client_request_id=${uncertainId}`);
  assert.equal(sent.method ?? "GET", "GET");
});
