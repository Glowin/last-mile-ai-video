import { createHash, randomBytes, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { database } from "./db";
import { users, authSessions, refreshTokens, guestClaims } from "./schema";
import { sessionOwner } from "./auth";

const google = new OAuth2Client();
const accessSeconds = 10 * 60;
const refreshSeconds = 30 * 86400;
export const tokenHash = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export type Transaction = Parameters<
  Parameters<ReturnType<typeof database>["transaction"]>[0]
>[0];
export type Account = typeof users.$inferSelect;
export type Identity = {
  owner: string;
  user: Account | null;
  canGenerate: boolean;
  sessionId?: string;
};

function secret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error("Session configuration missing");
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}
export function authConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.DATABASE_URL &&
    process.env.APP_URL &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  );
}
export function cookieOptions(path = "/") {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path,
  };
}
export async function verifyGoogle(credential: string, nonce: string) {
  const audience = process.env.GOOGLE_CLIENT_ID!.trim();
  const ticket = await google.verifyIdToken({ idToken: credential, audience });
  const p = ticket.getPayload();
  // The library verifies signature/issuer/audience/expiry. Explicit claim checks also
  // enforce exact expiry (no library clock-skew grace) and our browser-bound nonce.
  if (
    !p ||
    p.aud !== audience ||
    !["accounts.google.com", "https://accounts.google.com"].includes(p.iss) ||
    !Number.isFinite(p.exp) ||
    p.exp <= Date.now() / 1000 ||
    p.email_verified !== true ||
    typeof p.email !== "string" ||
    !p.email ||
    typeof p.sub !== "string" ||
    !p.sub ||
    (p as typeof p & { nonce?: string }).nonce !== nonce
  )
    throw new Error("Invalid Google credential");
  return {
    sub: p.sub,
    email: p.email,
    name: typeof p.name === "string" ? p.name : null,
  };
}
export function publicUser(u: Account) {
  return { id: u.id, email: u.email, name: u.name };
}
export async function lockGuest(tx: Transaction, guest: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${guest}, 0))`,
  );
  const [claimed] = await tx
    .select()
    .from(guestClaims)
    .where(eq(guestClaims.guestId, guest));
  return !claimed;
}
export async function guestIdentity(cookie?: string): Promise<Identity | null> {
  const id = sessionOwner(cookie);
  if (!id) return null;
  const [claim] = await database()
    .select()
    .from(guestClaims)
    .where(eq(guestClaims.guestId, id));
  if (claim) return null;
  return { owner: id, user: null, canGenerate: true };
}
async function accessPayload(raw?: string) {
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret(), {
      algorithms: ["HS256"],
      issuer: "kakareel",
      audience: "kakareel-studio",
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      !/^[a-f0-9-]{36}$/.test(payload.sid)
    )
      return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
export async function identity(c: Context): Promise<Identity | null> {
  const access = getCookie(c, "kr_access");
  const p = await accessPayload(access);
  if (p) {
    const [row] = await database()
      .select({ user: users, session: authSessions })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.id, p.sessionId),
          eq(users.id, p.userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      );
    if (row)
      return {
        owner: row.user.id,
        user: row.user,
        sessionId: row.session.id,
        canGenerate: !!row.user.invitedAt,
      };
  }
  // Never silently fall back to a guest when an account session needs refresh.
  if (access || getCookie(c, "kr_refresh")) return null;
  return guestIdentity(getCookie(c, "lm_session"));
}
export function hasAccountCookies(c: Context) {
  return !!(getCookie(c, "kr_access") || getCookie(c, "kr_refresh"));
}
export async function createLogin(tx: Transaction, userId: string) {
  const sessionId = randomUUID(),
    refresh = randomToken();
  const expiresAt = new Date(Date.now() + refreshSeconds * 1000);
  await tx.insert(authSessions).values({ id: sessionId, userId, expiresAt });
  await tx
    .insert(refreshTokens)
    .values({ tokenHash: tokenHash(refresh), sessionId });
  return { sessionId, userId, refresh, expiresAt };
}
export async function setLogin(
  c: Context,
  login: {
    sessionId: string;
    userId: string;
    refresh: string;
    expiresAt: Date;
  },
) {
  const jwt = await new SignJWT({ sid: login.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(login.userId)
    .setIssuer("kakareel")
    .setAudience("kakareel-studio")
    .setIssuedAt()
    .setExpirationTime(`${accessSeconds}s`)
    .sign(secret());
  setCookie(c, "kr_access", jwt, { ...cookieOptions(), maxAge: accessSeconds });
  setCookie(c, "kr_refresh", login.refresh, {
    ...cookieOptions("/api"),
    maxAge: Math.max(
      0,
      Math.floor((login.expiresAt.getTime() - Date.now()) / 1000),
    ),
  });
}
export async function rotate(c: Context) {
  const raw = getCookie(c, "kr_refresh");
  if (!raw || raw.length > 100) return null;
  return database().transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash(raw)));
    if (!token) return null;
    // Serialize rotations AND logout/replay revocation for the entire session family.
    const [session] = await tx
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, token.sessionId))
      .for("update");
    const [current] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, token.tokenHash));
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      return null;
    if (current.usedAt) {
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, session.id));
      return null;
    }
    const refresh = randomToken();
    await tx
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, token.tokenHash));
    await tx
      .insert(refreshTokens)
      .values({ tokenHash: tokenHash(refresh), sessionId: session.id });
    return {
      sessionId: session.id,
      userId: session.userId,
      refresh,
      expiresAt: session.expiresAt,
    };
  });
}
export async function revokeLogin(c: Context, tx: Transaction) {
  const raw = getCookie(c, "kr_refresh");
  if (raw && raw.length <= 100) {
    const [token] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash(raw)));
    if (token)
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, token.sessionId));
  }
  const p = await accessPayload(getCookie(c, "kr_access"));
  if (p)
    await tx
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, p.sessionId));
}
export function clearLogin(c: Context) {
  deleteCookie(c, "kr_access", cookieOptions());
  deleteCookie(c, "kr_refresh", cookieOptions("/api"));
  deleteCookie(c, "lm_session", cookieOptions());
  deleteCookie(c, "kr_nonce", cookieOptions("/api/auth"));
}
