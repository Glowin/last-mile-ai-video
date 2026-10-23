import { AnalyticsSettings } from "./analytics";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HeaderAccount } from "./google-auth-provider";
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <Image src="/brand/kakapo-logo.png" width={36} height={36} alt="" />
        <span>
          KakaReel<span className="brand-dot">.</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#models">Models</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/build">Built in public</Link>
      </nav>
      <div className="site-header-actions">
        <HeaderAccount />
        <Link className="button small" href="/create">
          Open studio <ArrowUpRight size={16} />
        </Link>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="brand" href="/">
        KakaReel
      </Link>
      <span>An independent, open-source video studio.</span>
      <div>
        <Link href="/pricing">Pricing</Link>
        <Link href="/account">Account</Link>
        <Link href="/privacy">Privacy</Link>
        {process.env.GA_MEASUREMENT_ID && <AnalyticsSettings />}
        <Link href="/terms">Terms</Link>
        <a
          href="https://github.com/Glowin/last-mile-ai-video"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </div>
    </footer>
  );
}
