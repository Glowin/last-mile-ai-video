"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IDENTITY_CHANGED_EVENT } from "@/lib/api";
import { gaPageLocation } from "@/lib/attribution";
import { captureFirstTouch, clearFirstTouch } from "@/lib/analytics-client";

const preferenceKey = "kakareel-analytics-consent";
type Consent = "granted" | "denied" | null;
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __krAnalyticsReady?: boolean;
};

// Lets the server send this browser's own purchase to GA (Measurement Protocol)
// only while analytics consent is granted. Ignored for guests; failures are silent.
function registerClient(measurementId: string) {
  const w = window as AnalyticsWindow;
  w.gtag?.("get", measurementId, "client_id", (clientId: unknown) => {
    if (typeof clientId !== "string" || !clientId) return;
    void fetch("/api/analytics/ga-client", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    }).catch(() => {});
  });
}

export function Analytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const initialized = useRef(false);
  const lastPage = useRef("");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(preferenceKey);
      if (saved === "granted" || saved === "denied") setConsent(saved);
    } catch { /* Storage blocked: keep the choice in memory. */ }
    // First-party campaign note for our own sign-up attribution (see docs/analytics.md).
    if (saved !== "denied") captureFirstTouch();
    setReady(true);
    const open = () => setSettings(true);
    window.addEventListener("analytics-settings", open);
    return () => window.removeEventListener("analytics-settings", open);
  }, []);

  useEffect(() => {
    if (consent !== "granted" || !pathname) return;
    const w = window as AnalyticsWindow;
    // No automatic URL, form, search, or history collection. Enhanced
    // measurement must also be disabled on the GA web stream. Only utm_*
    // campaign parameters are kept in page_location; all other query keys
    // (tokens, codes, prompts) and the fragment are dropped.
    const location = gaPageLocation(window.location.origin + pathname + window.location.search);
    if (!initialized.current) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function () { w.dataLayer!.push(arguments); };
      w.gtag("consent", "default", {
        analytics_storage: "granted", ad_storage: "denied",
        ad_user_data: "denied", ad_personalization: "denied",
      });
      w.gtag("js", new Date());
      w.gtag("config", measurementId, {
        send_page_view: false,
        page_location: location,
        page_referrer: document.referrer ? new URL(document.referrer).origin : "",
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      document.head.appendChild(script);
      initialized.current = true;
      w.__krAnalyticsReady = true;
      registerClient(measurementId);
    }
    if (lastPage.current !== location) {
      w.gtag!("set", { page_location: location, page_referrer: lastPage.current || (document.referrer ? new URL(document.referrer).origin : "") });
      w.gtag!("event", "page_view", { page_location: location, page_title: document.title });
      lastPage.current = location;
    }
  }, [consent, measurementId, pathname]);

  useEffect(() => {
    if (consent !== "granted") return;
    const changed = () => registerClient(measurementId);
    window.addEventListener(IDENTITY_CHANGED_EVENT, changed);
    return () => window.removeEventListener(IDENTITY_CHANGED_EVENT, changed);
  }, [consent, measurementId]);

  function choose(value: Exclude<Consent, null>) {
    try { localStorage.setItem(preferenceKey, value); } catch { /* Optional storage. */ }
    setConsent(value);
    setSettings(false);
    if (value === "denied") {
      clearFirstTouch();
      // Forget any stored GA client ID for a signed-in account (no-op for guests).
      void fetch("/api/analytics/ga-client", { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
    }
    if (value === "denied" && initialized.current) {
      (window as AnalyticsWindow).__krAnalyticsReady = false;
      // Disable immediately, then unload the tag. Remove only GA cookies.
      (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = true;
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0].trim();
        if (name === "_ga" || name.startsWith("_ga_")) {
          const domains = ["", window.location.hostname, `.${window.location.hostname}`];
          for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ""}`;
        }
      }
      window.location.reload();
    }
  }

  if (!ready || (consent !== null && !settings)) return null;
  return (
    <section aria-label="Analytics preferences" className="analytics-banner">
      <p>Allow analytics cookies to help us understand visits and improve KakaReel? We use Google Analytics. <Link href="/privacy">Privacy details</Link></p>
      <div>
        <button className="button secondary small" onClick={() => choose("denied")}>Reject analytics</button>
        <button className="button small" onClick={() => choose("granted")}>Allow analytics</button>
      </div>
    </section>
  );
}

export function AnalyticsSettings() {
  return <button className="analytics-settings" onClick={() => window.dispatchEvent(new Event("analytics-settings"))}>Cookie settings</button>;
}
