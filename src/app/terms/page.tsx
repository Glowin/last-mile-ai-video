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
          Preview generations use a limited project allowance. There is
          currently no checkout or paid subscription. Generation availability,
          speed, and output quality depend on the connected model provider.
          Limits may temporarily prevent new requests.
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
          Save completed videos promptly. Browser-session history is not a
          permanent archive. Output links may expire and the preview may change
          during development.
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
