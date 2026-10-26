import type { Metadata } from "next";
import { BillingReturnPanel } from "@/components/billing-return-panel";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import styles from "@/components/pricing.module.css";

export const metadata: Metadata = {
  title: "Order status",
  description: "Check the status of a KakaReel order in your signed-in account.",
  alternates: { canonical: "https://kakareel.com/billing/return" },
  robots: { index: false, follow: false, noarchive: true },
  referrer: "same-origin",
  openGraph: {
    type: "website",
    siteName: "KakaReel",
    locale: "en_US",
    url: "https://kakareel.com/billing/return",
    title: "Order status — KakaReel",
    description: "Check an order in your signed-in KakaReel account.",
    images: [{ url: "https://kakareel.com/brand/kakapo-logo.png", alt: "KakaReel kakapo logo" }],
  },
  twitter: {
    card: "summary",
    title: "Order status — KakaReel",
    description: "Check an order in your signed-in KakaReel account.",
    images: [{ url: "https://kakareel.com/brand/kakapo-logo.png", alt: "KakaReel kakapo logo" }],
  },
};

export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Only the order reference is passed through. Redirect status is not evidence.
  const orderId = typeof params.orderId === "string" ? params.orderId : null;
  return (
    <>
      <SiteHeader />
      <main id="main" className={`shell ${styles.returnPage}`}>
        <span className={styles.eyebrow}>YOUR KAKAREEL ORDER</span>
        <h1>Check your <em>order.</em></h1>
        <p className={styles.lead}>View the latest recorded status in the account used for your order.</p>
        <BillingReturnPanel key={orderId} orderId={orderId} />
      </main>
      <SiteFooter />
    </>
  );
}
