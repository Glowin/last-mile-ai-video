import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { database } from "../db";
import { cookieOptions } from "../account";
import { analyticsBrowserConsents } from "./schema";
import { eq } from "drizzle-orm";
import { ANALYTICS_CONSENT_COOKIE } from "./checkout";

// This HttpOnly browser capability is independent of account access/refresh
// tokens. Revocation therefore also works after logout or access-token expiry.
// Origin validation is enforced by the parent app for both mutations.
export const analyticsRoutes = new Hono();
const options = () => ({ ...cookieOptions("/api"), maxAge: 90 * 86400 });
analyticsRoutes.post("/consent", async (c) => {
  if (!process.env.DATABASE_URL) return c.json({ error: "Analytics unavailable." }, 503);
  const prior = z.uuid().safeParse(getCookie(c, ANALYTICS_CONSENT_COOKIE));
  const id = prior.success ? prior.data : randomUUID();
  await database().insert(analyticsBrowserConsents).values({ id }).onConflictDoUpdate({ target: analyticsBrowserConsents.id, set: { createdAt: new Date() } });
  setCookie(c, ANALYTICS_CONSENT_COOKIE, id, options());
  return c.json({ ok: true });
});
analyticsRoutes.delete("/consent", async (c) => {
  if (!process.env.DATABASE_URL) return c.json({ error: "Analytics unavailable." }, 503);
  const prior = z.uuid().safeParse(getCookie(c, ANALYTICS_CONSENT_COOKIE));
  if (prior.success) await database().delete(analyticsBrowserConsents).where(eq(analyticsBrowserConsents.id, prior.data));
  // Cascade erases this browser's unsent order IDs, not another browser's consent.
  deleteCookie(c, ANALYTICS_CONSENT_COOKIE, cookieOptions("/api"));
  return c.json({ ok: true });
});
