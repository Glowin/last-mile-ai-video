import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { SignJWT } from "jose";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { app } from "../src/server/app";
import { accountRoutes } from "../src/server/account-routes";
import { closeDatabase, database } from "../src/server/db";
import { createLogin, setLogin } from "../src/server/account";
import { issueSession } from "../src/server/auth";
import { authSessions, users } from "../src/server/schema";
import { migrate } from "../scripts/migrate.mjs";
import { api, IDENTITY_CHANGED_KEY } from "../src/lib/api";

// Explicit opt-in, fresh loopback database only. Never consume DATABASE_URL or
// load configuration files. The caller owns stopping/removing the test cluster.
const testUrl = process.env.ACCOUNT_TEST_DATABASE_URL;
const testSecret = "account-profile-test-only-secret-000000000000";
const originalFetch = global.fetch;
let db: ReturnType<typeof postgres> | undefined;
let ownsSchema = false;

before(async () => {
  if (!testUrl) return;
  const url = new URL(testUrl);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/video_account_qa");
  assert.equal(url.username, "account_test");
  assert.ok(url.port && url.port !== "5432");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: testUrl,
    SESSION_SECRET: testSecret,
    APP_URL: "http://localhost:3999",
    GOOGLE_CLIENT_ID: "account-test-only",
  });
  delete process.env.VIBETOKEN_API_KEY;
  delete process.env.DEMO_ACCESS_CODE;
  global.fetch = async () => { throw new Error("External network forbidden in account tests"); };
  db = postgres(testUrl, { max: 1 });
  const rows = await db`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  assert.equal(rows.length, 0, "Provide a fresh disposable database; existing tables will not be overwritten");
  ownsSchema = true;
  await migrate(testUrl);
  // Exercise the actual app middleware; the parent mounts this router in app.ts.
  if (!app.routes.some((route) => route.method === "GET" && route.path === "/api/account"))
    app.route("/", accountRoutes);
});

after(async () => {
  global.fetch = originalFetch;
  await closeDatabase();
  if (db) {
    try {
      if (ownsSchema) {
        await db`DROP SCHEMA public CASCADE`;
        await db`CREATE SCHEMA public`;
      }
    } finally { await db.end(); }
  }
});

class Browser {
  cookies = new Map<string, string>();
  owner?: string;
  async request(path: string, method = "GET", options: { owner?: string | null; origin?: string | null; crossSite?: boolean } = {}) {
    const owner = options.owner === undefined ? this.owner : options.owner;
    const origin = options.origin === undefined ? process.env.APP_URL : options.origin;
    const response = await app.request(`http://localhost/api${path}`, {
      method,
      headers: {
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(owner !== undefined && owner !== null ? { "X-KakaReel-Owner": owner } : {}),
        ...(origin ? { origin } : {}),
        ...(options.crossSite ? { "Sec-Fetch-Site": "cross-site" } : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, ...value] = cookie.split(";")[0].split("=");
      if (!value.join("=") || cookie.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value.join("="));
    }
    return response;
  }
}

async function user(invited = false) {
  const [row] = await database().insert(users).values({
    id: randomUUID(), googleSub: randomUUID(), email: `${randomUUID()}@example.test`,
    name: "Account Test", invitedAt: invited ? new Date() : null,
    createdAt: new Date("2026-01-02T03:04:05Z"),
  }).returning();
  return row;
}
async function login(userId: string) {
  const login = await database().transaction((tx) => createLogin(tx, userId));
  const issuer = new Hono().get("/", async (c) => {
    await setLogin(c, login);
    return c.json({ ok: true });
  });
  const response = await issuer.request("http://localhost/");
  const browser = new Browser();
  browser.owner = userId;
  for (const cookie of response.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(";")[0].split("=");
    browser.cookies.set(name, value.join("="));
  }
  return { browser, sessionId: login.sessionId };
}

test("account profile and session isolation against real PostgreSQL", { skip: !testUrl }, async (t) => {
  const alice = await user(), bob = await user(true);
  const current = await login(alice.id), other = await login(alice.id), victim = await login(bob.id);
  const expired = await login(alice.id), revoked = await login(alice.id);
  await database().update(authSessions).set({ expiresAt: new Date(0) }).where(eq(authSessions.id, expired.sessionId));
  await database().update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, revoked.sessionId));

  await t.test("anonymous and preview guests cannot read or mutate accounts; public auth remains public", async () => {
    const browser = new Browser();
    for (const guest of [false, true]) {
      if (guest) browser.cookies.set("lm_session", issueSession());
      for (const [path, method] of [["/account", "GET"], ["/account/sessions/others", "DELETE"]]) {
        const response = await browser.request(path, method);
        assert.equal(response.status, 401);
        assert.deepEqual(Object.keys(await response.json()), ["error"]);
      }
    }
    assert.equal((await browser.request("/config")).status, 200);
    assert.equal((await browser.request("/session")).status, 200);
  });

  await t.test("profile contains only explicit own fields and active own sessions, with real preview permission and dates", async () => {
    const response = await current.browser.request(`/account?userId=${bob.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["canGenerate", "sessions", "user"]);
    assert.deepEqual(body.user, { id: alice.id, name: alice.name, email: alice.email, createdAt: alice.createdAt.toISOString() });
    assert.equal(body.canGenerate, false);
    assert.deepEqual(body.sessions.map((s: { id: string }) => s.id).sort(), [current.sessionId, other.sessionId].sort());
    for (const session of body.sessions) {
      assert.deepEqual(Object.keys(session).sort(), ["current", "expiresAt", "id"]);
      assert.equal(session.current, session.id === current.sessionId);
      assert.ok(new Date(session.expiresAt) > new Date());
    }
    assert.ok(!JSON.stringify(body).includes(bob.email));
    assert.equal((await (await victim.browser.request("/account")).json()).canGenerate, true);
    // Every request re-reads permission; it is not frozen into the access token.
    await database().update(users).set({ invitedAt: new Date() }).where(eq(users.id, alice.id));
    assert.equal((await (await current.browser.request("/account")).json()).canGenerate, true);
  });

  await t.test("CSRF and displayed-owner guards reject requests before any revocation", async () => {
    for (const origin of [null, "null", "https://attacker.example"])
      assert.equal((await current.browser.request("/account/sessions/others", "DELETE", { origin })).status, 403);
    assert.equal((await current.browser.request("/account/sessions/others", "DELETE", { crossSite: true })).status, 403);
    for (const owner of [null, bob.id])
      assert.equal((await current.browser.request("/account/sessions/others", "DELETE", { owner })).status, 409);
    const mismatch = await current.browser.request("/account", "GET", { owner: bob.id });
    assert.equal(mismatch.status, 409);
    assert.deepEqual(Object.keys(await mismatch.json()), ["error"]);
    assert.equal((await other.browser.request("/account")).status, 200);
    assert.equal((await victim.browser.request("/account")).status, 200);
  });

  await t.test("expired, revoked and forged access tokens fail closed with refresh-compatible errors", async () => {
    const forged = new Browser();
    forged.cookies.set("kr_access", "invalid-token");
    const expiredAccess = new Browser();
    expiredAccess.cookies.set("kr_access", await new SignJWT({ sid: current.sessionId })
      .setProtectedHeader({ alg: "HS256" }).setSubject(alice.id).setIssuer("kakareel")
      .setAudience("kakareel-studio").setExpirationTime(1).sign(new TextEncoder().encode(testSecret)));
    for (const browser of [expired.browser, revoked.browser, forged, expiredAccess]) {
      for (const [path, method] of [["/account", "GET"], ["/account/sessions/others", "DELETE"]]) {
        const response = await browser.request(path, method);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, "SESSION_EXPIRED");
      }
    }
  });

  await t.test("sign out others preserves current and other users, and invalidates both access and refresh", async () => {
    const response = await current.browser.request("/account/sessions/others", "DELETE");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, revoked: 1 });
    assert.equal((await other.browser.request("/account")).status, 401);
    assert.equal((await other.browser.request("/auth/refresh", "POST")).status, 401);
    assert.equal((await victim.browser.request("/account")).status, 200);
    assert.equal((await victim.browser.request("/auth/refresh", "POST")).status, 200);
    assert.equal((await current.browser.request("/auth/refresh", "POST")).status, 200);
    const body = await (await current.browser.request("/account")).json();
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].id, current.sessionId);
    assert.equal(body.sessions[0].current, true);
    assert.deepEqual(await (await current.browser.request("/account/sessions/others", "DELETE")).json(), { ok: true, revoked: 0 });
  });

  await t.test("logout rejects a stale or empty owner header without clearing cookies or revoking either account", async () => {
    const a = await login(alice.id), b = await login(bob.id);
    const originalCookies = new Map(b.browser.cookies);
    // The UI still shows Alice, but another tab has replaced its cookies with Bob's.
    for (const owner of [alice.id, ""]) {
      const response = await b.browser.request("/session", "DELETE", { owner });
      assert.equal(response.status, 409);
      assert.equal(response.headers.getSetCookie().length, 0);
      assert.deepEqual(Object.keys(await response.json()), ["error"]);
      assert.deepEqual(b.browser.cookies, originalCookies);
    }
    for (const session of [a, b]) {
      assert.equal((await session.browser.request("/account")).status, 200);
      const [row] = await database().select().from(authSessions).where(eq(authSessions.id, session.sessionId));
      assert.equal(row.revokedAt, null);
      assert.equal((await session.browser.request("/auth/refresh", "POST")).status, 200);
    }
    const anonymous = new Browser();
    assert.equal((await anonymous.request("/session", "DELETE", { owner: alice.id })).status, 409);
  });

  await t.test("matching-owner logout revokes access and refresh, while no-header studio logout stays compatible", async () => {
    for (const includeOwner of [true, false]) {
      const session = await login(alice.id);
      const replay = new Browser();
      replay.owner = alice.id;
      replay.cookies = new Map(session.browser.cookies);
      const response = await session.browser.request("/session", "DELETE", { owner: includeOwner ? alice.id : null });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(session.browser.cookies.size, 0);
      assert.equal((await replay.request("/account")).status, 401);
      assert.equal((await replay.request("/auth/refresh", "POST")).status, 401);
    }
    const guest = new Browser(), replay = new Browser();
    guest.cookies.set("lm_session", issueSession());
    replay.cookies = new Map(guest.cookies);
    assert.equal((await guest.request("/session", "DELETE")).status, 200);
    assert.equal(guest.cookies.size, 0);
    assert.equal((await (await replay.request("/session")).json()).authenticated, false);
    assert.equal((await new Browser().request("/session", "DELETE")).status, 200);
  });

  await t.test("owner-bound logout refreshes expired access before checking identity and never mutates on that first failure", async () => {
    const session = await login(alice.id);
    session.browser.cookies.delete("kr_access");
    const response = await session.browser.request("/session", "DELETE");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "SESSION_EXPIRED");
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal((await session.browser.request("/auth/refresh", "POST")).status, 200);
    // If refresh reveals a replacement account, the retry still cannot sign it out.
    assert.equal((await session.browser.request("/session", "DELETE", { owner: bob.id })).status, 409);
    assert.equal((await session.browser.request("/account")).status, 200);
    assert.equal((await session.browser.request("/session", "DELETE")).status, 200);
  });

  await t.test("simultaneous requests from two sessions cannot revoke each other after losing authority", async () => {
    const concurrentUser = await user();
    const a = await login(concurrentUser.id), b = await login(concurrentUser.id);
    const results = await Promise.all([a, b].map(({ browser }) => browser.request("/account/sessions/others", "DELETE")));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    const survivors = await Promise.all([a, b].map(async ({ browser }) => (await browser.request("/account")).status));
    assert.deepEqual(survivors.sort(), [200, 401]);
  });
});

test("account requests discard old profiles and never retry a mutation as another tab's account", async () => {
  const previousFetch = global.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let version = "alice";
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === IDENTITY_CHANGED_KEY ? version : null,
  } });
  try {
    global.fetch = async () => {
      version = "bob";
      return Response.json({ user: { email: "alice@example.test" } });
    };
    await assert.rejects(api("/account"), /account changed/i);
    version = "alice";
    let mutations = 0;
    global.fetch = async (url, init) => {
      if (url === "/api/account/sessions/others") {
        mutations++;
        assert.equal((init?.headers as Record<string, string>)["X-KakaReel-Owner"], "alice");
        return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
      }
      assert.equal(url, "/api/session");
      version = "bob";
      return Response.json({ authenticated: true, user: { id: "bob" } });
    };
    await assert.rejects(api("/account/sessions/others", {
      method: "DELETE", headers: { "X-KakaReel-Owner": "alice" },
    }), /account changed/i);
    assert.equal(mutations, 1);
  } finally {
    global.fetch = previousFetch;
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
