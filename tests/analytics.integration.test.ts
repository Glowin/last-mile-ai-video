import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";
import { eq, sql } from "drizzle-orm";
import { database, closeDatabase } from "../src/server/db";
import { users, jobs } from "../src/server/schema";
import { billingOrders } from "../src/server/billing/schema";
import { userAttribution, analyticsBrowserConsents, analyticsOrderContexts, analyticsPurchaseEvents } from "../src/server/analytics/schema";
import { bindOrderAnalytics, ANALYTICS_CONSENT_COOKIE } from "../src/server/analytics/checkout";
import { dispatchPaidPurchases } from "../src/server/analytics/purchases";
import { createApp } from "../src/server/app";
const AGE_POLICY_VERSION = "18-plus-2026-10-26"; // Historical migration fixture only.
import { buildFirstTouch, serializeFirstTouch } from "../src/lib/attribution";
import { attributionReport } from "../scripts/attribution-report";

// Runs against the disposable credit QA database only (see docs/deployment.md).
const url = process.env.CREDIT_TEST_DATABASE_URL;
const integration = !!url;
const opts = { skip: !integration };
const saved = { ...process.env };
const originalFetch = global.fetch;
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const adult = { birthDate: "1990-01-01", confirmed: true, policyVersion: AGE_POLICY_VERSION };
const app = createApp({ videoProvider: { kind: "fake", request: async () => ({ id: "fake", status: "pending" }), verifyDelivery: async () => true } });
const config = { measurementId: "G-TEST123", apiSecret: "fictional-test-secret", debugMode: false };

before(() => {
  if (!integration) return;
  const u = new URL(url!);
  assert.equal(u.hostname, "127.0.0.1"); assert.equal(u.port, "55439"); assert.equal(u.pathname, "/video_credit_qa");
  process.env.DATABASE_URL = url;
  process.env.APP_URL = "https://analytics-test.example";
  process.env.SESSION_SECRET = "fictional-test-only-session-secret-for-analytics-qa";
  process.env.GOOGLE_CLIENT_ID = "analytics-test-client.apps.googleusercontent.com";
  delete process.env.GA_API_SECRET;
  global.fetch = async () => { throw new Error("Real network prohibited in analytics tests"); };
  mock.method(OAuth2Client.prototype, "getFederatedSignonCertsAsync", async () => ({
    certs: { "test-only-key": key.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM",
  }));
});
after(async () => {
  mock.restoreAll();
  global.fetch = originalFetch;
  await closeDatabase();
  for (const k of ["DATABASE_URL", "APP_URL", "SESSION_SECRET", "GOOGLE_CLIENT_ID", "GA_API_SECRET"])
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

class Browser {
  cookies = new Map<string, string>();
  async request(path: string, method = "GET", body?: unknown) {
    const r = await app.request(`http://localhost/api${path}`, {
      method, headers: { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "Content-Type": "application/json", origin: process.env.APP_URL! },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const [name, ...rest] = cookie.split(";")[0].split("=");
      const value = rest.join("=");
      if (!value || cookie.includes("Max-Age=0")) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return r;
  }
  async signIn(sub: string) {
    const { nonce } = await (await this.request("/auth/challenge", "POST")).json();
    const now = Math.floor(Date.now() / 1000);
    const credential = await new SignJWT({ sub, aud: process.env.GOOGLE_CLIENT_ID, iss: "https://accounts.google.com", iat: now, exp: now + 3600,
      email: `${sub}@example.test`, email_verified: true, name: "QA", nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test-only-key" }).sign(key.privateKey);
    const r = await this.request("/auth/google", "POST", { credential, ageDeclaration: adult });
    assert.equal(r.status, 200);
    return r.json() as Promise<{ userId: string; newUser: boolean }>;
  }
}

async function paidOrder(userId: string, environment: "live" | "test" = "live", extra: Partial<typeof billingOrders.$inferInsert> = {}) {
  const id = randomUUID();
  await database().insert(billingOrders).values({ id, userId, requestId: randomUUID(), productId: "credits-starter", productName: "Starter Pack",
    priceVersion: "qa", provider: "pancake", environment, merchantAccountId: "qa-only", providerProductId: "qa-only", amountMinor: 1900,
    subtotalMinor: 1900, taxMinor: 0, currency: "USD", credits: 150, status: "paid", paidAt: new Date(), ...extra });
  return id;
}

async function attachContext(orderId: string, consentId: string) {
  await database().transaction(tx => bindOrderAnalytics(tx, orderId, {
    consentId, clientId: "1111.2222", sessionId: String(Math.floor(Date.now() / 1000) - 60),
  }));
  // Fixture orders are already paid; make their synthetic checkout precede payment.
  await database().update(analyticsOrderContexts).set({ capturedAt: new Date(Date.now() - 1000) })
    .where(eq(analyticsOrderContexts.orderId, orderId));
}

test("sign-up stores first touch once; GA client ID follows consent", opts, async () => {
  const b = new Browser(), sub = `qa-attr-${randomUUID()}`;
  b.cookies.set("kr_ft", serializeFirstTouch(buildFirstTouch("https://kakareel.com/pricing?utm_source=QA-News&utm_medium=email&utm_campaign=oct&gclid=SECRET", "")!));
  const first = await b.signIn(sub);
  assert.equal(first.newUser, true);
  const [row] = await database().select().from(userAttribution).where(eq(userAttribution.userId, first.userId));
  assert.equal(row.utmSource, "qa-news"); assert.equal(row.utmMedium, "email"); assert.equal(row.utmCampaign, "oct");
  assert.equal(row.landingPath, "/pricing"); assert.equal(row.clickIdType, "gclid");
  assert.ok(!JSON.stringify(row).includes("SECRET"));
  // A returning login never reports sign_up and never overwrites the first touch.
  const again = new Browser();
  again.cookies.set("kr_ft", serializeFirstTouch(buildFirstTouch("https://kakareel.com/?utm_source=other", "")!));
  const second = await again.signIn(sub);
  assert.equal(second.newUser, false);
  const [kept] = await database().select().from(userAttribution).where(eq(userAttribution.userId, first.userId));
  assert.equal(kept.utmSource, "qa-news");
  // Corrupt cookie: sign-up still succeeds and records a direct row.
  const c = new Browser(); c.cookies.set("kr_ft", "%7Bbroken");
  const third = await c.signIn(`qa-attr-${randomUUID()}`);
  const [direct] = await database().select().from(userAttribution).where(eq(userAttribution.userId, third.userId));
  assert.equal(direct.utmSource, null); assert.equal(direct.landingPath, "/");

  // Revocation is a browser capability, independent of account access expiry.
  assert.equal((await b.request("/analytics/consent", "POST")).status, 200);
  const consentId = b.cookies.get(ANALYTICS_CONSENT_COOKIE)!;
  assert.ok(consentId);
  const trackedOrder = await paidOrder(first.userId);
  await attachContext(trackedOrder, consentId);
  b.cookies.set("kr_access", "expired-access-token");
  assert.equal((await b.request("/analytics/consent", "DELETE")).status, 200);
  assert.equal((await database().select().from(analyticsBrowserConsents).where(eq(analyticsBrowserConsents.id, consentId))).length, 0);
  assert.equal((await database().select().from(analyticsOrderContexts).where(eq(analyticsOrderContexts.orderId, trackedOrder))).length, 0);
  assert.equal(b.cookies.has(ANALYTICS_CONSENT_COOKIE), false);
  assert.equal((await new Browser().request("/analytics/consent", "DELETE")).status, 200);
});

test("purchase is sent exactly once per paid live order, only with a consented GA client", opts, async () => {
  const b = new Browser();
  const { userId } = await b.signIn(`qa-buy-${randomUUID()}`);
  const { userId: noConsent } = await new Browser().signIn(`qa-buy-${randomUUID()}`);
  const consentId = randomUUID();
  await database().insert(analyticsBrowserConsents).values({ id: consentId });
  const order = await paidOrder(userId);
  await attachContext(order, consentId);
  const testOrder = await paidOrder(userId, "test");
  const pending = await paidOrder(userId, "live", { status: "pending", paidAt: null });
  const reviewed = await paidOrder(userId, "live", { reviewReason: "qa" });
  const silent = await paidOrder(noConsent);
  const otherBrowser = await paidOrder(userId); // Same account, no checkout consent.
  const revoked = await paidOrder(userId);
  const revokedId = randomUUID();
  await database().insert(analyticsBrowserConsents).values({ id: revokedId });
  await attachContext(revoked, revokedId);
  await database().delete(analyticsBrowserConsents).where(eq(analyticsBrowserConsents.id, revokedId));
  const bodies: string[] = [];
  const fetchImpl = (async (_u: URL, init: RequestInit) => { bodies.push(String(init.body)); return new Response(null, { status: 204 }); }) as typeof fetch;
  const runs = await Promise.all([dispatchPaidPurchases({ config, fetchImpl, limit: 1000 }), dispatchPaidPurchases({ config, fetchImpl, limit: 1000 })]);
  await dispatchPaidPurchases({ config, fetchImpl, limit: 1000 });
  const mine = bodies.filter((x) => x.includes(order));
  assert.equal(mine.length, 1, JSON.stringify(runs));
  const sent = JSON.parse(mine[0]);
  assert.equal(sent.client_id, "1111.2222");
  assert.equal(sent.events[0].params.transaction_id, order);
  assert.equal(sent.events[0].params.value, 19);
  assert.ok(sent.events[0].params.session_id > 0);
  for (const other of [testOrder, pending, reviewed, silent, otherBrowser, revoked]) assert.ok(!bodies.some((x) => x.includes(other)));
  const states = Object.fromEntries((await database().select().from(analyticsPurchaseEvents)).map((r) => [r.orderId, r.status]));
  assert.equal(states[order], "sent");
  assert.equal(states[silent], "skipped_no_consent");
  assert.equal(states[testOrder], undefined);

  // A GA outage is retried on the next trigger, and still only one success is recorded.
  const retry = await paidOrder(userId);
  await attachContext(retry, consentId);
  let fail = true;
  const flaky = (async (_u: URL, init: RequestInit) => { if (String(init.body).includes(retry) && fail) { fail = false; return new Response(null, { status: 500 }); } bodies.push(String(init.body)); return new Response(null, { status: 204 }); }) as typeof fetch;
  await dispatchPaidPurchases({ config, fetchImpl: flaky, limit: 1000 });
  const [failed] = await database().select().from(analyticsPurchaseEvents).where(eq(analyticsPurchaseEvents.orderId, retry));
  assert.equal(failed.status, "failed");
  await dispatchPaidPurchases({ config, fetchImpl: flaky, limit: 1000 });
  await dispatchPaidPurchases({ config, fetchImpl: flaky, limit: 1000 });
  assert.equal(bodies.filter((x) => x.includes(retry)).length, 1);
});

test("operator report groups signups, generations and revenue by first-touch channel", opts, async () => {
  const campaign = `qa${randomUUID().slice(0, 8)}`;
  const b = new Browser();
  b.cookies.set("kr_ft", serializeFirstTouch(buildFirstTouch(`https://kakareel.com/?utm_source=qa-report&utm_medium=cpc&utm_campaign=${campaign}`, "")!));
  const { userId } = await b.signIn(`qa-rep-${randomUUID()}`);
  await database().insert(jobs).values({ id: randomUUID(), owner: userId, family: "seedance", mode: "text", prompt: "qa", duration: 5, resolution: "720p",
    fingerprint: "qa", payload: { model: "qa" }, status: "success" });
  await paidOrder(userId);
  await paidOrder(userId, "live", { status: "refunded" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const rows = await attributionReport({ from: today, to: today, tz: "Asia/Shanghai", group: "campaign", environment: "live", json: true });
  const row = rows.find((r) => r.campaign === campaign);
  assert.deepEqual(row && { ...row }, { source: "qa-report", medium: "cpc", campaign, signups: 1, generations: 1, paid_generations: 0,
    paid_orders: 1, refunded_orders: 1, revenue_minor: 1900, currency: "USD" });
  // The report runs read-only.
  await assert.rejects(database().transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION READ ONLY`); await tx.execute(sql`DELETE FROM user_attribution WHERE false`); }));
});
