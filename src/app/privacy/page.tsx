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
          You can use an invite code as a guest or sign in with Google. For
          Google accounts, we store your Google account identifier, verified
          email address, display name, and invitation status in KakaReel’s own
          database. We do not receive your Google password or request access to
          Gmail, Drive, or other Google account content. Google processes the
          sign-in through its Identity Services.
        </p>
        <h2>Essential cookies and sessions</h2>
        <p>
          We use essential HttpOnly cookies for guest access, account sessions,
          and sign-in security. These cookies are unavailable to page
          JavaScript; production cookies are sent over HTTPS. Account access
          tokens last 10 minutes and refresh sessions last up to 30 days.
          Refresh tokens are rotated, and only their hashes are stored. Signing
          out revokes the current session; it does not delete your account or
          generation history.
        </p>
        <h2>Your generation history</h2>
        <p>
          We store prompts, settings, task status, timestamps, and result links.
          Guest history belongs to the signed browser session. Signing in with
          Google while that guest session is valid transfers its history and
          preview access to your account once. Account history remains available
          when you sign back in with the same Google account. Clearing guest
          cookies or ending an unclaimed guest session removes your access to
          its history; it does not delete the database records.
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
          implemented yet. Account details, session security records, and
          generation history are retained until deletion is arranged. Ask the
          project owner through your preview invitation channel to request
          deletion. If you do not have that contact, open a repository issue
          asking for a private contact method. Do not post personal information
          or credentials in a public issue. Provider retention is governed
          separately by its policies. Download completed videos promptly;
          provider links may expire.
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
