import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@/components/analytics";
import { GoogleAuthProvider } from "@/components/google-auth-provider";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "AI Video Generator — KakaReel",
    template: "%s — KakaReel",
  },
  icons: { icon: "/brand/kakapo-logo.png" },
  description:
    "Create videos from text and images with Seedance, Kling, and MiniMax in one independent studio. An open-source project built in public.",
  ...(process.env.APP_URL
    ? { metadataBase: new URL(process.env.APP_URL) }
    : {}),
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gaId = process.env.GA_MEASUREMENT_ID?.trim();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <GoogleAuthProvider>{children}</GoogleAuthProvider>
        {gaId && /^G-[A-Z0-9]+$/.test(gaId) && <Analytics measurementId={gaId} />}
      </body>
    </html>
  );
}
