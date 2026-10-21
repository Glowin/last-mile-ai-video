"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, IDENTITY_CHANGED_EVENT, IDENTITY_CHANGED_KEY, SESSION_ENDED, type IdentityChangedEvent } from "@/lib/api";
import { loadGoogleIdentity } from "@/lib/google-identity";
import { GoogleSignInController } from "@/lib/google-signin-controller";
import { GoogleSignIn } from "./google-sign-in";

const Context = createContext<GoogleSignInController | null>(null);
const CLOSED_KEY = "kr_google_signin_closed";
const serverState = { phase: "checking" as const, visible: false, message: "" };

export function useGoogleAuth() {
  const controller = useContext(Context);
  if (!controller) throw new Error("GoogleAuthProvider is required.");
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, () => serverState);
  return { controller, state };
}

export function GoogleAuthProvider({ children }: { children: React.ReactNode }) {
  const [controller] = useState(() => new GoogleSignInController({
    session: () => api("/session"),
    config: () => api("/config"),
    challenge: () => api("/auth/challenge", { method: "POST" }),
    authenticate: (credential) => api("/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
    sdk: loadGoogleIdentity,
    dismissed: () => { try { return sessionStorage.getItem(CLOSED_KEY) === "1"; } catch { return false; } },
    rememberDismissal: (closed) => { try { sessionStorage.setItem(CLOSED_KEY, closed ? "1" : "0"); } catch { /* Optional storage. */ } },
    schedule: (work, ms) => setTimeout(work, ms),
    unschedule: (timer) => clearTimeout(timer),
  }));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const changed = (event: Event) => { void controller.identityChanged((event as IdentityChangedEvent).reason); };
    const external = (event: StorageEvent) => {
      if (event.key === IDENTITY_CHANGED_KEY || event.key === null) void controller.identityChanged("external");
    };
    const ended = () => controller.sessionEnded();
    window.addEventListener(IDENTITY_CHANGED_EVENT, changed);
    window.addEventListener("storage", external);
    window.addEventListener(SESSION_ENDED, ended);
    void controller.start();
    return () => {
      mounted.current = false;
      // React's development StrictMode reconnects effects synchronously. Only
      // cancel the document controller after a real root unmount/HMR teardown.
      queueMicrotask(() => { if (!mounted.current) controller.stop(); });
      window.removeEventListener(IDENTITY_CHANGED_EVENT, changed);
      window.removeEventListener("storage", external);
      window.removeEventListener(SESSION_ENDED, ended);
    };
    // No focus/visibility reinitialization: returning from Google's popup must
    // leave the callback and nonce intact. RootLayout survives route changes.
  }, [controller]);
  return <Context.Provider value={controller}>{children}<FloatingGoogleSignIn /></Context.Provider>;
}

function FloatingGoogleSignIn() {
  const { controller, state } = useGoogleAuth();
  if (!state.visible || state.phase === "signed-in") return null;
  return (
    <aside className="google-signin-card" aria-label="Sign in to KakaReel">
      <div className="google-signin-card-heading">
        <strong>Sign in to KakaReel</strong>
        <button type="button" className="google-signin-close" aria-label="Close sign-in card" onClick={controller.close}>×</button>
      </div>
      <p>Keep your videos in your account.</p>
      <GoogleSignIn compact />
      <p className="google-signin-card-links"><Link href="/account">Account help</Link><Link href="/privacy">Privacy</Link></p>
    </aside>
  );
}

export function HeaderAccount() {
  const { controller, state } = useGoogleAuth();
  return <Link className="button small secondary" href="/account" onClick={(event) => {
    if (state.phase !== "signed-in") { event.preventDefault(); controller.open(); }
  }}>{state.phase === "signed-in" ? "Account" : "Sign in"}</Link>;
}
