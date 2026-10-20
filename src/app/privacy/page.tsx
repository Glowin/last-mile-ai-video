import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Preview privacy", robots: { index: false } };
export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <h1>Your preview data.</h1>
        <p>This page describes the early preview, updated October 20, 2026.</p>
        <h2>What the studio stores</h2>
        <p>
          The app uses an essential, signed browser cookie to associate your
          generation history with this browser. It stores prompts, settings,
          task status, timestamps, and result links in the project database.
          Clearing cookies or ending the session removes your access to that
          history; it does not delete the database records.
        </p>
        <h2>Where your input goes</h2>
        <p>
          Generating a video sends your prompt, settings, and optional image to
          VibeToken and its upstream model provider. The app temporarily stores
          the submission payload to recover interrupted requests, then removes
          that payload after the provider accepts or definitively rejects the
          job. Do not upload confidential material or personal data during this
          preview.
        </p>
        <h2>History and result retention</h2>
        <p>
          Automatic retention periods and self-service deletion are not
          implemented yet. Ask the project owner through the channel where you
          received your preview code for deletion of your project records.
          Provider retention is governed separately by its policies. Download
          completed videos promptly; provider links may expire.
        </p>
        <h2>Analytics and requests</h2>
        <p>
          The app does not include advertising or analytics SDKs. Hosting and
          model providers may retain operational logs. There is no payment
          information collection in this preview.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
