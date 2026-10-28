import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Privacy", robots: { index: false } };
export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <span className="eyebrow">PRIVACY & DATA HANDLING</span>
        <h1>Your <em>data.</em></h1>
        <p className="lead">This page describes the preview and preparation for paid access, updated October 28, 2026.</p>
        <h2>What the studio stores</h2>
        <p>
          You can use an invite code as a guest or sign in with Google. For
          Google accounts, we store your Google account identifier, verified
          email address, display name, and invitation status in KakaReel’s own
          database. We do not receive your Google password or request access to
          Gmail, Drive, or other Google account content. Google processes the
          sign-in through its Identity Services.
        </p>
        <p>
          While you are signed out of KakaReel, pages may load Google Identity
          Services to offer One Tap and the official Google sign-in button.
          Google and your browser determine which account choices or prompts
          are available. We remember dismissal of our sign-in card in this
          tab’s session storage; it contains no Google credentials. You can
          reopen sign-in from the page header or your account page.
        </p>
        <h2>Age confirmation</h2>
        <p>
          KakaReel is for adults aged 18 or older. We ask for your date of birth
          and an explicit declaration when age confirmation is required. The
          server checks your eligibility without saving your full date of birth;
          it stores the confirmation time and policy version for your account or
          guest session. This is a self-declaration, not identity or document
          verification. We do not send this information to Analytics.
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
          the submission payload to recover interrupted requests. It removes that
          operational copy after the provider accepts or definitively rejects the
          job, but a separate content-review record can retain the prompt,
          settings and uploaded image. Do not upload confidential material or
          unnecessary personal data.
        </p>
        <h2>Content review and reports</h2>
        <p>
          KakaReel's founder may inspect prompts, uploaded images and generated
          videos to review content before submission or delivery and investigate
          reports. We retain review snapshots, result references, content hashes,
          decisions and audit records. Support reports are handled privately;
          internal records may refer to your support email and affected task.
          These records do not have an automatic deletion schedule. See our
          {" "}<a href="/acceptable-use">acceptable-use policy</a> or
          {" "}<a href="/support">contact support</a> to ask about a decision or
          request deletion.
        </p>
        <h2>History and result retention</h2>
        <p>
          Automatic retention periods and self-service deletion are not
          implemented yet. Account details, session security records, and
          generation history are retained until deletion is arranged. For
          privacy questions or deletion requests, email{" "}
          <a href="mailto:support@kakareel.com">support@kakareel.com</a>.
          Do not post personal information
          or credentials in a public issue. Provider retention is governed
          separately by its policies. Download completed videos promptly;
          provider links may expire.
        </p>
        <h2>Orders, credits and payments</h2>
        <p>
          Packs are not yet on sale. When paid access opens, we will retain order
          identifiers, purchased credits, prices, tax and payment amounts, payment
          and refund status, and credit reservations and usage linked to your
          account. These records help reconcile payments and resolve billing
          questions. Sandbox transactions are labeled as tests and kept separate
          from your purchased-credit balance.
        </p>
        <p>
          Checkout will direct you to the available payment provider. Payment
          details are collected by that provider, not in the studio's video
          prompt or account forms. Do not send payment credentials through
          prompts, public issues, or support messages. Order and payment records
          may need to be retained to meet accounting and legal obligations even
          if you request account deletion.
        </p>
        <h2>Fonts and session recording</h2>
        <p>
          KakaReel serves its site font from its own domain, without calling an
          external font service. We do not use session replay, screen recordings,
          keystroke recordings, or form-content recordings. Google sign-in is a
          separate Google-hosted service and may load its own interface assets.
        </p>
        <h2>Analytics and requests</h2>
        <p>
          If you choose “Allow analytics”, we load Google Analytics to measure
          page visits, referral sites, device information, and engagement. Google
          uses analytics cookies to distinguish browsers. We do not load the
          analytics tag before you agree. You can reject analytics or change your
          choice using Cookie settings in the footer. Your choice is stored in
          this browser. Withdrawing consent removes our analytics cookies and
          stops further collection; it does not delete previously collected data.
        </p>
        <p>
          We do not send your prompts, uploaded images, email address, account
          identifier, or payment details to Analytics. Page addresses exclude
          query strings and fragments, except campaign tags (utm_ parameters)
          from the link you arrived on, and referral addresses are limited to
          their origin. With your consent we also send event counts for
          sign-up, video generation (model, mode, length, credits; never the
          prompt), checkout start and completed purchases (order number, amount,
          currency and product). Purchases are reported from our server and
          linked to the Analytics browser and session IDs captured at checkout
          only if you allowed analytics in that browser. An HttpOnly cookie
          (kr_analytics_consent, up to 90 days) lets you withdraw that browser’s
          permission even after signing out. Once withdrawal is confirmed, we
          remove its purchase analytics links; a failed request shows a retry
          message. A different device’s permission does not apply to your order.
          Automatic form, search, outbound link, and video tracking
          are disabled. Advertising personalization and Google signals are not
          enabled by our tag. See <a href="https://policies.google.com/privacy">Google’s Privacy Policy</a>.
          Hosting and model providers may retain operational logs.
        </p>
        <h2>How you found us</h2>
        <p>
          Unless you have rejected analytics, we keep a small first-party cookie
          (kr_ft, up to 90 days) with how you first arrived: campaign tags,
          a referral code, the referring site&apos;s domain, the first page, and
          whether an ad click tag was present (not its value). It contains no
          identifier and is not sent to Google or other third parties. When you
          create an account, we store this with your account in our own database
          to count sign-ups, usage and purchases by marketing channel in
          aggregate. Rejecting analytics deletes the cookie and stops this.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
