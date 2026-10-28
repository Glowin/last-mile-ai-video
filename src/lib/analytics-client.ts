"use client";
// Browser-side analytics helpers. Every GA call is a no-op until the visitor has
// allowed analytics and the Analytics component has initialised gtag.
import {
  FIRST_TOUCH_COOKIE, FIRST_TOUCH_MAX_AGE_SECONDS, buildFirstTouch, parseFirstTouch, serializeFirstTouch, shouldReplaceFirstTouch,
} from "./attribution";
import { STARTER_CREDIT_OFFER } from "./credit-offer";

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  __krAnalyticsReady?: boolean;
};
type Param = string | number | boolean | null | undefined | Array<Record<string, string | number>>;

const sentOnce = new Set<string>();

/** Send a GA4 event only if the visitor has consented. Never pass prompts, emails or account IDs. */
export function trackEvent(name: string, params: Record<string, Param> = {}, onceKey?: string) {
  if (typeof window === "undefined") return;
  const w = window as AnalyticsWindow;
  if (!w.__krAnalyticsReady || typeof w.gtag !== "function") return;
  if (onceKey) {
    if (sentOnce.has(onceKey)) return;
    sentOnce.add(onceKey);
  }
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
  w.gtag("event", name, { ...clean, transport_type: "beacon" });
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/**
 * Store the first landing's campaign data in a first-party cookie (first non-direct touch wins).
 * Sent to our own API only; never to Google. Skipped when analytics was rejected.
 */
export function captureFirstTouch() {
  try {
    const touch = buildFirstTouch(window.location.href, document.referrer);
    if (!shouldReplaceFirstTouch(parseFirstTouch(readCookie(FIRST_TOUCH_COOKIE)), touch) || !touch) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${FIRST_TOUCH_COOKIE}=${serializeFirstTouch(touch)}; Max-Age=${FIRST_TOUCH_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch { /* Cookies disabled: attribution is optional. */ }
}

export function clearFirstTouch() {
  try { document.cookie = `${FIRST_TOUCH_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`; } catch { /* Optional. */ }
}

type JobSummary = { id?: unknown; family?: unknown; mode?: unknown; duration?: unknown; resolution?: unknown; billingMode?: unknown; credits?: unknown };
const text = (v: unknown) => (typeof v === "string" && v.length <= 60 ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** generate_video params: an explicit allowlist. The prompt and image are never sent. */
export function generationEventParams(job: JobSummary) {
  return {
    model: text(job.family), generation_mode: text(job.mode), duration_seconds: num(job.duration),
    resolution: text(job.resolution), billing_mode: text(job.billingMode), credits: num(job.credits) ?? 0,
  };
}
export function trackGeneration(job: JobSummary | null | undefined) {
  if (!job || typeof job.id !== "string") return;
  trackEvent("generate_video", generationEventParams(job), `generate_video:${job.id}`);
}
/** Funnel step before redirecting to the hosted checkout. Purchase itself is sent server-side. */
export function trackBeginCheckout() {
  trackEvent("begin_checkout", {
    currency: STARTER_CREDIT_OFFER.currency, value: STARTER_CREDIT_OFFER.amountMinor / 100,
    items: [{ item_id: STARTER_CREDIT_OFFER.id, item_name: STARTER_CREDIT_OFFER.name, price: STARTER_CREDIT_OFFER.amountMinor / 100, quantity: 1 }],
  });
}
