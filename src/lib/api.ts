import { adoptPendingRequest, adoptLegacyPendingRequest } from "./pending-request";
let refreshFlight: Promise<void> | undefined;
export const SESSION_ENDED = "kakareel:session-ended";
export const IDENTITY_CHANGED_KEY = "kr_identity_changed";
let localIdentityVersion = 0;
function identityVersion() {
  let shared = "";
  try {
    shared = localStorage.getItem(IDENTITY_CHANGED_KEY) ?? "";
  } catch {
    // Storage may be disabled. Still protect requests within this tab.
  }
  return `${localIdentityVersion}:${shared}`;
}
function assertIdentity(expected: string) {
  if (identityVersion() !== expected)
    throw new Error("Your account changed. Please try again from the current account.");
}
function identityChanged() {
  localIdentityVersion++;
  try {
    localStorage.setItem(IDENTITY_CHANGED_KEY, crypto.randomUUID());
  } catch {
    // A storage failure must not turn a successful sign-in/out into an error.
  }
}
function sessionEnded(): never {
  identityChanged();
  window.dispatchEvent(new Event(SESSION_ENDED));
  throw new Error("Your session has ended. Please sign in again.");
}
const send = (path: string, options: RequestInit) =>
  fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
// Preserve serialization within this tab even when Web Locks are unavailable.
let localSessionQueue = Promise.resolve();
function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("kakareel-session", work);
  const next = localSessionQueue.then(work);
  localSessionQueue = next.then(() => {}, () => {});
  return next;
}
async function refreshSession(expected: string, alreadyLocked = false) {
  const work = async () => {
    assertIdentity(expected);
    // Another tab may have rotated or switched accounts while we waited.
    const current = await send("/session", {});
    const data = await current.json();
    assertIdentity(expected);
    if (current.ok) {
      if (!data.authenticated) sessionEnded();
      return;
    }
    if (current.status !== 401)
      throw new Error("Session service is unavailable. Please try again.");
    const response = await send("/auth/refresh", { method: "POST" });
    assertIdentity(expected);
    if (!response.ok) {
      if (response.status === 401) sessionEnded();
      throw new Error(
        "Your session could not be refreshed. Please sign in again.",
      );
    }
  };
  if (alreadyLocked) {
    // Identity mutations hold the session lock. Never acquire it recursively,
    // or join refreshFlight: that flight may itself be waiting for our lock.
    // Leave a queued flight intact; it will recheck identity after we release.
    await work();
  } else {
    if (!refreshFlight) {
      refreshFlight = withSessionLock(work).finally(() => {
        refreshFlight = undefined;
      });
    }
    await refreshFlight;
  }
  assertIdentity(expected);
}
export async function api(path: string, options: RequestInit = {}) {
  const expected = identityVersion();
  // Serialize cookie-changing sign-in/out with refresh across tabs. Otherwise a
  // delayed refresh response can overwrite the new account's cookies.
  const changesIdentity =
    (path === "/auth/google" && options.method === "POST") ||
    (path === "/session" && options.method === "DELETE");
  const request = async () => {
    assertIdentity(expected);
    let r = await send(path, options);
    let data = await r.json();
    assertIdentity(expected);
    if (r.status === 401 && data.code === "SESSION_EXPIRED") {
      await refreshSession(expected, changesIdentity);
      r = await send(path, options);
      data = await r.json();
      assertIdentity(expected);
      if (r.status === 401 && data.code === "SESSION_EXPIRED") sessionEnded();
    }
    if (!r.ok) throw new Error(data.error ?? "Request failed. Please try again.");
    if (path === "/auth/google" && data.claimedGuestId && data.userId) {
      try {
        adoptLegacyPendingRequest(data.claimedGuestId);
        adoptPendingRequest(data.claimedGuestId, data.userId);
      } catch {
        // Storage may be disabled; server-side history migration has succeeded.
      }
    }
    if (changesIdentity) identityChanged();
    return data;
  };
  return changesIdentity ? withSessionLock(request) : request();
}
