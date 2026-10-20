import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { title: "Preview terms", robots: { index: false } };
export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell prose">
        <h1>About this preview.</h1>
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
          limited project allowance. There is currently no checkout or paid
          subscription. Generation availability, speed, and output quality
          depend on the connected model provider. Limits may temporarily prevent
          new requests.
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
          For access, deletion requests, or a problem with a generation, contact
          the project owner through the channel where you received your code.
          For code issues, use the public GitHub repository, without posting
          private prompts, images, credentials, or result URLs.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
