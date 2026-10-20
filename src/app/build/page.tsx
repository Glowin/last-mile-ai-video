import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = {
  title: "Built in public",
  alternates: { canonical: "/build" },
};
export default function Build() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <span className="eyebrow">THE LAST MILE PROJECT</span>
        <h1>
          From an idea
          <br />
          to the first $100.
        </h1>
        <p>
          This studio is being built in public: research the problem, build the
          product, launch it, find the first paying customer, and work toward
          US$100 in revenue.
        </p>
        <h2>The current chapter</h2>
        <p>
          An early video studio for text-to-video and image-to-video, with
          adapters for Seedance 2.5, Kling 3.0, and MiniMax H3 through
          VibeToken. The website is being prepared for an invite-only demo;
          actual provider access depends on runtime configuration and
          verification.
        </p>
        <p>
          No paid customers or revenue milestone is claimed. Public pricing and
          checkout are still to come.
        </p>
        <h2>Open source from the start</h2>
        <p>
          The application code and research are available on GitHub under the
          MIT license. Model inference is a separate, paid API service; the
          license does not include model weights or free inference.
        </p>
        <div className="actions">
          <a
            className="button"
            href="https://github.com/Glowin/last-mile-ai-video"
          >
            Explore the source ↗
          </a>
          <Link className="text-link" href="/create">
            Visit the studio →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
