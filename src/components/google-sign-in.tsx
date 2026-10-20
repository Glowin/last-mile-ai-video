"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { loadGoogleIdentity } from "@/lib/google-identity";

export function GoogleSignIn({
  onSignedIn,
}: {
  onSignedIn: () => Promise<void>;
}) {
  const target = useRef<HTMLDivElement>(null);
  const callback = useRef(onSignedIn);
  callback.current = onSignedIn;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    "loading" | "ready" | "pending" | "disabled" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true,
      submitting = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const container = target.current!;
    container.replaceChildren();
    setState("loading");
    (async () => {
      const { googleClientId } = await api("/config");
      if (!live) return;
      if (!googleClientId) {
        setState("disabled");
        return;
      }
      const google = await loadGoogleIdentity();
      if (!live) return;
      const { nonce } = await api("/auth/challenge", { method: "POST" });
      if (!live) return;
      google.initialize({
        client_id: googleClientId,
        nonce,
        auto_select: false,
        callback: async ({ credential }) => {
          if (!live || submitting) return;
          submitting = true;
          clearTimeout(expiry);
          setState("pending");
          container.replaceChildren();
          try {
            if (!credential)
              throw new Error(
                "Google did not return a credential. Please retry.",
              );
            await api("/auth/google", {
              method: "POST",
              body: JSON.stringify({ credential }),
            });
            if (live) await callback.current();
          } catch (error) {
            if (live) {
              setMessage((error as Error).message);
              setState("error");
            }
          } finally {
            submitting = false;
          }
        },
      });
      google.renderButton(container, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 260,
      });
      setState("ready");
      expiry = setTimeout(() => {
        if (live && !submitting) {
          container.replaceChildren();
          setMessage("Sign-in expired. Retry to get a fresh sign-in button.");
          setState("error");
        }
      }, 9 * 60_000);
    })().catch((error) => {
      if (live) {
        setMessage((error as Error).message);
        setState("error");
      }
    });
    return () => {
      live = false;
      clearTimeout(expiry);
      container.replaceChildren();
    };
  }, [attempt]);
  return (
    <div className="access-panel" aria-label="Google account sign-in">
      <b>Keep your videos with your account</b>
      <p>
        Sign in with Google. A preview code is still required to generate
        videos.
      </p>
      <div ref={target} />
      <div role="status" aria-live="polite">
        {state === "loading" && <p>Loading Google sign-in…</p>}
        {state === "pending" && <p>Signing you in…</p>}
        {state === "disabled" && (
          <>
            <button className="button small" disabled>
              Google sign-in unavailable
            </button>
            <p>
              Google sign-in is being set up. You can still use a preview code
              below.
            </p>
          </>
        )}
      </div>
      {state === "error" && (
        <>
          <p className="error-message" role="alert">
            {message}
          </p>
          <button
            className="button small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry Google sign-in
          </button>
        </>
      )}
    </div>
  );
}
