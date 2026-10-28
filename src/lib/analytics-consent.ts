"use client";
import { analyticsConsentKey, checkoutAnalyticsSchema, type CheckoutAnalytics } from "./analytics-context";

type AnalyticsWindow = Window & {
  __krAnalyticsReady?: boolean;
  __krAnalyticsMeasurementId?: string;
  gtag?: (...args: unknown[]) => void;
};
let queue: Promise<unknown> = Promise.resolve();
function withConsentLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("kakareel-analytics-consent", work);
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}
function allowed() {
  if (typeof window === "undefined" || !(window as AnalyticsWindow).__krAnalyticsReady) return false;
  try { return localStorage.getItem(analyticsConsentKey) !== "denied"; } catch { return true; }
}
async function consentRequest(method: "POST" | "DELETE") {
  const r = await fetch("/api/analytics/consent", {
    method, credentials: "same-origin", keepalive: method === "DELETE",
    headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok || (await r.json()).ok !== true) throw new Error("Analytics preference could not be saved.");
}
function gaValue(key: "client_id" | "session_id"): Promise<unknown> {
  const w = window as AnalyticsWindow;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 1000);
    try {
      w.gtag?.("get", w.__krAnalyticsMeasurementId, key, (value: unknown) => {
        clearTimeout(timer); resolve(value);
      });
    } catch { clearTimeout(timer); resolve(undefined); }
  });
}

/** Called immediately before creating an order. Missing/blocked GA never blocks payment. */
export async function collectCheckoutAnalytics(): Promise<CheckoutAnalytics | undefined> {
  if (!allowed()) return undefined;
  const [clientId, sessionId] = await Promise.all([gaValue("client_id"), gaValue("session_id")]);
  const parsed = checkoutAnalyticsSchema.safeParse({ clientId,
    sessionId: typeof sessionId === "number" ? String(sessionId) : sessionId });
  if (!parsed.success) return undefined;
  try {
    return await withConsentLock(async () => {
      if (!allowed()) return undefined; // A delayed gtag callback cannot opt back in.
      await consentRequest("POST");
      return allowed() ? parsed.data : undefined;
    });
  } catch { return undefined; }
}

/** No account session required. Wait for acknowledgment before reloading. */
export function revokeBrowserAnalytics() {
  return withConsentLock(() => consentRequest("DELETE"));
}
