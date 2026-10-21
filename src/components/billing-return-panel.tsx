"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api, IDENTITY_CHANGED_KEY, SESSION_ENDED } from "@/lib/api";
import type { BillingOrder, BillingOrderResponse, BillingOrderStatus } from "@/lib/billing";
import styles from "./pricing.module.css";

type DisplayOrder = Pick<BillingOrder, "id" | "status" | "environment" | "productName" | "credits">;
type View =
  | { kind: "loading" | "missing" | "signed-out" | "error" }
  | { kind: "ready"; order: DisplayOrder };

const statuses: Record<BillingOrderStatus, { title: string; message: string }> = {
  pending: { title: "Awaiting payment confirmation", message: "There is no confirmed payment for this order yet. If you just paid, check again shortly. Avoid starting another payment while the result is unclear." },
  paid: { title: "Payment recorded", message: "This order is marked paid. Generation remains subject to the access and availability shown in the studio." },
  failed: { title: "Payment not completed", message: "This order is marked failed. If your payment account shows a charge, keep that receipt and check this order again before attempting another payment." },
  canceled: { title: "Order canceled", message: "This order is marked canceled. If you believe a payment went through, keep your receipt and check the status again." },
  refunded: { title: "Refund recorded", message: "This order is marked refunded. Check your payment account for the returned funds; arrival times can vary." },
};

function identityMarker() {
  try { return localStorage.getItem(IDENTITY_CHANGED_KEY); }
  catch { return null; }
}

// Validate the fields rendered here; unexpected responses never become success UI.
function displayOrder(data: BillingOrderResponse, expectedId: string): DisplayOrder {
  const order = data?.order;
  if (!order || order.id !== expectedId ||
      !Object.hasOwn(statuses, order.status) ||
      !["test", "live"].includes(order.environment) ||
      typeof order.productName !== "string" || !order.productName.trim() ||
      !Number.isSafeInteger(order.credits) || order.credits < 0) {
    throw new Error("Order details are unavailable.");
  }
  return order;
}

export function BillingReturnPanel({ orderId }: { orderId: string | null }) {
  const validId = !!orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
  const [view, setView] = useState<View>({ kind: validId ? "loading" : "missing" });
  const version = useRef(0);
  const flight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const current = ++version.current;
    flight.current?.abort();
    if (!validId || !orderId) {
      setView({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    flight.current = controller;
    const marker = identityMarker();
    setView({ kind: "loading" });
    try {
      const session = await api("/session", { signal: controller.signal });
      if (current !== version.current) return;
      if (!session.user?.id) {
        setView({ kind: "signed-out" });
        return;
      }
      const response: BillingOrderResponse = await api(`/billing/orders/${encodeURIComponent(orderId)}`, {
        signal: controller.signal,
        headers: { "X-KakaReel-Owner": session.user.id },
      });
      if (current !== version.current) return;
      if (marker !== identityMarker()) {
        setView({ kind: "error" });
        return;
      }
      setView({ kind: "ready", order: displayOrder(response, orderId) });
    } catch {
      if (current === version.current) setView({ kind: "error" });
    }
  }, [orderId, validId]);

  useEffect(() => {
    const ended = () => {
      version.current++;
      flight.current?.abort();
      setView({ kind: "signed-out" });
    };
    const changed = (event: StorageEvent) => {
      if (event.key === IDENTITY_CHANGED_KEY || event.key === null) void load();
    };
    const visible = () => { if (!document.hidden) void load(); };
    // No payment writes and no background polling. Recheck on return or request.
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => {
      version.current++;
      flight.current?.abort();
      window.removeEventListener(SESSION_ENDED, ended);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  return (
    <section className={styles.returnCard} aria-label="Order lookup" aria-busy={view.kind === "loading"}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {view.kind === "loading" && <><h2>Checking your order…</h2><p>Looking up the order in your signed-in account.</p></>}
        {view.kind === "missing" && <><h2>No order selected</h2><p>Open the original return link to check an order. Visiting this page does not confirm a payment. Paid checkout is not currently open.</p></>}
        {view.kind === "signed-out" && <><h2>Sign in to check your order</h2><p>Use the Google account associated with your order. A preview-code session cannot view account orders. After signing in, return here and check again.</p></>}
        {view.kind === "error" && <><h2>We could not check this order</h2><p>Make sure you are signed in to the account used for the order, then try again. The order may be unavailable, or the service may be temporarily unreachable. This does not confirm or rule out a payment.</p></>}
        {view.kind === "ready" && (
          <>
            {view.order.environment === "test" && <p className={styles.testNotice}><strong>Test order.</strong> This is not a real payment and does not provide credits for live generation.</p>}
            <h2>{view.order.environment === "test" ? `Test order: ${view.order.status}` : statuses[view.order.status].title}</h2>
            <p>{view.order.environment === "test" ? "This status belongs to a test order only." : statuses[view.order.status].message}</p>
            <dl className={styles.orderDetails}>
              <div><dt>Pack</dt><dd>{view.order.productName}</dd></div>
              <div><dt>Pack size</dt><dd>{view.order.credits.toLocaleString("en-US")} {view.order.environment === "test" ? "test credits" : "credits"}</dd></div>
              <div><dt>Order reference</dt><dd>{view.order.id}</dd></div>
            </dl>
            <p className={styles.small}>Pack size is the quantity on this order, not your remaining balance.</p>
          </>
        )}
      </div>
      <div className={styles.returnActions}>
        {validId && <button type="button" className={styles.secondaryButton} disabled={view.kind === "loading"} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />Check again</button>}
        <Link className={styles.primaryButton} href="/account">{view.kind === "signed-out" ? "Sign in with Google" : "Your account"}<ArrowUpRight size={17} aria-hidden="true" /></Link>
        <Link className={styles.inlineLink} href="/create">Open studio <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>
      <p className={styles.small}>Order status is read from your account. Returning to this page does not complete a payment or add credits.</p>
    </section>
  );
}
