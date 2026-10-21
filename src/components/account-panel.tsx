"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, IDENTITY_CHANGED_KEY, SESSION_ENDED } from "@/lib/api";
import { GoogleSignIn } from "./google-sign-in";

type Profile = {
  user: { id: string; name: string | null; email: string; createdAt: string };
  canGenerate: boolean;
  sessions: { id: string; expiresAt: string; current: boolean }[];
};

function identityMarker() {
  try { return localStorage.getItem(IDENTITY_CHANGED_KEY); }
  catch { return null; }
}

export function AccountPanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const pending = useRef(false);
  const hasProfile = useRef(false);
  const displayedMarker = useRef<string | null>(null);

  const load = useCallback(async (notice = "") => {
    const version = ++epoch.current;
    const marker = identityMarker();
    pending.current = false;
    setBusy(false);
    hasProfile.current = false;
    setProfile(null);
    setState("loading");
    setError("");
    setMessage("");
    try {
      const session = await api("/session");
      if (version !== epoch.current) return;
      if (!session.user) {
        setState("signed-out");
        setMessage(notice);
        return;
      }
      const data: Profile = await api("/account", {
        headers: { "X-KakaReel-Owner": session.user.id },
      });
      if (version !== epoch.current) return;
      displayedMarker.current = marker;
      hasProfile.current = true;
      setProfile(data);
      setState("ready");
      setMessage(notice);
    } catch (cause) {
      if (version !== epoch.current) return;
      setError((cause as Error).message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const ended = () => {
      epoch.current++;
      pending.current = false;
      setBusy(false);
      hasProfile.current = false;
      setProfile(null);
      setState("signed-out");
      setMessage("");
      setError("Your session has ended. Please sign in again.");
    };
    const changed = (event: StorageEvent) => {
      if (event.key === IDENTITY_CHANGED_KEY || event.key === null) void load();
    };
    const visible = () => {
      // Returning from the Google popup must not unmount its sign-in callback.
      if (!document.hidden && !pending.current && hasProfile.current) void load();
    };
    void load();
    const timer = setInterval(visible, 5 * 60_000);
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener(SESSION_ENDED, ended);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  async function signOut(others: boolean) {
    if (!profile || pending.current) return;
    // A storage notification can still be queued when the user clicks sign out.
    if (displayedMarker.current !== identityMarker()) {
      await load();
      return;
    }
    const version = epoch.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(others ? "/account/sessions/others" : "/session", {
        method: "DELETE",
        headers: { "X-KakaReel-Owner": profile.user.id },
      });
      if (version !== epoch.current) return;
      if (!others) {
        try { window.google?.accounts.id.disableAutoSelect(); }
        catch { /* Google SDK availability must not undo a successful sign-out. */ }
      }
      await load(others ? "Other sessions signed out. This session is still active." : "You are signed out.");
    } catch (cause) {
      if (version !== epoch.current) return;
      // Never leave another account's details or actionable session list visible.
      hasProfile.current = false;
      setProfile(null);
      setState("error");
      setError((cause as Error).message);
    } finally {
      if (version === epoch.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  const others = profile?.sessions.filter((session) => !session.current).length ?? 0;
  return (
    <div aria-busy={state === "loading" || busy}>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div role="status" aria-live="polite">
        {state === "loading" && <p>Loading your account…</p>}
        {message && <p>{message}</p>}
        {busy && <p>Signing out…</p>}
      </div>
      {state === "error" && (
        <button className="button secondary" onClick={() => void load()}>Retry account details</button>
      )}
      {state === "signed-out" && (
        <section className="controls-panel" aria-labelledby="account-sign-in">
          <h2 id="account-sign-in">Sign in to manage your account</h2>
          <p>Use your Google account to view your profile and manage active sessions.</p>
          <GoogleSignIn onSignedIn={load} />
          <p><Link href="/create">Open the studio to use a preview code</Link></p>
        </section>
      )}
      {state === "ready" && profile && (
        <div className="workspace">
          <section className="controls-panel" aria-labelledby="account-profile">
            <h2 id="account-profile">Profile</h2>
            <dl style={{ overflowWrap: "anywhere" }}>
              <dt className="field-label">Name</dt>
              <dd style={{ margin: 0 }}>{profile.user.name || "Not provided"}</dd>
              <dt className="field-label">Google email</dt>
              <dd style={{ margin: 0 }}>{profile.user.email}</dd>
              <dt className="field-label">Account created</dt>
              <dd style={{ margin: 0 }}><time dateTime={profile.user.createdAt}>{new Date(profile.user.createdAt).toLocaleString("en-US")}</time></dd>
              <dt className="field-label">Preview access</dt>
              <dd style={{ margin: 0 }}>{profile.canGenerate ? "Enabled" : "Preview code required"}</dd>
            </dl>
            <p className="micro">{profile.canGenerate
              ? "Generation remains subject to preview availability and limits."
              : "Redeem a preview code in the studio to enable generation."}</p>
            <p><Link className="button secondary small" href="/create">Open studio</Link></p>
            <button className="button secondary small" disabled={busy} onClick={() => void signOut(false)}>Sign out of this session</button>
          </section>
          <section className="controls-panel" aria-labelledby="account-sessions">
            <h2 id="account-sessions">Active sessions</h2>
            <p>These are your active browser sessions. Device names and locations are not collected. Tabs in the same browser may share a session.</p>
            <ul style={{ paddingLeft: "1.25rem" }}>
              {[...profile.sessions].sort((a, b) => Number(b.current) - Number(a.current)).map((session, index) => (
                <li key={session.id} style={{ marginBottom: "1rem", overflowWrap: "anywhere" }}>
                  <b>{session.current ? "This session" : `Other session ${index}`}</b>
                  <p className="micro">Expires <time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString("en-US")}</time></p>
                </li>
              ))}
            </ul>
            {!others && <p>No other active sessions.</p>}
            <button className="button secondary" disabled={busy || !others} onClick={() => void signOut(true)}>Sign out all other sessions</button>
            <p className="micro">Keeps this session signed in. Other sessions will need to sign in again. Your account and video history are kept.</p>
            <button className="button small secondary" disabled={busy} onClick={() => void load()}>Refresh sessions</button>
          </section>
        </div>
      )}
    </div>
  );
}
