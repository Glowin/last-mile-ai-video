import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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

// Execute the current production submit function, not a copied error classifier.
// Only its database/SQL collaborators are mocked; app.ts remains untouched.
const appSource = readFileSync(new URL("../src/server/app.ts", import.meta.url), "utf8");
const submitHeader = "async function submit(j: typeof jobs.$inferSelect) {";
const submitEnd = "\nconst uuidPattern =";
assert.equal(appSource.split(submitHeader).length, 2, "Expected one submit declaration");
assert.equal(appSource.split(submitEnd).length, 2, "Expected one submit end boundary");
const submitStart = appSource.indexOf(submitHeader);
const submitStop = appSource.indexOf(submitEnd);
assert.ok(submitStop > submitStart, "Production submit boundaries changed");
// Strip only the known parameter type. Execute the complete, unchanged JS body.
// Fail closed on source shape changes instead of silently testing an old copy.
const submitCode = appSource.slice(submitStart, submitStop)
  .replace(submitHeader, "async function submit(j) {") + "\nsubmit;";

type StoredJob = {
  id: string;
  status: string;
  payload: Record<string, unknown> | null;
  upstreamId: string | null;
};
async function runProductionSubmit(row: StoredJob) {
  const writes: Partial<StoredJob>[] = [];
  const submit = runInNewContext(submitCode, {
    providerRequest,
    ProviderError,
    storeTask: () => assert.fail("Rejected submission cannot store a remote task"),
    database: () => ({
      update: () => ({
        set: (update: Partial<StoredJob>) => {
          writes.push(update);
          return { where: () => ({ returning: async () => [{ ...row, ...update }] }) };
        },
      }),
    }),
    jobs: { id: "id", status: "status" },
    and: (...conditions: unknown[]) => conditions,
    eq: (...values: unknown[]) => values,
    sql: (...values: unknown[]) => values,
  }) as (job: StoredJob) => Promise<StoredJob>;
  return { result: await submit(row), writes };
}

test("production submit preserves unknown and payload when a local 480p block stops recovery", async (t) => {
  delete process.env.VIBETOKEN_API_KEY;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    assert.fail("Local recovery block must not send any request");
  });
  for (const model of ["bytedance/seedance-2-5-t2v", "bytedance/seedance-2-5-i2v"]) {
    // recover claims unknown as submitting before calling submit.
    for (const status of ["unknown", "submitting"]) {
      const payload = { model, duration: 4, resolution: "480p" };
      const row = { id: base.requestId, status, payload, upstreamId: null };
      const { result, writes } = await runProductionSubmit(row);
      assert.equal(result.status, "unknown");
      assert.equal(result.payload, payload);
      assert.equal(result.id, row.id);
      assert.equal(result.upstreamId, row.upstreamId);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].status, "unknown");
      assert.equal(Object.hasOwn(writes[0], "payload"), false);
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("production submit still distinguishes explicit upstream rejection from uncertainty", async (t) => {
  process.env.VIBETOKEN_API_KEY = "offline-test-key";
  let remoteStatus = 400;
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(null, { status: remoteStatus }));
  const payload = providerPayload(generationSchema.parse(base));
  const row = { id: base.requestId, status: "submitting", payload, upstreamId: null };
  const rejected = await runProductionSubmit(row);
  assert.equal(rejected.result.status, "failed");
  assert.equal(rejected.result.payload, null);
  assert.equal(fetchMock.mock.callCount(), 1);
  remoteStatus = 503;
  const uncertain = await runProductionSubmit(row);
  assert.equal(uncertain.result.status, "unknown");
  assert.equal(uncertain.result.payload, payload);
  assert.equal(fetchMock.mock.callCount(), 2);
});
