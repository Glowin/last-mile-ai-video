"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { analyticsConsentKey } from "@/lib/analytics-context";
import { revokeBrowserAnalytics } from "@/lib/analytics-consent";
import { gaPageLocation } from "@/lib/attribution";
import { captureFirstTouch, clearFirstTouch } from "@/lib/analytics-client";

const preferenceKey = analyticsConsentKey;
type Consent = "granted" | "denied" | null;
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __krAnalyticsReady?: boolean;
  __krAnalyticsMeasurementId?: string;
};

export function Analytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
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
    const changed = (event: StorageEvent) => {
      if (event.key === preferenceKey && event.newValue === "denied") void choose("denied");
    };
    window.addEventListener("analytics-settings", open);
    window.addEventListener("storage", changed);
    // Retry a previously interrupted withdrawal, including after logout.
    if (saved === "denied") void choose("denied");
    return () => {
      window.removeEventListener("analytics-settings", open);
      window.removeEventListener("storage", changed);
    };
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
      w.__krAnalyticsMeasurementId = measurementId;
    }
    if (lastPage.current !== location) {
      w.gtag!("set", { page_location: location, page_referrer: lastPage.current || (document.referrer ? new URL(document.referrer).origin : "") });
      w.gtag!("event", "page_view", { page_location: location, page_title: document.title });
      lastPage.current = location;
    }
  }, [consent, measurementId, pathname]);

  async function choose(value: Exclude<Consent, null>) {
    try { localStorage.setItem(preferenceKey, value); } catch { /* Optional storage. */ }
    setConsent(value);
    setSettings(false);
    setSaveError("");
    if (value === "granted" && initialized.current) {
      // A failed withdrawal keeps this document open; allowing again must
      // restore the in-memory tag too, even when storage is unavailable.
      (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = false;
      (window as AnalyticsWindow).__krAnalyticsReady = true;
      (window as AnalyticsWindow).gtag?.("consent", "update", { analytics_storage: "granted" });
    }
    if (value === "denied") {
      clearFirstTouch();
      (window as AnalyticsWindow).__krAnalyticsReady = false;
    }
    if (value === "denied" && initialized.current) {
      // Disable immediately, then unload the tag. Remove only GA cookies.
      (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = true;
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0].trim();
        if (name === "_ga" || name.startsWith("_ga_")) {
          const domains = ["", window.location.hostname, `.${window.location.hostname}`];
          for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ""}`;
        }
      }
    }
    if (value === "denied") {
      setSaving(true);
      try {
        await revokeBrowserAnalytics();
        if (initialized.current) window.location.reload();
      } catch {
        setSaveError("Analytics is off in this page, but we could not confirm withdrawal on the server. Please retry Reject analytics.");
      } finally { setSaving(false); }
    }
  }

  if (!ready || (consent !== null && !settings && !saveError && !saving)) return null;
  return (
    <section aria-label="Analytics preferences" className="analytics-banner">
      <p>Allow analytics cookies to help us understand visits and improve KakaReel? We use Google Analytics. <Link href="/privacy">Privacy details</Link></p>
      {saveError && <p role="alert">{saveError}</p>}
      {saving && <p role="status">Saving your preference…</p>}
      <div>
        <button className="button secondary small" disabled={saving} onClick={() => choose("denied")}>Reject analytics</button>
        <button className="button small" disabled={saving} onClick={() => choose("granted")}>Allow analytics</button>
      </div>
    </section>
  );
}

export function AnalyticsSettings() {
  return <button className="analytics-settings" onClick={() => window.dispatchEvent(new Event("analytics-settings"))}>Cookie settings</button>;
}
