import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Terms & credit offer", robots: { index: false } };
export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <h1>Terms & credit offer.</h1>
        <p>Updated October 25, 2026. The paid offer below is published in preparation for launch. Packs are not yet on sale.</p>
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
        <h2>Content review</h2>
        <p>
          Our <a href="/acceptable-use">acceptable-use policy</a> applies to
          prompts, uploads and outputs. A request or video may wait for human
          review. Credits remain reserved before delivery; a rejected or expired
          pre-delivery review releases the reservation after an operator records
          the decision. A review deadline does not release credits automatically. Review decisions and
          unresolved model outcomes are separate. Contact
          {" "}<a href="/support">support</a> to report content or appeal a decision.
        </p>
        <h2>Violations and access restrictions</h2>
        <p>
          If a request violates our acceptable-use policy, we may warn you,
          hold or reject the request, or withhold its result. Serious or repeated
          violations, fraud, attempts to bypass review, or a legal requirement
          may lead us to decline further generation requests during human review. These decisions are
          made through human review; contact support to ask for the reason or
          request reconsideration.
        </p>
        <p>
          A restriction does not automatically delete your account or forfeit
          unused purchased credits. Undelivered tasks and reserved credits are
          resolved under the generation and review rules above. An unknown
          supplier outcome remains subject to investigation. Refund requests
          remain subject to the unused-pack policy and any applicable statutory
          rights. Contact support if a restriction prevents you from accessing
          your order. Privacy or deletion requests are handled separately under
          our <a href="/privacy">privacy policy</a>.
        </p>
        <h2>Service limitations and responsibility</h2>
        <p>
          To the extent permitted by applicable law, the service is provided
          as is and as available. We do not guarantee uninterrupted availability,
          error-free operation, a particular visual result, or suitability for a
          particular purpose. Outputs are AI-generated and may be inaccurate,
          resemble other outputs, or involve third-party rights. Review a video
          and the rights needed for your intended use before publishing it;
          generation alone does not guarantee that commercial use is permitted.
        </p>
        <p>
          To the extent permitted by applicable law, KakaReel is not responsible
          for indirect or consequential business losses, such as lost profits
          from reliance on a generated video. This does not exclude or limit
          liability that cannot lawfully be excluded or limited, including
          liability for fraud or intentional misconduct. It does not reduce
          our delivery, credit-release or refund commitments, or your statutory
          consumer rights. Billing and service problems can be reported to
          <a href="mailto:support@kakareel.com"> support@kakareel.com</a>.
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
