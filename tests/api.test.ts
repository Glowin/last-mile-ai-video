import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createApp } from "../src/server/app";
import { providerRequest } from "../src/server/provider";
// Exercise the actual provider HTTP adapter against mocked fetch. Delivery-network
// behavior is tested separately; this legacy API suite must not fetch example.com.
const app = createApp({ videoProvider: {
  kind: "fake",
  request: providerRequest,
  verifyDelivery: async () => true,
} });
import { database, closeDatabase } from "../src/server/db";
const integration = !!process.env.DATABASE_URL;
const originalFetch = global.fetch;
let calls = 0,
  lookups = 0,
  failNext = false;
const upstream = new Map<
  string,
  { id: string; status: string; data?: { url: string }[] }
>();
function request(
  path: string,
  method = "GET",
  cookie = "",
  body?: unknown,
  origin = process.env.APP_URL!,
) {
  return app.request(`http://localhost/api${path}`, {
    method,
    headers: { origin, cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login() {
  const r = await request("/session", "POST", "", {
    code: process.env.DEMO_ACCESS_CODE,
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
const input = (requestId = randomUUID()) => ({
  requestId,
  family: "seedance",
  mode: "text",
  prompt: "A leaf in sunlight",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  audio: false,
});
before(async () => {
  if (!integration) return;
  const u = new URL(process.env.DATABASE_URL!);
  assert.equal(
    u.hostname,
    "127.0.0.1",
    "Integration tests require the dedicated loopback QA DB",
  );
  assert.equal(u.pathname, "/video_qa");
  assert.equal(u.protocol, "postgresql:");
  assert.ok(u.username && u.username !== "postgres", "Use a dedicated test role");
  assert.ok(u.port && u.port !== "5432");
  assert.equal(u.search, ""); assert.equal(u.hash, "");
  const [identity] = await database().execute(sql`SELECT current_database() AS db,current_user AS role`);
  assert.equal(identity.db, "video_qa"); assert.equal(identity.role, u.username);
  await database().execute(sql`TRUNCATE credit_allocations,credit_audit,video_quotes,video_jobs,demo_login_attempts CASCADE`);
  global.fetch = async (url, init) => {
    assert.ok(
      String(url).startsWith("https://vibetoken.cn/v1/videos/generations"),
    );
    if (init?.method === "POST") {
      calls++;
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      if (!upstream.has(key))
        upstream.set(key, { id: `provider-${key}`, status: "pending" });
      if (failNext) {
        failNext = false;
        throw new Error(
          "Simulated connection interruption after provider accepted task",
        );
      }
      return Response.json(upstream.get(key));
    }
    lookups++;
    const parsed = new URL(String(url));
    const requestId = parsed.searchParams.get("client_request_id");
    const t = requestId
      ? upstream.get(requestId)
      : [...upstream.values()].find((x) => parsed.pathname.endsWith(x.id));
    return t
      ? Response.json(t)
      : Response.json({ error: "not found" }, { status: 404 });
  };
});
after(async () => {
  global.fetch = originalFetch;
  await closeDatabase();
});
test(
  "real PostgreSQL API flow: CSRF, sessions, ownership, idempotency, recovery, quota",
  { skip: !integration },
  async () => {
    assert.equal((await request("/jobs")).status, 401);
    assert.equal(
      (
        await request(
          "/session",
          "POST",
          "",
          { code: process.env.DEMO_ACCESS_CODE },
          "https://wrong.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/session", "POST", "", { code: "wrong" })).status,
      401,
    );
    const alice = await login(),
      bob = await login();
    assert.notEqual(alice, bob);
    const i = input();
    const responses = await Promise.all([
      request("/jobs", "POST", alice, i),
      request("/jobs", "POST", alice, i),
    ]);
    assert.deepEqual(responses.map((x) => x.status).sort(), [200, 201]);
    assert.equal(calls, 1);
    const a = await (await request("/jobs", "GET", alice)).json();
    assert.equal(a.jobs.length, 1);
    assert.equal(a.jobs[0].status, "pending");
    assert.ok(!("payload" in a.jobs[0]));
    assert.ok(!("upstreamId" in a.jobs[0]));
    assert.equal(
      (await request(`/jobs/${i.requestId}`, "GET", bob)).status,
      404,
    );
    assert.equal(
      (await (await request("/jobs", "GET", bob)).json()).jobs.length,
      0,
    );
    assert.equal(
      (await request("/jobs", "POST", alice, { ...i, prompt: "Changed input" }))
        .status,
      409,
    );
    upstream.set(i.requestId, {
      id: `provider-${i.requestId}`,
      status: "success",
      data: [{ url: "https://example.com/test-output.mp4" }],
    });
    await database().execute(
      sql`UPDATE video_jobs SET next_poll_at=now()-interval '10 seconds' WHERE id=${i.requestId}::uuid`,
    );
    const complete = await (
      await request(`/jobs/${i.requestId}`, "GET", alice)
    ).json();
    assert.equal(complete.job.status, "success");
    assert.equal(complete.job.resultUrl, "https://example.com/test-output.mp4");
    failNext = true;
    const second = input();
    const unknown = await (
      await request("/jobs", "POST", alice, second)
    ).json();
    assert.equal(unknown.job.status, "unknown");
    const lookupsBeforeRecovery = lookups;
    const recovered = await (
      await request(`/jobs/${second.requestId}/recover`, "POST", alice)
    ).json();
    assert.equal(recovered.job.status, "pending");
    assert.equal(lookups, lookupsBeforeRecovery + 1);
    assert.equal(upstream.size, 2);
    assert.equal(calls, 2);
    const rows = await database().execute(
      sql`SELECT count(*)::int AS n FROM video_jobs WHERE payload IS NOT NULL`,
    );
    assert.equal(rows[0].n, 0);
    process.env.GENERATION_DAILY_LIMIT = "2";
    assert.equal((await request("/jobs", "POST", alice, input())).status, 429);
    assert.equal(calls, 2);
    // Existing idempotent requests still work after the limit is reached.
    assert.equal((await request("/jobs", "POST", alice, i)).status, 200);
    assert.equal((await request("/jobs/not-a-uuid", "GET", alice)).status, 404);
  },
);
