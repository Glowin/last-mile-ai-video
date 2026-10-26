"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useGoogleAuth } from "./google-auth-provider";
import { AgeDeclarationFields } from "./age-declaration-fields";
import { emptyAgeDeclaration } from "@/lib/age-declaration";

// All placements register with the same controller. They never initialize GIS
// or issue challenges, even when both the floating and inline buttons exist.
export function GoogleSignIn({ compact = false }: { compact?: boolean }) {
  const { controller, state } = useGoogleAuth();
  const target = useRef<HTMLDivElement>(null);
  const signedIn = state.phase === "signed-in";
  useEffect(() => {
    if (target.current) return controller.button(target.current);
  }, [controller, signedIn]);
  if (state.phase === "signed-in") return null;
  return (
    <div className={compact ? "google-signin-content" : "access-panel"} aria-label="Google account sign-in">
      {!compact && <><b>Keep your videos with your account</b><p>Sign in with Google. A preview code is still required to generate videos.</p></>}
      <div ref={target} className="google-signin-button" />
      {state.phase === "age-required" && (compact ? <GoogleAgeConfirmation /> :
        <button type="button" className="button small secondary" onClick={controller.open}>Complete age confirmation</button>)}
      <div role="status" aria-live="polite">
        {["checking", "loading"].includes(state.phase) && <p>Loading Google sign-in…</p>}
        {state.phase === "pending" && <p>Signing you in…</p>}
        {state.phase === "disabled" && <p>Google sign-in is currently unavailable.</p>}
      </div>
      {state.phase === "error" && <p className="error-message" role="alert">{state.message}</p>}
      {["error", "disabled"].includes(state.phase) && <div className="google-signin-recovery">
        <button type="button" className="button small secondary" onClick={controller.retry}>Retry Google sign-in</button>
        <Link href="/account">Open account page</Link>
      </div>}
    </div>
  );
}

function GoogleAgeConfirmation() {
  const { controller, state } = useGoogleAuth();
  const [age, setAge] = useState(emptyAgeDeclaration);
  return <form onSubmit={(event) => { event.preventDefault(); void controller.confirmAge(age); setAge(emptyAgeDeclaration()); }}>
    <AgeDeclarationFields value={age} onChange={setAge} />
    {state.message && <p className="error-message" role="alert">{state.message}</p>}
    <button type="submit" className="button small" disabled={!age.birthDate || !age.confirmed}>Confirm and continue</button>
  </form>;
}
