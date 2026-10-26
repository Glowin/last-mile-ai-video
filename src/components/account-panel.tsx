"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, prepareStarterCheckout, starterCheckoutEnvironment, starterCheckoutProvider, billingMoney, IDENTITY_CHANGED_KEY, SESSION_ENDED, IDENTITY_CHANGED_EVENT } from "@/lib/api";
import { GoogleSignIn } from "./google-sign-in";
import type { BillingCatalogResponse, BillingSummaryResponse, BillingOrder, BillingOrdersResponse, BillingRefundStatus } from "@/lib/billing";
import styles from "./pricing.module.css";

const refundLabel: Record<BillingRefundStatus, string> = {
  none: "Not requested", submitting: "Request being submitted", pending: "Pending confirmation",
  processing: "Processing", unknown: "Outcome unconfirmed", rejected: "Request rejected",
  failed: "Request failed", succeeded: "Refund confirmed", review_required: "Review required",
};
type CreditSummary = BillingSummaryResponse;
type CreditOrder = BillingOrder;

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
  const [billing, setBilling] = useState<CreditSummary | null>(null);
  const [orders, setOrders] = useState<CreditOrder[]>([]);
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [billingError, setBillingError] = useState("");
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
    setBilling(null);
    setOrders([]);
    setCatalog(null);
    setBillingError("");
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
      try {
        const headers = { "X-KakaReel-Owner": data.user.id };
        const [summary, history, available]: [CreditSummary, BillingOrdersResponse, BillingCatalogResponse] = await Promise.all([
          api("/billing", { headers }), api("/billing/orders", { headers }), api("/billing/catalog"),
        ]);
        if (version !== epoch.current) return;
        setBilling(summary);
        setOrders(history.orders);
        setCatalog(available);
      } catch (cause) {
        if (version === epoch.current) setBillingError((cause as Error).message);
      }
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
      setBilling(null);
      setOrders([]);
      setCatalog(null);
      setBillingError("");
      setState("signed-out");
      setMessage("");
      setError("Your session has ended. Please sign in again.");
    };
    const changed = (event: StorageEvent) => {
      if (event.key === IDENTITY_CHANGED_KEY || event.key === null) void load();
    };
    const localChanged = () => { void load(); };
    const visible = () => {
      // Returning from the Google popup must not unmount its sign-in callback.
      if (!document.hidden && !pending.current && hasProfile.current) void load();
    };
    void load();
    const timer = setInterval(visible, 5 * 60_000);
    window.addEventListener(IDENTITY_CHANGED_EVENT, localChanged);
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener(IDENTITY_CHANGED_EVENT, localChanged);
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

  async function billingAction(action: "checkout" | "refund", orderId?: string) {
    if (!profile || pending.current) return;
    if (displayedMarker.current !== identityMarker()) { await load(); return; }
    const owner = profile.user.id;
    const version = epoch.current;
    const headers = { "X-KakaReel-Owner": owner };
    pending.current = true;
    setBusy(true);
    setMessage("");
    setBillingError("");
    try {
      if (action === "checkout") {
        const result = await prepareStarterCheckout(owner);
        if (version !== epoch.current || displayedMarker.current !== identityMarker()) return;
        window.location.assign(result.checkoutUrl);
      } else {
        await api(`/billing/orders/${encodeURIComponent(orderId!)}/refund`, { method: "POST", headers, body: JSON.stringify({}) });
        if (version !== epoch.current) return;
        await load("Refund request received. Review the current order status below; a request is not confirmation that funds have been returned.");
      }
    } catch (cause) {
      if (version === epoch.current) setBillingError((cause as Error).message);
    } finally {
      if (version === epoch.current) { pending.current = false; setBusy(false); }
    }
  }

  const testCheckout = starterCheckoutEnvironment(catalog) === "test";
  const others = profile?.sessions.filter((session) => !session.current).length ?? 0;
  return (
    <div aria-busy={state === "loading" || busy}>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div role="status" aria-live="polite">
        {state === "loading" && <p>Loading your account…</p>}
        {message && <p>{message}</p>}
        {busy && <p>Working…</p>}
      </div>
      {state === "error" && (
        <button className="button secondary" onClick={() => void load()}>Retry account details</button>
      )}
      {state === "signed-out" && (
        <section className="controls-panel" aria-labelledby="account-sign-in">
          <h2 id="account-sign-in">Sign in to manage your account</h2>
          <p>Use your Google account to view your profile and manage active sessions.</p>
          <GoogleSignIn />
          <p><Link href="/create">Open the studio to use a preview code</Link></p>
        </section>
      )}
      {state === "ready" && profile && (
        <>
        <section className="controls-panel account-section" aria-labelledby="account-credits">
          <h2 id="account-credits">Credits & orders</h2>
          {billingError && <p className="error-message" role="alert">{billingError}</p>}
          {!billing && <p>Credit balance is not available yet. Refresh to check again.</p>}
          <div className="wallet-grid">
            {billing && <>
              <div className="wallet-stat wallet-stat-primary">
                <span className="eyebrow">AVAILABLE BALANCE</span>
                <p className={styles.balance}><strong>{billing.availableCredits ?? "—"}</strong> available credits</p>
                <p className="micro">Purchased credits do not expire. Preview allowance is separate.</p>
              </div>
              <div className="wallet-stat">
                <span className="eyebrow">ACTIVE RESERVATIONS</span>
                <p><strong>{billing.reservedCredits ?? "—"}</strong> credits reserved for pending generations.</p>
                {!billing.generationChargingEnabled && <p className="micro">Paid generation is not yet available. Preview access is separate.</p>}
              </div>
            </>}
            <div className="wallet-stat">
              <span className="eyebrow">PUBLISHED OFFER</span>
              <p><strong>Starter Pack · US$19 + applicable taxes · 150 credits</strong><br />One-time purchase · No expiry · No automatic renewal</p>
            </div>
          </div>
          {billing?.blocked && <p className="error-message" role="alert">Credit spending is blocked. Review pending orders and refunds before generating.</p>}
          {billing && (testCheckout || billing.testBalanceCredits > 0 || billing.testReservedCredits > 0 || billing.testBlocked) &&
            <p className={styles.testNotice}>Sandbox only: {billing.testAvailableCredits ?? "—"} available / {billing.testReservedCredits ?? "—"} reserved test credits. These are not purchased credits.{billing.testBlocked ? " Test credit spending is blocked." : ""}</p>}
          <p className="micro">Buy again to add credits. A wholly unused pack is refundable within 14 days, including tax, with no additional KakaReel fee. Review the final tax and total before payment.</p>
          {testCheckout && <p className={styles.testNotice}><strong>Test mode · No real payment</strong><br />This checkout is a sandbox test. The Starter Pack is not yet on sale. Test credits cannot be used for live generation.</p>}
          <div className="account-actions">
            <button className="button" disabled={busy || !starterCheckoutProvider(catalog)} onClick={() => void billingAction("checkout")}>
              {testCheckout ? "Continue to test checkout" : starterCheckoutProvider(catalog) ? "Continue to checkout" : "Not yet on sale"}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => void load()}>Refresh balance & orders</button>
          </div>
          <p><a href="/pricing#access-options">View pricing</a> · <Link href="/terms">Offer & refund terms</Link></p>
          <h3>Your orders</h3>
          {billing && !orders.length && <p>No orders yet.</p>}
          <ul className={styles.orderList}>
            {orders.map((order) => <li key={order.id} className={styles.orderCard}>
              <h3>{order.productName} · {order.credits} credits</h3>
              {order.environment === "test" && <p className={styles.testNotice}>Test mode · No real payment</p>}
              <p><strong>Status: {order.status}</strong>{order.refundStatus !== "none" && <> · Refund: {refundLabel[order.refundStatus]}</>}</p>
              {order.reviewRequired && <p role="status">This order needs review. Do not start another payment to resolve it.</p>}
              {order.status === "pending" && <p>Payment is not confirmed. Refresh this order before starting another checkout.</p>}
              <dl className={styles.orderDetails}>
                <div><dt>Order</dt><dd>{order.id}</dd></div>
                <div><dt>Created</dt><dd><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("en-US")}</time></dd></div>
                <div><dt>Before tax</dt><dd>{billingMoney(order.subtotalMinor, order.currency)}</dd></div>
                <div><dt>Tax</dt><dd>{billingMoney(order.taxMinor, order.currency)}</dd></div>
                <div><dt>Total</dt><dd>{billingMoney(order.totalMinor, order.currency)}</dd></div>
                <div><dt>Amount paid</dt><dd>{billingMoney(order.paidAmountMinor, order.currency)}</dd></div>
              </dl>
              <div className="account-actions">
                <Link className="button secondary small" href={`/billing/return?orderId=${encodeURIComponent(order.id)}`}>Check order status</Link>
                {order.status === "paid" && <button className="button secondary small" disabled={busy || !["none", "failed", "rejected"].includes(order.refundStatus)}
                  onClick={() => { if (confirm("Request a refund for this wholly unused pack? Eligibility and the amount actually paid will be checked. A pending request is not a completed refund.")) void billingAction("refund", order.id); }}>Request unused-pack refund</button>}
              </div>
            </li>)}
          </ul>
        </section>
        <div className="workspace">
          <section className="controls-panel" aria-labelledby="account-profile">
            <h2 id="account-profile">Profile</h2>
            <dl className="account-dl">
              <dt className="field-label">Name</dt>
              <dd>{profile.user.name || "Not provided"}</dd>
              <dt className="field-label">Google email</dt>
              <dd>{profile.user.email}</dd>
              <dt className="field-label">Account created</dt>
              <dd><time dateTime={profile.user.createdAt}>{new Date(profile.user.createdAt).toLocaleString("en-US")}</time></dd>
              <dt className="field-label">Preview access</dt>
              <dd>{profile.canGenerate ? "Enabled" : "Preview code required"}</dd>
            </dl>
            <p className="micro">{profile.canGenerate
              ? "Generation remains subject to preview availability and limits."
              : "Redeem a preview code in the studio to enable generation."}</p>
            <div className="account-actions">
              <Link className="button secondary small" href="/create">Open studio</Link>
              <button className="button secondary small" disabled={busy} onClick={() => void signOut(false)}>Sign out of this session</button>
            </div>
          </section>
          <section className="controls-panel" aria-labelledby="account-sessions">
            <h2 id="account-sessions">Active sessions</h2>
            <p>These are your active browser sessions. Device names and locations are not collected. Tabs in the same browser may share a session.</p>
            <ul className="session-list">
              {[...profile.sessions].sort((a, b) => Number(b.current) - Number(a.current)).map((session, index) => (
                <li key={session.id}>
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
        </>
      )}
      <p className="micro">For billing, refunds, or account help, email <a href="mailto:support@kakareel.com">support@kakareel.com</a>.</p>
    </div>
  );
}
