import type { BillingCatalogResponse, BillingProviderId, BillingOrdersResponse, BillingCheckoutResponse, BillingSummaryResponse } from "./billing";
import { STARTER_CREDIT_OFFER } from "./credit-offer";
import { adoptPendingRequest, adoptLegacyPendingRequest, pendingRequestId } from "./pending-request";
let refreshFlight: Promise<void> | undefined;
export const IDENTITY_CHANGED_EVENT = "kakareel:identity-changed";
export type IdentityChangedEvent = Event & { reason: "sign-in" | "sign-out" };
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
  // Challenge responses set the shared HttpOnly nonce cookie. Serialize them
  // across tabs with refresh/sign-in/out, without announcing an identity change.
  // Browsers without Web Locks retain the existing within-tab queue only.
  const needsSessionLock = changesIdentity ||
    (["/auth/challenge", "/auth/age", "/session"].includes(path) && options.method === "POST");
  const request = async () => {
    assertIdentity(expected);
    let r = await send(path, options);
    let data = await r.json();
    assertIdentity(expected);
    if (r.status === 401 && data.code === "SESSION_EXPIRED") {
      await refreshSession(expected, needsSessionLock);
      r = await send(path, options);
      data = await r.json();
      assertIdentity(expected);
      if (r.status === 401 && data.code === "SESSION_EXPIRED") sessionEnded();
    }
    if (!r.ok) throw Object.assign(new Error(data.error ?? "Request failed. Please try again."), {
      code: data.code, status: r.status,
    });
    if (path === "/auth/google" && data.claimedGuestId && data.userId) {
      try {
        adoptLegacyPendingRequest(data.claimedGuestId);
        adoptPendingRequest(data.claimedGuestId, data.userId);
      } catch {
        // Storage may be disabled; server-side history migration has succeeded.
      }
    }
    if (changesIdentity) {
      identityChanged();
      window.dispatchEvent(Object.assign(new Event(IDENTITY_CHANGED_EVENT), {
        reason: path === "/auth/google" ? "sign-in" : "sign-out",
      }));
    }
    return data;
  };
  return needsSessionLock ? withSessionLock(request) : request();
}

// Public catalog is authoritative; published pricing alone never enables a sale.

export function starterCheckoutProvider(catalog: BillingCatalogResponse | null): BillingProviderId | null {
  const product = catalog?.products.find((item) => item.id === STARTER_CREDIT_OFFER.id);
  if (!catalog?.checkoutEnabled || !product?.available ||
      product.credits !== STARTER_CREDIT_OFFER.credits ||
      product.price?.currency !== STARTER_CREDIT_OFFER.currency ||
      product.price.amountMinor !== STARTER_CREDIT_OFFER.amountMinor) return null;
  return catalog.providers.find((provider) => provider.available && "environment" in provider &&
    (provider.environment === "test" || provider.environment === "live"))?.id ?? null;
}

export function starterCheckoutEnvironment(catalog: BillingCatalogResponse | null): "test" | "live" | null {
  const id = starterCheckoutProvider(catalog);
  const provider = catalog?.providers.find((item) => item.id === id);
  if (!provider || !("environment" in provider)) return null;
  return provider.environment === "test" || provider.environment === "live" ? provider.environment : null;
}

export type GenerationQuote = {
  quoteId: string | null;
  credits: number | null;
  priceVersion: string;
  expiresAt: string;
  available: boolean;
  reason?: string;
};

export function usableGenerationQuote(quote: GenerationQuote | null, now = Date.now()): quote is GenerationQuote & { quoteId: string; credits: number } {
  return !!quote?.available && !!quote.quoteId && !!quote.priceVersion &&
    typeof quote.credits === "number" && Number.isSafeInteger(quote.credits) && quote.credits > 0 &&
    Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > now;
}

export function billingMoney(amountMinor: number | null | undefined, currency: string): string {
  if (amountMinor == null) return "Not confirmed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}

export function paidGenerationAllowed(summary: BillingSummaryResponse | null, quote: GenerationQuote | null, now = Date.now()): boolean {
  return summary?.generationChargingEnabled === true && summary.blocked === false &&
    usableGenerationQuote(quote, now) && Number.isSafeInteger(summary.availableCredits) &&
    summary.availableCredits >= quote.credits;
}

// Revalidate before creating an order. Serialize tabs so one checkout click cannot
// overwrite another tab's saved attempt. Unknown results retain the same ID.
let checkoutQueue = Promise.resolve();
export async function prepareStarterCheckout(owner: string): Promise<BillingCheckoutResponse> {
  const expected = identityVersion();
  const work = async () => {
    assertIdentity(expected);
    const headers = { "X-KakaReel-Owner": owner };
    const catalog: BillingCatalogResponse = await api("/billing/catalog");
    assertIdentity(expected);
    const provider = starterCheckoutProvider(catalog);
    if (!provider) throw new Error("Not yet on sale. No order was created.");
    const history: BillingOrdersResponse = await api("/billing/orders", { headers });
    assertIdentity(expected);
    const key = `kr_checkout:${owner}:${STARTER_CREDIT_OFFER.id}:${provider}:${starterCheckoutEnvironment(catalog)}`;
    const previousOrderId = localStorage.getItem(`${key}:order`);
    const previousOrder = history.orders.find((order) => order.id === previousOrderId);
    if (previousOrder && ["paid", "refunded", "failed", "canceled"].includes(previousOrder.status)) {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}:order`);
    }
    let requestId = localStorage.getItem(key);
    if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
      throw new Error("Saved checkout could not be read. Review your orders before trying again.");
    if (!requestId) {
      requestId = crypto.randomUUID();
      localStorage.setItem(key, requestId);
    }
    assertIdentity(expected);
    const result: BillingCheckoutResponse = await api("/billing/checkout", {
      method: "POST", headers,
      body: JSON.stringify({ productId: STARTER_CREDIT_OFFER.id, provider, requestId }),
    });
    assertIdentity(expected);
    localStorage.setItem(`${key}:order`, result.order.id);
    const destination = new URL(result.checkoutUrl);
    if (destination.protocol !== "https:") throw new Error("Checkout could not be opened securely. Review your order before trying again.");
    return result;
  };
  if (navigator.locks) return navigator.locks.request(`kakareel-checkout:${owner}`, work);
  const next = checkoutQueue.then(work);
  checkoutQueue = next.then(() => {}, () => {});
  return next;
}

export async function generationRequestId(owner: string, payload: Record<string, unknown>, billingMode: "preview" | "paid"): Promise<string> {
  const expected = identityVersion();
  // Preserve existing preview IDs and keep paid IDs stable across fresh quotes.
  const input = billingMode === "preview" ? payload : { ...payload, billingMode };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  assertIdentity(expected);
  const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return pendingRequestId(owner, digest);
}
