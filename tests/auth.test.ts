import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createApp } from "../src/server/app";
import { providerRequest } from "../src/server/provider";
// Identity tests use a mocked transport; live cost/moderation gates have their own suite.
const app = createApp({ videoProvider: { kind: "fake", request: providerRequest, verifyDelivery: async () => true } });
import { database, closeDatabase } from "../src/server/db";
import { migrate } from "../scripts/migrate.mjs";
import { issueSession, sessionOwner } from "../src/server/auth";
import { AGE_POLICY_VERSION } from "../src/lib/age-declaration";
const adult = { birthDate: "1990-01-01", confirmed: true, policyVersion: AGE_POLICY_VERSION };
import { tokenHash } from "../src/server/account";

const integration = !!process.env.AUTH_TEST_DATABASE_URL;
if (integration) process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const originalFetch = global.fetch;
let providerCalls = 0;
const legacyGuest = issueSession;
const legacyId = randomUUID();
let legacyCookie = "";

class Browser {
  cookies = new Map<string, string>();
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  clone() {
    const b = new Browser();
    b.cookies = new Map(this.cookies);
    return b;
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    origin: string | null = process.env.APP_URL!,
    extraHeaders: Record<string, string> = {},
  ) {
    const r = await app.request(`http://localhost/api${path}`, {
      method,
      headers: {
        cookie: this.header(),
        "Content-Type": "application/json",
        ...(origin === null ? {} : { origin }),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const [name, ...rest] = cookie.split(";")[0].split("=");
      const value = rest.join("=");
      if (!value || cookie.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return r;
  }
}
async function credential(
  nonce: string,
  sub = "google-alice",
  claims: Record<string, unknown> = {},
) {
  return new SignJWT({
    sub,
    aud: process.env.GOOGLE_CLIENT_ID,
    iss: "https://accounts.google.com",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: `${sub}@example.com`,
    email_verified: true,
    name: "Test User",
    nonce,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-only-key" })
    .sign(key.privateKey);
}
async function challenge(b: Browser) {
  const r = await b.request("/auth/challenge", "POST");
  assert.equal(r.status, 200);
  return (await r.json()).nonce as string;
}
async function login(
  b: Browser,
  sub = "google-alice",
  claims: Record<string, unknown> = {},
) {
  const nonce = await challenge(b);
  const r = await b.request("/auth/google", "POST", {
    credential: await credential(nonce, sub, claims),
    ageDeclaration: adult,
  });
  assert.equal(r.status, 200);
  const s = await b.request("/session");
  assert.equal(s.status, 200);
  return s.json();
}
async function seedJob(owner: string, id = randomUUID(), status = "success") {
  await database()
    .execute(sql`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,status)
    VALUES(${id}::uuid,${owner}::uuid,'seedance','text','Existing history',5,'720p','test',${status})`);
  return id;
}
const input = () => ({
  requestId: randomUUID(),
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
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "Auth tests require their own disposable loopback database",
  );
  assert.equal(url.protocol, "postgresql:");
  assert.ok(url.username && url.username !== "postgres", "Use a dedicated test role");
  assert.ok(url.port && url.port !== "5432", "Use a disposable test port");
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.equal(url.pathname, "/video_auth_qa");
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // Only the explicitly named, disposable, loopback auth test database may be reset.
    const [identity] = await db`SELECT current_database() AS db,current_user AS role`;
    assert.equal(identity.db, url.pathname.slice(1));
    assert.equal(identity.role, url.username);
    await db`DROP SCHEMA public CASCADE`;
    await db`CREATE SCHEMA public`;
    // Simulate a real pre-upgrade installation; the migrator must adopt 0001 without deleting jobs.
    await db.unsafe(
      await readFile(new URL("../db/0001-init.sql", import.meta.url), "utf8"),
    );
    legacyCookie = legacyGuest();
    await db`INSERT INTO video_jobs(id,owner,family,mode,prompt,duration,resolution,fingerprint,status)
      VALUES(${legacyId},${sessionOwner(legacyCookie)!},'seedance','text','Before upgrade',5,'720p','legacy','success')`;
    const authSql = await readFile(new URL("../db/0002-google-auth.sql", import.meta.url), "utf8");
    await db.unsafe(authSql);
    await db`CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    await db`INSERT INTO schema_migrations(name,checksum) VALUES('0002-google-auth.sql',${createHash("sha256").update(authSql).digest("hex")})`;
    await db`INSERT INTO users(id,google_sub,email) VALUES(${randomUUID()},'pre-age-migration','legacy-age@example.invalid')`;
  } finally {
    await db.end();
  }
  await Promise.all([migrate(), migrate()]);
  mock.method(
    OAuth2Client.prototype,
    "getFederatedSignonCertsAsync",
    async () => ({
      certs: {
        "test-only-key": key.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      format: "PEM",
    }),
  );
  global.fetch = async (url, init) => {
    assert.ok(
      String(url).startsWith("https://vibetoken.cn/v1/videos/generations"),
      "Unexpected network access blocked",
    );
    if (init?.method !== "POST") return Response.json({ error: "not found" }, { status: 404 });
    providerCalls++;
    assert.equal(init?.method, "POST");
    return Response.json({ id: `mock-${randomUUID()}`, status: "pending" });
  };
});
after(async () => {
  mock.restoreAll();
  global.fetch = originalFetch;
  await closeDatabase();
});

test(
  "real PostgreSQL Google identity and session security",
  { skip: !integration },
  async (t) => {
    await t.test("new Google identity cannot create user/session before an adult declaration", async () => {
      const b = new Browser(), nonce = await challenge(b);
      const token = await credential(nonce, "age-new-user");
      for (const [ageDeclaration, expected] of [[undefined, 428], [{ ...adult, confirmed: false }, 428],
        [{ ...adult, birthDate: "2000-02-30" }, 400]] as const) {
        const response = await b.request("/auth/google", "POST", { credential: token, ageDeclaration });
        assert.equal(response.status, expected);
        assert.equal(b.cookies.has("kr_access"), false);
        assert.equal(b.cookies.has("kr_refresh"), false);
        const rows = await database().execute(sql`SELECT id FROM users WHERE google_sub='age-new-user'`);
        assert.equal(rows.length, 0);
      }
      assert.equal((await b.request("/auth/google", "POST", { credential: token, ageDeclaration: adult })).status, 200);
      const [row] = await database().execute(sql`SELECT * FROM users WHERE google_sub='age-new-user'`);
      assert.ok(row.age_confirmed_at);
      assert.equal(row.age_policy_version, AGE_POLICY_VERSION);
      assert.ok(!JSON.stringify(row).includes(adult.birthDate));
      // An already declared account does not need to resend DOB at a later login.
      const returning = new Browser(), nextNonce = await challenge(returning);
      assert.equal((await returning.request("/auth/google", "POST", { credential: await credential(nextNonce, "age-new-user") })).status, 200);
    });
    await t.test("underage Google sign-in consumes challenge and never creates an account", async () => {
      const b = new Browser(), nonce = await challenge(b), token = await credential(nonce, "age-child");
      const response = await b.request("/auth/google", "POST", { credential: token,
        ageDeclaration: { ...adult, birthDate: new Date().toISOString().slice(0, 10) } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "AGE_INELIGIBLE");
      assert.equal(b.cookies.has("kr_nonce"), false);
      assert.equal(b.cookies.has("kr_access"), false);
      assert.equal((await database().execute(sql`SELECT id FROM users WHERE google_sub='age-child'`)).length, 0);
      b.cookies.set("kr_nonce", nonce);
      assert.equal((await b.request("/auth/google", "POST", { credential: token, ageDeclaration: adult })).status, 401);
    });
    await t.test("guest preview requires age; existing guest may read history and confirm without logout", async () => {
      const b = new Browser();
      for (const [ageDeclaration, expected] of [[undefined, 428], [{ ...adult, confirmed: false }, 428],
        [{ ...adult, birthDate: "2001-02-29" }, 400],
        [{ ...adult, birthDate: new Date().toISOString().slice(0, 10) }, 403]] as const) {
        assert.equal((await b.request("/session", "POST", { code: process.env.DEMO_ACCESS_CODE, ageDeclaration })).status, expected);
        assert.equal(b.cookies.has("lm_session"), false);
      }
      assert.equal((await b.request("/session", "POST", { code: process.env.DEMO_ACCESS_CODE, ageDeclaration: adult })).status, 200);
      assert.equal((await (await b.request("/session")).json()).ageConfirmed, true);
      const legacy = new Browser(), raw = issueSession(), owner = sessionOwner(raw)!;
      legacy.cookies.set("lm_session", raw);
      assert.equal((await legacy.request("/jobs")).status, 200);
      assert.equal((await legacy.request("/jobs", "POST", input())).status, 428);
      assert.equal((await legacy.request("/auth/age", "POST", { ageDeclaration: adult }, process.env.APP_URL!, { "X-KakaReel-Owner": owner })).status, 200);
      assert.equal(legacy.cookies.get("lm_session"), raw);
      assert.equal((await (await legacy.request("/session")).json()).canGenerate, true);
    });
    await t.test("legacy account retains refresh/history but cannot generate until declaring age", async () => {
      const b = new Browser(), s = await login(b, "age-legacy"), owner = s.user.id;
      await database().execute(sql`UPDATE users SET invited_at=now(),age_confirmed_at=NULL,age_policy_version=NULL WHERE id=${owner}::uuid`);
      assert.equal((await b.request("/auth/refresh", "POST")).status, 200);
      const old = await (await b.request("/session")).json();
      assert.equal(old.authenticated, true); assert.equal(old.ageConfirmed, false);
      assert.equal((await b.request("/jobs")).status, 200);
      const callsBefore = providerCalls;
      for (const mode of ["preview", "paid"]) assert.equal((await b.request("/jobs", "POST", { ...input(), billingMode: mode })).status, 428);
      assert.equal(providerCalls, callsBefore);
      assert.equal((await b.request("/auth/age", "POST", { ageDeclaration: adult })).status, 409);
      const headers = { "X-KakaReel-Owner": owner }, before = b.header();
      assert.equal((await b.request("/auth/age", "POST", {}, process.env.APP_URL!, headers)).status, 428);
      assert.equal((await b.request("/auth/age", "POST", { ageDeclaration: adult }, process.env.APP_URL!, headers)).status, 200);
      assert.equal(b.header(), before, "no logout or session cookie replacement");
      assert.equal((await (await b.request("/session")).json()).canGenerate, true);
    });
    await t.test(
      "additive concurrent startup migrations retain legacy jobs and cookies",
      async () => {
        const [legacyAccount] = await database().execute(sql`SELECT age_confirmed_at,age_policy_version FROM users WHERE google_sub='pre-age-migration'`);
        assert.equal(legacyAccount.age_confirmed_at, null);
        assert.equal(legacyAccount.age_policy_version, null);
        const b = new Browser();
        b.cookies.set("lm_session", legacyCookie);
        const r = await b.request("/jobs");
        assert.equal(r.status, 200);
        assert.equal((await r.json()).jobs[0].id, legacyId);
        const versions = await database().execute(
          sql`SELECT count(*)::int AS n FROM schema_migrations`,
        );
        assert.equal(versions[0].n, (await readdir(new URL("../db/", import.meta.url))).filter(f => /^\d{4}-.+\.sql$/.test(f)).length);
        await migrate();
      },
    );
    await t.test(
      "runtime public config is uncached, independent of generation config, and can be disabled",
      async () => {
        const b = new Browser();
        const r = await b.request("/config");
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.deepEqual(await r.json(), {
          googleClientId: process.env.GOOGLE_CLIENT_ID,
        });
        const saved = process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_ID;
        assert.deepEqual(await (await b.request("/config")).json(), {
          googleClientId: null,
        });
        assert.equal((await b.request("/auth/challenge", "POST")).status, 503);
        process.env.GOOGLE_CLIENT_ID = saved;
      },
    );
    await t.test(
      "Origin CSRF checks cover every mutation, including DELETE and missing Origin",
      async () => {
        const b = new Browser();
        for (const [path, method] of [
          ["/session", "POST"],
          ["/session", "DELETE"],
          ["/auth/challenge", "POST"],
          ["/auth/google", "POST"],
          ["/auth/refresh", "POST"],
          ["/jobs", "POST"],
          [`/jobs/${legacyId}/recover`, "POST"],
        ]) {
          for (const origin of ["https://attacker.example", "null", null])
            assert.equal(
              (await b.request(path, method, {}, origin)).status,
              403,
              `${method} ${path}`,
            );
        }
      },
    );
    await t.test("challenge requests reuse a valid cookie without extending its deadline", async () => {
      const b = new Browser();
      const [before] = await database().execute<{ n: number }>(sql`SELECT coalesce(sum(attempts),0)::int AS n FROM auth_attempts`);
      const first = await b.request("/auth/challenge", "POST");
      assert.equal(first.status, 200);
      const initial = await first.json();
      assert.equal(initial.expiresInMs, 600_000);
      assert.equal(b.cookies.get("kr_nonce"), initial.nonce);
      const [stored] = await database().execute<{ expires_at: string }>(sql`SELECT expires_at FROM auth_nonces WHERE nonce_hash=${tokenHash(initial.nonce)}`);
      const started = Date.now();
      const second = await b.request("/auth/challenge", "POST");
      assert.equal(second.status, 200);
      const reused = await second.json();
      const finished = Date.now();
      assert.equal(reused.nonce, initial.nonce);
      assert.ok(Number.isInteger(reused.expiresInMs) && reused.expiresInMs > 0);
      assert.ok(reused.expiresInMs <= Date.parse(stored.expires_at) - started);
      assert.ok(reused.expiresInMs >= Date.parse(stored.expires_at) - finished);
      assert.deepEqual(second.headers.getSetCookie(), [], "reuse must not reset cookie lifetime");
      const [unchanged] = await database().execute<{ expires_at: string }>(sql`SELECT expires_at FROM auth_nonces WHERE nonce_hash=${tokenHash(initial.nonce)}`);
      assert.equal(Date.parse(unchanged.expires_at), Date.parse(stored.expires_at));
      const [after] = await database().execute<{ n: number }>(sql`SELECT coalesce(sum(attempts),0)::int AS n FROM auth_attempts`);
      assert.equal(after.n, before.n + 2, "both new and reused challenges count toward the global limit");
    });
    await t.test("a challenge with less than 60 seconds remaining is reused with its actual lifetime", async () => {
      const b = new Browser();
      const nonce = await challenge(b);
      const deadline = new Date(Date.now() + 30_000);
      await database().execute(sql`UPDATE auth_nonces SET expires_at=${deadline.toISOString()}::timestamptz WHERE nonce_hash=${tokenHash(nonce)}`);
      const started = Date.now();
      const response = await b.request("/auth/challenge", "POST");
      assert.equal(response.status, 200);
      const reused = await response.json();
      const finished = Date.now();
      assert.equal(reused.nonce, nonce, "another tab must not replace a still-valid nonce early");
      assert.ok(Number.isInteger(reused.expiresInMs) && reused.expiresInMs > 0);
      assert.ok(reused.expiresInMs <= deadline.getTime() - started);
      assert.ok(reused.expiresInMs >= deadline.getTime() - finished);
      assert.deepEqual(response.headers.getSetCookie(), []);
      const [stored] = await database().execute<{ expires_at: string }>(sql`SELECT expires_at FROM auth_nonces WHERE nonce_hash=${tokenHash(nonce)}`);
      assert.equal(Date.parse(stored.expires_at), deadline.getTime());
    });
    await t.test("an expired challenge cookie receives a fresh nonce", async () => {
      const b = new Browser();
      const nonce = await challenge(b);
      await database().execute(sql`UPDATE auth_nonces SET expires_at=now()-interval '1 second' WHERE nonce_hash=${tokenHash(nonce)}`);
      const response = await b.request("/auth/challenge", "POST");
      assert.equal(response.status, 200);
      const fresh = await response.json();
      assert.notEqual(fresh.nonce, nonce);
      assert.equal(fresh.expiresInMs, 600_000);
      assert.equal(b.cookies.get("kr_nonce"), fresh.nonce);
      assert.equal((await b.request("/auth/google", "POST", {
        credential: await credential(fresh.nonce, "expired-challenge-replacement"),
    ageDeclaration: adult,
      })).status, 200);
    });
    await t.test("a consumed challenge is not reused even if its old cookie is sent again", async () => {
      const b = new Browser();
      const nonce = await challenge(b);
      assert.equal((await b.request("/auth/google", "POST", {
        credential: await credential(nonce, "consumed-challenge"),
    ageDeclaration: adult,
      })).status, 200);
      const consumed = await database().execute(sql`SELECT nonce_hash FROM auth_nonces WHERE nonce_hash=${tokenHash(nonce)}`);
      assert.equal(consumed.length, 0);
      b.cookies.set("kr_nonce", nonce);
      const response = await b.request("/auth/challenge", "POST");
      assert.equal(response.status, 200);
      const fresh = await response.json();
      assert.notEqual(fresh.nonce, nonce);
      assert.equal(fresh.expiresInMs, 600_000);
      assert.equal(b.cookies.get("kr_nonce"), fresh.nonce);
    });
    await t.test(
      "real verifyIdToken rejects wrong audience/issuer, expired/unverified/bad signature and wrong nonce",
      async () => {
        const b = new Browser(),
          nonce = await challenge(b);
        for (const claims of [
          { aud: "other-client" },
          { iss: "https://attacker.example" },
          { exp: Math.floor(Date.now() / 1000) - 1 },
          { email_verified: false },
          { email_verified: "true" },
          { sub: "" },
          { nonce: "other-nonce" },
        ]) {
          assert.equal(
            (
              await b.request("/auth/google", "POST", {
                credential: await credential(nonce, "invalid-user", claims),
              })
            ).status,
            401,
          );
        }
        const token = await credential(nonce);
        const parts = token.split(".");
        parts[1] = Buffer.from(
          JSON.stringify({
            ...JSON.parse(Buffer.from(parts[1], "base64url").toString()),
            sub: "tampered",
          }),
        ).toString("base64url");
        assert.equal(
          (
            await b.request("/auth/google", "POST", {
              credential: parts.join("."),
            })
          ).status,
          401,
        );
        const other = new Browser();
        assert.equal(
          (await other.request("/auth/google", "POST", { credential: token }))
            .status,
          401,
        );
        await database().execute(
          sql`UPDATE auth_nonces SET expires_at=now()-interval '1 second' WHERE nonce_hash=${tokenHash(nonce)}`,
        );
        assert.equal(
          (await b.request("/auth/google", "POST", { credential: token }))
            .status,
          401,
        );
      },
    );
    await t.test(
      "single-use nonce cannot be replayed, including simultaneous callbacks",
      async () => {
        const a = new Browser(),
          nonce = await challenge(a),
          b = a.clone();
        const body = { credential: await credential(nonce, "nonce-user"), ageDeclaration: adult };
        const replies = await Promise.all([
          a.request("/auth/google", "POST", body),
          b.request("/auth/google", "POST", body),
        ]);
        assert.deepEqual(replies.map((r) => r.status).sort(), [200, 401]);
        b.cookies.set("kr_nonce", nonce);
        assert.equal(
          (await b.request("/auth/google", "POST", body)).status,
          401,
        );
      },
    );
    const alice = new Browser(),
      bob = new Browser();
    let aliceId = "";
    await t.test(
      "returning sub retains ID across email changes; matching emails never merge subjects",
      async () => {
        const first = await login(alice);
        aliceId = first.user.id;
        assert.equal(first.canGenerate, false);
        const second = await login(new Browser(), "google-alice", {
          email: "changed@example.com",
        });
        assert.equal(second.user.id, aliceId);
        const other = await login(bob, "google-bob", {
          email: "changed@example.com",
        });
        assert.notEqual(other.user.id, aliceId);
        const copies = await Promise.all([
          login(new Browser(), "simultaneous"),
          login(new Browser(), "simultaneous"),
        ]);
        assert.equal(copies[0].user.id, copies[1].user.id);
      },
    );
    await t.test(
      "Google account cannot submit without invitation; recovery only queries its own task",
      async () => {
        const before = providerCalls;
        assert.equal(
          (await alice.request("/jobs", "POST", input())).status,
          403,
        );
        const recovery = await seedJob(aliceId, randomUUID(), "unknown");
        assert.equal(
          (await alice.request(`/jobs/${recovery}/recover`, "POST")).status,
          200,
        );
        assert.equal(providerCalls, before);
        assert.equal(
          (await alice.request("/session", "POST", { code: "invalid" })).status,
          401,
        );
        assert.equal(
          (
            await alice.request("/session", "POST", {
              code: process.env.DEMO_ACCESS_CODE,
            })
          ).status,
          200,
        );
        assert.equal(
          (await (await alice.request("/session")).json()).canGenerate,
          true,
        );
        assert.equal(
          (await (await bob.request("/session")).json()).canGenerate,
          false,
        );
        const r = await alice.request("/jobs", "POST", input());
        assert.equal(r.status, 201);
        assert.equal(providerCalls, before + 1);
        assert.equal((await bob.request(`/jobs/${recovery}`)).status, 404);
        assert.deepEqual((await (await bob.request("/jobs")).json()).jobs, []);
      },
    );
    await t.test("stale-tab owner binding prevents paid creation and recovery under replacement cookies", async () => {
      const otherId = (await (await bob.request("/session")).json()).user.id;
      const before = providerCalls;
      const headers = { "X-KakaReel-Owner": otherId };
      assert.equal((await alice.request("/jobs", "POST", input(), process.env.APP_URL!, headers)).status, 409);
      const id = await seedJob(aliceId, randomUUID(), "unknown");
      assert.equal((await alice.request(`/jobs/${id}/recover`, "POST", undefined, process.env.APP_URL!, headers)).status, 409);
      assert.equal(providerCalls, before);
    });
    await t.test(
      "verified guest cookie adopts history and invite once; replay cannot leak across accounts",
      async () => {
        const guest = new Browser();
        guest.cookies.set("lm_session", legacyCookie);
        const owner = await login(guest, "legacy-adopter");
        assert.equal(owner.canGenerate, true);
        assert.ok(!guest.cookies.has("lm_session"));
        assert.equal(
          (await (await guest.request("/jobs")).json()).jobs[0].id,
          legacyId,
        );
        const stolen = new Browser();
        stolen.cookies.set("lm_session", legacyCookie);
        assert.equal((await stolen.request("/jobs")).status, 401);
        assert.equal(
          (await stolen.request("/jobs", "POST", input())).status,
          401,
        );
        const other = await login(stolen, "other-adopter");
        assert.equal(other.canGenerate, false);
        assert.equal((await stolen.request(`/jobs/${legacyId}`)).status, 404);
        await guest.request("/session", "DELETE");
        const returning = await login(guest, "legacy-adopter");
        assert.equal(returning.user.id, owner.user.id);
        assert.equal((await guest.request(`/jobs/${legacyId}`)).status, 200);
      },
    );
    await t.test(
      "unsigned, tampered and revoked guest cookies cannot confer invitation or adopt jobs",
      async () => {
        const raw = issueSession(),
          guestId = sessionOwner(raw)!;
        const jobId = await seedJob(guestId);
        for (const invalid of [
          guestId,
          `${raw.slice(0, -1)}${raw.endsWith("0") ? "1" : "0"}`,
        ]) {
          const b = new Browser();
          b.cookies.set("lm_session", invalid);
          const s = await login(b, randomUUID());
          assert.equal(s.canGenerate, false);
          assert.equal((await b.request(`/jobs/${jobId}`)).status, 404);
        }
        const guest = new Browser();
        guest.cookies.set("lm_session", raw);
        assert.equal((await guest.request("/session", "DELETE")).status, 200);
        guest.cookies.set("lm_session", raw);
        assert.equal((await guest.request("/jobs")).status, 401);
        assert.equal((await login(guest, "ended-guest")).canGenerate, false);
      },
    );
    await t.test(
      "concurrent guest claims grant history and permission to exactly one account",
      async () => {
        const raw = issueSession(),
          jobId = await seedJob(sessionOwner(raw)!);
        const a = new Browser(),
          b = new Browser();
        a.cookies.set("lm_session", raw);
        b.cookies.set("lm_session", raw);
        const sessions = await Promise.all([
          login(a, "claim-a"),
          login(b, "claim-b"),
        ]);
        assert.deepEqual(sessions.map((s) => s.canGenerate).sort(), [
          false,
          true,
        ]);
        assert.deepEqual(
          (
            await Promise.all([
              a.request(`/jobs/${jobId}`),
              b.request(`/jobs/${jobId}`),
            ])
          )
            .map((r) => r.status)
            .sort(),
          [200, 404],
        );
      },
    );
    for (const operation of ["create", "recover"] as const) {
      await t.test(`guest adoption preserves an in-flight ${operation} and its idempotency key`, async () => {
        const guest = new Browser();
        const raw = issueSession();
        await database().execute(sql`INSERT INTO guest_age_declarations(guest_id,age_confirmed_at,age_policy_version) VALUES(${sessionOwner(raw)!}::uuid,now(),${AGE_POLICY_VERSION})`);
        guest.cookies.set("lm_session", raw);
        const replay = guest.clone();
        const request = input();
        const provider = global.fetch;
        if (operation === "recover") {
          global.fetch = async () => { throw new Error("Simulated lost provider response"); };
          try {
            const unknown = await guest.request("/jobs", "POST", request);
            assert.equal((await unknown.json()).job.status, "unknown");
          } finally { global.fetch = provider; }
        }
        let release!: () => void, reached!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { reached = resolve; });
        global.fetch = async (url, init) => {
          reached();
          await waiting;
          return provider(url, init);
        };
        const pending = guest.request(
          operation === "create" ? "/jobs" : `/jobs/${request.requestId}/recover`,
          "POST", operation === "create" ? request : undefined,
        );
        try {
          await started; // The reservation committed; the provider response has not returned.
          const session = await login(guest, `inflight-${operation}`);
          assert.equal(session.canGenerate, true);
          release();
          assert.equal((await pending).status, operation === "create" ? 201 : 200);
          const count = providerCalls;
          assert.equal((await guest.request("/jobs", "POST", request)).status, 200);
          assert.equal(providerCalls, count, "adopted request ID must not submit a second video");
          assert.equal((await replay.request("/jobs", "POST", input())).status, 401);
          const rows = await database().execute(sql`SELECT owner FROM video_jobs WHERE id=${request.requestId}::uuid`);
          assert.equal(rows[0].owner, session.user.id, "late provider response must not restore guest ownership");
          assert.equal((await (await guest.request("/jobs")).json()).jobs.length, 1);
        } finally {
          release();
          await pending;
          global.fetch = provider;
        }
      });
    }
    await t.test(
      "HttpOnly cookies, hashed refresh tokens, reload/rotation, replay and logout revoke access immediately",
      async () => {
        const b = new Browser(),
          nonce = await challenge(b);
        const priorNodeEnv = process.env.NODE_ENV;
        Object.assign(process.env, { NODE_ENV: "production" });
        let r: Response;
        try {
          r = await b.request("/auth/google", "POST", {
            credential: await credential(nonce, "rotation-user"),
    ageDeclaration: adult,
          });
        } finally {
          if (priorNodeEnv === undefined)
            delete (process.env as Record<string, string | undefined>).NODE_ENV;
          else Object.assign(process.env, { NODE_ENV: priorNodeEnv });
        }
        const cookies = r.headers
          .getSetCookie()
          .filter(
            (c) => c.startsWith("kr_access=") || c.startsWith("kr_refresh="),
          );
        assert.equal(cookies.length, 2);
        assert.ok(
          cookies.every(
            (c) =>
              /HttpOnly/i.test(c) &&
              /SameSite=Lax/i.test(c) &&
              /Secure/i.test(c),
          ),
        );
        const raw = b.cookies.get("kr_refresh")!;
        const tokens = await database().execute(
          sql`SELECT token_hash FROM refresh_tokens WHERE token_hash=${tokenHash(raw)}`,
        );
        assert.equal(tokens.length, 1);
        assert.notEqual(tokens[0].token_hash, raw);
        const old = b.clone();
        b.cookies.delete("kr_access"); // Browser after access cookie expiry, with refresh still present.
        assert.equal((await b.request("/session")).status, 401);
        assert.equal((await b.request("/auth/refresh", "POST")).status, 200);
        assert.notEqual(b.cookies.get("kr_refresh"), raw);
        assert.equal((await b.request("/session")).status, 200);
        assert.equal((await old.request("/auth/refresh", "POST")).status, 401);
        assert.equal(
          (await b.request("/jobs")).status,
          401,
          "reuse revokes even the newest access token",
        );
        await login(b, "rotation-user");
        const snapshot = b.clone();
        assert.equal((await b.request("/session", "DELETE")).status, 200);
        assert.equal((await snapshot.request("/jobs")).status, 401);
        assert.equal(
          (await snapshot.request("/auth/refresh", "POST")).status,
          401,
        );
        assert.equal(b.cookies.has("kr_refresh"), false);
      },
    );
    await t.test(
      "concurrent refresh permits one rotation and revokes the replayed session family",
      async () => {
        const a = new Browser();
        await login(a, "parallel-refresh");
        const b = a.clone();
        const r = await Promise.all([
          a.request("/auth/refresh", "POST"),
          b.request("/auth/refresh", "POST"),
        ]);
        assert.deepEqual(r.map((x) => x.status).sort(), [200, 401]);
        const winner = r[0].status === 200 ? a : b;
        assert.equal((await winner.request("/jobs")).status, 401);
      },
    );
    await t.test("expired refresh sessions are rejected", async () => {
      const b = new Browser();
      await login(b, "expired-refresh");
      const raw = b.cookies.get("kr_refresh")!;
      await database()
        .execute(sql`UPDATE auth_sessions SET expires_at=now()-interval '1 second'
      WHERE id=(SELECT session_id FROM refresh_tokens WHERE token_hash=${tokenHash(raw)})`);
      assert.equal((await b.request("/auth/refresh", "POST")).status, 401);
    });
  },
);
