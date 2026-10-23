import type { Metadata } from "next";
import { PricingPanel } from "@/components/pricing-panel";
import { SiteFooter, SiteHeader } from "@/components/site-header";

const title = "150 AI Video Credits for US$19 + Tax | KakaReel";

const description =
  "Starter Pack: 150 AI video credits for US$19 plus applicable taxes. One-time purchase, no expiry or automatic renewal. Published offer; not yet on sale.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "https://kakareel.com/pricing" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "KakaReel",
    url: "https://kakareel.com/pricing",
    title,
    description,
    images: [{
      url: "https://kakareel.com/brand/kakapo-mascot.png",
      width: 1296,
      height: 1184,
      alt: "KakaReel's moss-green kakapo mascot",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [{
      url: "https://kakareel.com/brand/kakapo-mascot.png",
      alt: "KakaReel's moss-green kakapo mascot",
    }],
  },
};

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main"><PricingPanel /></main>
      <SiteFooter />
    </>
  );
}
