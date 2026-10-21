import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "./db";
import { authNonces, users, guestClaims, jobs } from "./schema";
import { configured, issueSession, secureEqual, sessionOwner } from "./auth";
import {
  authConfigured,
  clearLogin,
  cookieOptions,
  createLogin,
  guestIdentity,
  hasAccountCookies,
  identity,
  lockGuest,
  publicUser,
  randomToken,
  revokeLogin,
  rotate,
  setLogin,
  tokenHash,
  verifyGoogle,
} from "./account";

export const authRoutes = new Hono();
authRoutes.get("/config", (c) =>
  c.json({
    googleClientId: authConfigured()
      ? process.env.GOOGLE_CLIENT_ID!.trim()
      : null,
  }),
);
authRoutes.get("/session", async (c) => {
  const who = await identity(c);
  if (!who && hasAccountCookies(c))
    return c.json(
      { error: "Your session needs refreshing.", code: "SESSION_EXPIRED" },
      401,
    );
  return c.json({
    authenticated: !!who,
    owner: who?.owner ?? null,
    user: who?.user ? publicUser(who.user) : null,
    canGenerate: who?.canGenerate ?? false,
    ready: configured(),
    mode: "invite-preview",
  });
});
// Browser callback flow: a same-origin POST issues a random, single-use nonce,
// bound to an HttpOnly cookie and the signed Google ID token. No redirect endpoint.
authRoutes.post("/auth/challenge", async (c) => {
  if (!authConfigured())
    return c.json(
      {
        error:
          "Google sign-in is not configured yet. Preview codes still work.",
      },
      503,
    );
  const attempts = await database()
    .execute(sql`INSERT INTO auth_attempts(minute,attempts)
    VALUES(date_trunc('minute',now()),1) ON CONFLICT(minute)
    DO UPDATE SET attempts=auth_attempts.attempts+1 RETURNING attempts`);
  if (Number(attempts[0]?.attempts) > 120)
    return c.json(
      { error: "Too many sign-in attempts. Try again in a minute." },
      429,
    );
  const nonce = randomToken();
  await database()
    .delete(authNonces)
    .where(lt(authNonces.expiresAt, new Date()));
  await database()
    .insert(authNonces)
    .values({
      nonceHash: tokenHash(nonce),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  setCookie(c, "kr_nonce", nonce, {
    ...cookieOptions("/api/auth"),
    maxAge: 600,
  });
  return c.json({ nonce });
});
authRoutes.post("/auth/google", async (c) => {
  if (!authConfigured())
    return c.json({ error: "Google sign-in is not configured yet." }, 503);
  const input = await c.req.json().catch(() => null);
  const nonce = getCookie(c, "kr_nonce");
  if (
    !nonce ||
    nonce.length > 100 ||
    typeof input?.credential !== "string" ||
    input.credential.length > 16_384
  )
    return c.json({ error: "Start Google sign-in again." }, 401);
  const [challenge] = await database()
    .select()
    .from(authNonces)
    .where(
      and(
        eq(authNonces.nonceHash, tokenHash(nonce)),
        gt(authNonces.expiresAt, new Date()),
      ),
    );
  if (!challenge)
    return c.json(
      { error: "Sign-in expired or was already used. Try again." },
      401,
    );
  let profile;
  try {
    profile = await verifyGoogle(input.credential, nonce);
  } catch {
    return c.json(
      { error: "Google could not verify this sign-in. Please try again." },
      401,
    );
  }
  const guest = sessionOwner(getCookie(c, "lm_session"));
  const result = await database().transaction(async (tx) => {
    const [consumed] = await tx
      .delete(authNonces)
      .where(
        and(
          eq(authNonces.nonceHash, tokenHash(nonce)),
          gt(authNonces.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!consumed) return null;
    // Identity is the Google subject, never the mutable/reassignable email address.
    const [user] = await tx
      .insert(users)
      .values({
        id: randomUUID(),
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { email: profile.email, name: profile.name },
      })
      .returning();
    let claimedGuestId: string | null = null;
    if (guest && (await lockGuest(tx, guest))) {
      claimedGuestId = guest;
      await tx.insert(guestClaims).values({ guestId: guest, userId: user.id });
      await tx
        .update(jobs)
        .set({ owner: user.id })
        .where(eq(jobs.owner, guest));
      await tx
        .update(users)
        .set({ invitedAt: user.invitedAt ?? new Date() })
        .where(eq(users.id, user.id));
    }
    await revokeLogin(c, tx);
    return { ...(await createLogin(tx, user.id)), claimedGuestId };
  });
  if (!result)
    return c.json(
      { error: "This sign-in was already used. Start again." },
      401,
    );
  await setLogin(c, result);
  deleteCookie(c, "lm_session", cookieOptions());
  deleteCookie(c, "kr_nonce", cookieOptions("/api/auth"));
  return c.json({ ok: true, userId: result.userId, claimedGuestId: result.claimedGuestId });
});
authRoutes.post("/auth/refresh", async (c) => {
  const login = await rotate(c);
  if (!login) {
    clearLogin(c);
    return c.json(
      { error: "Your session has ended. Please sign in again." },
      401,
    );
  }
  await setLogin(c, login);
  return c.json({ ok: true });
});
authRoutes.post("/session", async (c) => {
  if (!configured())
    return c.json({ error: "Preview access is not configured yet." }, 503);
  const who = await identity(c);
  if (!who && hasAccountCookies(c))
    return c.json(
      {
        error: "Please refresh your account session.",
        code: "SESSION_EXPIRED",
      },
      401,
    );
  const attempts = await database()
    .execute(sql`INSERT INTO demo_login_attempts(minute,attempts)
    VALUES(date_trunc('minute',now()),1) ON CONFLICT(minute)
    DO UPDATE SET attempts=demo_login_attempts.attempts+1 RETURNING attempts`);
  if (Number(attempts[0]?.attempts) > 30)
    return c.json(
      { error: "Too many access attempts. Please wait one minute." },
      429,
    );
  const input = await c.req.json().catch(() => null);
  if (
    typeof input?.code !== "string" ||
    input.code.length > 200 ||
    !secureEqual(input.code, process.env.DEMO_ACCESS_CODE!)
  )
    return c.json({ error: "That preview code did not work." }, 401);
  if (who?.user) {
    await database()
      .update(users)
      .set({ invitedAt: who.user.invitedAt ?? new Date() })
      .where(eq(users.id, who.user.id));
  } else {
    const old = getCookie(c, "lm_session");
    const existing = await guestIdentity(old);
    setCookie(c, "lm_session", existing ? old! : issueSession(), {
      ...cookieOptions(),
      maxAge: 30 * 86400,
    });
  }
  return c.json({ ok: true });
});
authRoutes.delete("/session", async (c) => {
  const expectedOwner = c.req.header("X-KakaReel-Owner");
  if (expectedOwner !== undefined) {
    const who = await identity(c);
    // Let the existing client refresh an expired access cookie before comparing.
    if (!who && hasAccountCookies(c))
      return c.json(
        { error: "Please refresh your account session.", code: "SESSION_EXPIRED" },
        401,
      );
    if (expectedOwner !== who?.owner)
      return c.json(
        { error: "Your account changed. Refresh before signing out." },
        409,
      );
  }
  const guest = sessionOwner(getCookie(c, "lm_session"));
  await database().transaction(async (tx) => {
    await revokeLogin(c, tx);
    if (guest && (await lockGuest(tx, guest)))
      await tx.insert(guestClaims).values({ guestId: guest });
  });
  clearLogin(c);
  return c.json({ ok: true });
});
