// First-touch marketing attribution shared by the browser and the server.
// Only campaign parameters, a referral code, the referring host and the landing
// path are kept. Never query strings, fragments, click-ID values, emails or tokens.

export const FIRST_TOUCH_COOKIE = "kr_ft";
export const FIRST_TOUCH_MAX_AGE_SECONDS = 90 * 86400;
export const ATTRIBUTION_VERSION = 1;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
// Presence only: the click-ID value is a per-click identifier and is never stored.
export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "twclid", "li_fat_id"] as const;
// Query parameters that may reach the Google Analytics page_location. GA reads
// utm_* from page_location for session attribution. Everything else is dropped.
export const GA_PAGE_PARAMS = [...UTM_KEYS, "utm_id"] as const;

export type FirstTouch = {
  v: typeof ATTRIBUTION_VERSION;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ref: string | null;
  referrer_host: string | null;
  landing_path: string;
  click_id: (typeof CLICK_ID_KEYS)[number] | null;
  ts: number;
};

const MAX_VALUE = 100;
const MAX_PATH = 200;

/** Lower-case, trimmed, printable, length-capped; drops anything that looks like an email or secret. */
export function cleanParam(value: string | null | undefined, max = MAX_VALUE): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase().slice(0, max);
  if (!v) return null;
  if (v.includes("@")) return null; // Never keep an email address pasted into a campaign tag.
  return v;
}

export function cleanPath(path: string | null | undefined): string {
  if (typeof path !== "string" || !path.startsWith("/")) return "/";
  // Pathname only. Query and fragment are removed by the caller; strip defensively.
  const p = path.split(/[?#]/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_PATH);
  return p || "/";
}

export function referrerHost(referrer: string | null | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, "")) return null;
    return host.slice(0, MAX_VALUE);
  } catch {
    return null;
  }
}

/** Build a first touch from the landing URL and document.referrer. */
export function buildFirstTouch(href: string, referrer: string, now = Date.now()): FirstTouch | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const q = url.searchParams;
  const utm = Object.fromEntries(UTM_KEYS.map((k) => [k, cleanParam(q.get(k))])) as Record<(typeof UTM_KEYS)[number], string | null>;
  return {
    v: ATTRIBUTION_VERSION,
    ...utm,
    ref: cleanParam(q.get("ref") ?? q.get("via")),
    referrer_host: referrerHost(referrer, url.hostname),
    landing_path: cleanPath(url.pathname),
    click_id: CLICK_ID_KEYS.find((k) => q.has(k)) ?? null,
    ts: Math.floor(now / 1000),
  };
}

export function hasCampaignSignal(t: FirstTouch) {
  return !!(t.utm_source || t.utm_medium || t.utm_campaign || t.ref || t.click_id);
}

/** Keep the first touch, except that a direct/unknown visit is upgraded by a later tagged or referred one. */
export function shouldReplaceFirstTouch(existing: FirstTouch | null, next: FirstTouch | null): boolean {
  if (!next) return false;
  if (!existing) return true;
  return !hasCampaignSignal(existing) && !existing.referrer_host && (hasCampaignSignal(next) || !!next.referrer_host);
}

export function serializeFirstTouch(t: FirstTouch): string {
  return encodeURIComponent(JSON.stringify(t));
}

/** Strictly re-validate a cookie value. Unknown keys are dropped; invalid input returns null. */
export function parseFirstTouch(raw: string | null | undefined, now = Date.now()): FirstTouch | null {
  if (!raw || raw.length > 2048) return null;
  try { return parseDecodedFirstTouch(decodeURIComponent(raw), now); } catch { return null; }
}

/** Hono getCookie already URI-decodes its value. Never decode campaign text twice. */
export function parseDecodedFirstTouch(raw: string | null | undefined, now = Date.now()): FirstTouch | null {
  if (!raw || raw.length > 2048) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== ATTRIBUTION_VERSION) return null;
  const ts = typeof d.ts === "number" && Number.isInteger(d.ts) ? d.ts : NaN;
  // Reject timestamps from the future (beyond small clock skew) or beyond the cookie lifetime.
  const nowSec = Math.floor(now / 1000);
  if (!Number.isFinite(ts) || ts > nowSec + 86400 || ts < nowSec - FIRST_TOUCH_MAX_AGE_SECONDS - 86400) return null;
  const str = (k: string) => cleanParam(typeof d[k] === "string" ? (d[k] as string) : null);
  const click = typeof d.click_id === "string" && (CLICK_ID_KEYS as readonly string[]).includes(d.click_id)
    ? (d.click_id as FirstTouch["click_id"]) : null;
  const host = typeof d.referrer_host === "string" && /^[a-z0-9.-]{1,100}$/.test(d.referrer_host) ? d.referrer_host : null;
  return {
    v: ATTRIBUTION_VERSION,
    utm_source: str("utm_source"), utm_medium: str("utm_medium"), utm_campaign: str("utm_campaign"),
    utm_content: str("utm_content"), utm_term: str("utm_term"), ref: str("ref"),
    referrer_host: host,
    landing_path: cleanPath(typeof d.landing_path === "string" ? d.landing_path : "/"),
    click_id: click,
    ts,
  };
}

/** Page location for GA: origin + pathname + only allow-listed campaign parameters. */
export function gaPageLocation(href: string): string {
  let url: URL;
  try { url = new URL(href); } catch { return ""; }
  const kept = new URLSearchParams();
  for (const key of GA_PAGE_PARAMS) {
    const value = cleanParam(url.searchParams.get(key));
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return url.origin + url.pathname + (query ? `?${query}` : "");
}
