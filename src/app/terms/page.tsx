import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Terms & credit offer", robots: { index: false } };
export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <h1>Terms & credit offer.</h1>
        <p>Updated October 23, 2026. The paid offer below is published in preparation for launch. Packs are not yet on sale.</p>
        <p>
          KakaReel is an independent, open-source AI video studio under
          development. Preview access is by invitation. It is not an official
          website of ByteDance, Kuaishou, or MiniMax.
        </p>
        <h2>Access and usage</h2>
        <p>
          Google sign-in creates a KakaReel account but does not grant
          generation credits. Redeem a valid preview code, or sign in from an
          existing invited guest session, to enable generation. Guest access
          remains available without a Google account. Preview generations use a
          limited project allowance, separate from purchased credits. Paid access must
          be selected explicitly and is subject to availability. Generation availability, speed, and output quality
          depend on the connected model provider. Limits may temporarily prevent
          new requests.
        </p>
        <h2>Starter Pack</h2>
        <p>
          One Starter Pack costs US$19 before applicable taxes and includes 150
          credits. It is a one-time purchase: no subscription, automatic renewal,
          or expiry date. Repeat purchases add another 150 credits each. Applicable
          tax and the final total will be shown before you confirm payment.
          Signing in or viewing this offer creates no purchase commitment.
        </p>
        <h2>Paid generation and credits</h2>
        <p>
          These rules apply to the paid offer when it opens. Credit cost depends
          on the model and settings. Review the quote before submitting; quotes
          are valid for five minutes for the inputs shown. Credits are reserved
          while a paid generation is in progress and consumed on successful
          delivery. Reserved credits cannot be spent on another generation.
          Some settings require more than the 150 credits included in one pack.
        </p>
        <p>
          A confirmed failed generation consumes no credits; its reservation is
          released. An unknown outcome is not a confirmed failure. Its reservation
          remains pending until the outcome is resolved, and it is not automatically
          regenerated. Check or recover the existing task before starting another.
          A normally delivered video that does not meet your aesthetic preferences
          does not qualify for an automatic credit return or refund.
        </p>
        <h2>Unused-pack refunds</h2>
        <p>
          A wholly unused pack is eligible for a refund within 14 days of purchase.
          The refund is the full amount actually paid, including applicable tax;
          KakaReel does not deduct an additional refund fee. Credits reserved for
          an unresolved generation must be resolved before unused-pack eligibility
          can be confirmed. A partially used pack is not eligible under this
          unused-pack policy. This does not limit rights provided by applicable law.
        </p>
        <p>
          Use the order in your account to request an eligible refund when paid
          access opens. A pending request is not a completed refund. Your order
          will show the confirmed status; payment-provider processing can take time.
          Do not submit a new payment to resolve a pending order.
        </p>
        <h2>Your content</h2>
        <p>
          Only upload material you have permission to use. Do not use the
          preview to impersonate people, exploit children, harass others, or
          create unlawful content. Provider restrictions also apply. This
          preview does not grant rights to third-party material or promise that
          every output can be used commercially.
        </p>
        <h2>Keep your results</h2>
        <p>
          Save completed videos promptly. Signing in with Google from a valid
          guest session transfers that session’s history to your account.
          Account history is retained across sign-outs and can be reopened with
          the same Google account. Signing out revokes your current session, not
          your stored history. Unclaimed guest history can become inaccessible
          when cookies are cleared or the guest session ends. History is not a
          permanent video archive: output links may expire and the preview may
          change during development.
        </p>
        <h2>Contact</h2>
        <p>
          For billing, refunds, account help, deletion requests, or a problem
          with a generation, email{" "}
          <a href="mailto:support@kakareel.com">support@kakareel.com</a>.
          For code issues, use the public GitHub repository, without posting
          private prompts, images, credentials, or result URLs.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
