import type { Metadata } from "next";
import { AccountPanel } from "@/components/account-panel";
import { SiteHeader, SiteFooter } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell studio-content">
        <div className="studio-title">
          <div>
            <span className="eyebrow">YOUR KAKAREEL ACCOUNT</span>
            <h1>Your account.</h1>
          </div>
        </div>
        <AccountPanel />
      </main>
      <SiteFooter />
    </>
  );
}
