import { Hono, type MiddlewareHandler } from "hono";
import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { database } from "./db";
import { authSessions } from "./schema";
import { hasAccountCookies, identity, publicUser, type Identity } from "./account";

type AccountEnv = { Variables: { account: Identity } };
export const accountRoutes = new Hono<AccountEnv>();

const requireAccount: MiddlewareHandler<AccountEnv> = async (c, next) => {
  const who = await identity(c);
  if (!who?.user || !who.sessionId)
    return c.json({
      error: "Sign in with Google to manage your account.",
      ...(!who && hasAccountCookies(c) ? { code: "SESSION_EXPIRED" } : {}),
    }, 401);
  const expected = c.req.header("X-KakaReel-Owner");
  // Mutations must be bound to the account displayed by the initiating tab.
  if ((c.req.method !== "GET" || expected) && expected !== who.owner)
    return c.json({ error: "Your account changed. Refresh before managing sessions." }, 409);
  c.set("account", who);
  await next();
};

// Mount under /api after app's no-store and CSRF middleware. Scope middleware
// to account paths so mounting this router cannot change public/auth endpoints.
accountRoutes.use("/account", requireAccount);
accountRoutes.use("/account/*", requireAccount);
accountRoutes.get("/account", async (c) => {
  const who = c.get("account");
  const sessions = await database().select({
    id: authSessions.id,
    expiresAt: authSessions.expiresAt,
  }).from(authSessions).where(and(
    eq(authSessions.userId, who.owner),
    isNull(authSessions.revokedAt),
    gt(authSessions.expiresAt, new Date()),
  )).orderBy(asc(authSessions.id));
  return c.json({
    user: { ...publicUser(who.user!), createdAt: who.user!.createdAt.toISOString() },
    canGenerate: who.canGenerate,
    sessions: sessions.map((session) => ({
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === who.sessionId,
    })),
  });
});

accountRoutes.delete("/account/sessions/others", async (c) => {
  const who = c.get("account");
  const revoked = await database().transaction(async (tx) => {
    // Lock in a stable order, including the current session, to serialize with
    // refresh/logout and simultaneous "sign out others" from another device.
    const sessions = await tx.select({
      id: authSessions.id,
      revokedAt: authSessions.revokedAt,
      expiresAt: authSessions.expiresAt,
    }).from(authSessions).where(eq(authSessions.userId, who.owner))
      .orderBy(asc(authSessions.id)).for("update");
    const current = sessions.find((session) => session.id === who.sessionId);
    if (!current || current.revokedAt || current.expiresAt <= new Date()) return null;
    const rows = await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(
      eq(authSessions.userId, who.owner),
      ne(authSessions.id, who.sessionId!),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date()),
    )).returning({ id: authSessions.id });
    return rows.length;
  });
  if (revoked === null)
    return c.json({ error: "Your session has ended. Please sign in again.", code: "SESSION_EXPIRED" }, 401);
  return c.json({ ok: true, revoked });
});
