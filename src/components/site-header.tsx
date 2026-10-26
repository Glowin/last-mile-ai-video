import { AnalyticsSettings } from "./analytics";
import Image from "next/image";
import Link from "next/link";
import { HomeLink } from "./home-link";
import { ArrowUpRight } from "lucide-react";
import { HeaderAccount } from "./google-auth-provider";
export function SiteHeader() {
  return (
    <header className="site-header">
      <HomeLink className="brand">
        <Image src="/brand/kakapo-logo.png" width={36} height={36} alt="" />
        <span>
          KakaReel<span className="brand-dot">.</span>
        </span>
      </HomeLink>
      <nav aria-label="Main navigation">
        <a href="/#models">Models</a>
        <a href="/pricing#access-options">Pricing</a>
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
      <div className="footer-brand">
        <HomeLink className="brand">
          <span>
            KakaReel<span className="brand-dot">.</span>
          </span>
        </HomeLink>
        <span>An independent, open-source video studio.</span>
      </div>
      <div className="footer-links">
        <a href="/pricing#access-options">Pricing</a>
        <Link href="/account">Account</Link>
        <Link href="/privacy">Privacy</Link>
        {process.env.GA_MEASUREMENT_ID && <AnalyticsSettings />}
        <Link href="/terms">Terms</Link>
        <Link href="/acceptable-use">Acceptable use</Link>
        <Link href="/support">Support</Link>
        <a href="mailto:support@kakareel.com">support@kakareel.com</a>
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
