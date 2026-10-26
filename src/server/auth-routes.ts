import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "./db";
import { authNonces, users, guestClaims, guestAgeDeclarations, jobs } from "./schema";
import { AGE_POLICY_VERSION, validateAgeDeclaration } from "../lib/age-declaration";
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
    ageConfirmed: who?.ageConfirmed ?? false,
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
  // Tabs share this cookie. Reuse its unconsumed challenge until expiry so
  // opening another page cannot invalidate an outstanding Google credential.
  // Keep this after the rate limit; reuse is still a challenge request.
  const existingNonce = getCookie(c, "kr_nonce");
  if (existingNonce && existingNonce.length <= 100) {
    const [existing] = await database()
      .select()
      .from(authNonces)
      .where(eq(authNonces.nonceHash, tokenHash(existingNonce)));
    const expiresInMs = existing
      ? Math.floor(existing.expiresAt.getTime() - Date.now())
      : 0;
    if (expiresInMs > 0) {
      // Do not extend either the database deadline or the browser cookie.
      return c.json({ nonce: existingNonce, expiresInMs });
    }
  }
  const nonce = randomToken();
  const expiresInMs = 10 * 60_000;
  await database()
    .delete(authNonces)
    .where(lt(authNonces.expiresAt, new Date()));
  await database()
    .insert(authNonces)
    .values({
      nonceHash: tokenHash(nonce),
      expiresAt: new Date(Date.now() + expiresInMs),
    });
  setCookie(c, "kr_nonce", nonce, {
    ...cookieOptions("/api/auth"),
    maxAge: 600,
  });
  return c.json({ nonce, expiresInMs });
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
    // Serialize first registration and age confirmation for the same Google subject.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"age:" + profile.sub}, 0))`);
    const [existing] = await tx.select().from(users).where(eq(users.googleSub, profile.sub));
    const needsAge = !existing?.ageConfirmedAt;
    const ageError = needsAge || input.ageDeclaration !== undefined
      ? validateAgeDeclaration(input.ageDeclaration) : null;
    if (ageError) {
      if (ageError.code === "AGE_INELIGIBLE")
        await tx.delete(authNonces).where(eq(authNonces.nonceHash, tokenHash(nonce)));
      return { ageError };
    }
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
        ageConfirmedAt: new Date(),
        agePolicyVersion: AGE_POLICY_VERSION,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { email: profile.email, name: profile.name,
          ...(needsAge ? { ageConfirmedAt: new Date(), agePolicyVersion: AGE_POLICY_VERSION } : {}),
        },
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
  if (result.ageError) {
    const { status, ...body } = result.ageError;
    if (body.code === "AGE_INELIGIBLE") deleteCookie(c, "kr_nonce", cookieOptions("/api/auth"));
    return c.json({ ...body, policyVersion: AGE_POLICY_VERSION }, status);
  }
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
// Existing sessions remain usable for reading history/account and refreshing.
// An explicit declaration upgrades age eligibility without issuing a new login.
authRoutes.post("/auth/age", async (c) => {
  const who = await identity(c);
  if (!who) return c.json({ error: "Sign in again to confirm your age.",
    ...(hasAccountCookies(c) ? { code: "SESSION_EXPIRED" } : {}),
  }, 401);
  if (c.req.header("X-KakaReel-Owner") !== who.owner)
    return c.json({ error: "Your account changed. Refresh before confirming your age." }, 409);
  const input = await c.req.json().catch(() => null);
  const ageError = validateAgeDeclaration(input?.ageDeclaration);
  if (ageError) {
    const { status, ...body } = ageError;
    return c.json({ ...body, policyVersion: AGE_POLICY_VERSION }, status);
  }
  const saved = await database().transaction(async (tx) => {
    if (who.user) {
      await tx.update(users).set({
        ageConfirmedAt: sql`coalesce(${users.ageConfirmedAt}, now())`,
        agePolicyVersion: sql`coalesce(${users.agePolicyVersion}, ${AGE_POLICY_VERSION})`,
      }).where(eq(users.id, who.user.id));
    } else {
      if (!(await lockGuest(tx, who.owner))) return false;
      await tx.insert(guestAgeDeclarations).values({ guestId: who.owner,
        ageConfirmedAt: new Date(), agePolicyVersion: AGE_POLICY_VERSION,
      }).onConflictDoNothing();
    }
    return true;
  });
  if (!saved) return c.json({ error: "Your preview session has ended. Sign in again." }, 401);
  return c.json({ ok: true, ageConfirmed: true });
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
    const ageError = !who.user.ageConfirmedAt || input.ageDeclaration !== undefined
      ? validateAgeDeclaration(input.ageDeclaration) : null;
    if (ageError) {
      const { status, ...body } = ageError;
      return c.json({ ...body, policyVersion: AGE_POLICY_VERSION }, status);
    }
    await database()
      .update(users)
      .set({ invitedAt: who.user.invitedAt ?? new Date(),
        ...(!who.user.ageConfirmedAt ? { ageConfirmedAt: new Date(), agePolicyVersion: AGE_POLICY_VERSION } : {}),
      })
      .where(eq(users.id, who.user.id));
  } else {
    const old = getCookie(c, "lm_session");
    const existing = await guestIdentity(old);
    const [declared] = existing ? await database().select().from(guestAgeDeclarations)
      .where(eq(guestAgeDeclarations.guestId, existing.owner)) : [];
    const ageError = !declared || input.ageDeclaration !== undefined
      ? validateAgeDeclaration(input.ageDeclaration) : null;
    if (ageError) {
      const { status, ...body } = ageError;
      return c.json({ ...body, policyVersion: AGE_POLICY_VERSION }, status);
    }
    const raw = existing ? old! : issueSession();
    if (!declared) await database().insert(guestAgeDeclarations).values({
      guestId: sessionOwner(raw)!, ageConfirmedAt: new Date(), agePolicyVersion: AGE_POLICY_VERSION,
    }).onConflictDoNothing();
    setCookie(c, "lm_session", raw, {
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
