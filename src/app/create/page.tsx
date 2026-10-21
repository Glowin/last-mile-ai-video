import type { Metadata } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio";

const title = "AI Video Studio: Create Text & Image Videos | KakaReel";
const description =
  "Create AI videos from text or an image with Seedance, Kling, and MiniMax in KakaReel. Choose your video settings, preview results, and revisit your history.";
const canonical = "https://kakareel.com/create";
const socialImage = {
  url: "https://kakareel.com/brand/kakapo-logo.png",
  width: 1254,
  height: 1254,
  alt: "KakaReel kakapo logo",
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical },
  // The workspace stays out of search; metadata also supports shared links.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: canonical,
    siteName: "KakaReel",
    locale: "en_US",
    title,
    description,
    images: [socialImage],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: [socialImage],
  },
};
export default function Create() {
  return (
    <Suspense
      fallback={
        <main id="main" className="shell section">
          Opening the studio…
        </main>
      }
    >
      <Studio />
    </Suspense>
  );
}
