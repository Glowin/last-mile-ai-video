import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ImageIcon, Type, Clock, ArrowRight } from "lucide-react";
import { families, getFamily, resolutions, ratios } from "@/lib/models";
import { SiteHeader, SiteFooter } from "@/components/site-header";
export function generateStaticParams() {
  return families.map((x) => ({ slug: x.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const f = getFamily((await params).slug);
  if (!f) return {};
  return {
    title: f.seoTitle,
    description: `${f.seoHeading} in the KakaReel studio (${f.specShorthand}). Choose your settings, track your task, and save the finished MP4.`,
    alternates: { canonical: `/models/${f.slug}` },
  };
}
export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const f = getFamily((await params).slug);
  if (!f) notFound();
  const modelResolutions = resolutions(f.slug, "text");
  const modelRatios = ratios(f.slug, "text");
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell model-detail">
        <Link className="text-link" href="/#models">
          ← All models
        </Link>
        <span className="eyebrow">{f.maker} · {f.tag.toUpperCase()} · {f.specShorthand.toUpperCase()}</span>
        <h1>
          {f.seoHeading}
        </h1>
        <p className="lead">{f.description}</p>
        <div className="model-specs" aria-label={`${f.name} specifications`}>
          <span>{f.specShorthand}</span>
          <span>{modelResolutions.join(" · ")}</span>
          <span>{modelRatios.join(" · ")}</span>
          <span>Up to {f.maxPrompt.toLocaleString("en-US")} chars</span>
        </div>
        <div className="actions">
          <Link className="button" href={f.slug === "minimax" ? "/create?model=minimax&mode=image" : `/create?model=${f.slug}`}>
            Try {f.seoHeading} <ArrowUpRight size={19} />
          </Link>
          {f.slug === "minimax" ? (
            <Link className="text-link" href="/templates/no-ordinary-love">
              No Ordinary Love AI animation template <ArrowRight size={17} />
            </Link>
          ) : (
            <Link
              className="text-link"
              href={`/create?model=${f.slug}&mode=image`}
            >
              Start with an image <ArrowRight size={17} />
            </Link>
          )}
        </div>
        <div className="detail-grid">
          <article>
            <div className="detail-card-head">
              <Type />
              <span>01</span>
            </div>
            <h3>Text to video</h3>
            <p>
              Describe the subject, its movement, the light, and the camera.
              Keep your first idea focused.
            </p>
          </article>
          <article>
            <div className="detail-card-head">
              <ImageIcon />
              <span>02</span>
            </div>
            <h3>Image to video</h3>
            <p>
              Upload one first frame and describe what happens next. Output
              controls follow the selected model.
            </p>
          </article>
          <article>
            <div className="detail-card-head">
              <Clock />
              <span>03</span>
            </div>
            <h3>Stay with your task</h3>
            <p>
              Track generation and revisit your result in the same browser. A
              refresh does not start a new job.
            </p>
          </article>
        </div>
        <p className="muted">
          Sign in with Google to generate using purchased credits on supported
          settings, or use a separate invitation code for preview access. Model
          availability and output depend on the provider.
        </p>
        <h2>Explore another <em>direction.</em></h2>
        <div className="actions">
          {families
            .filter((x) => x.slug !== f.slug)
            .map((x) => (
              <Link
                className="button secondary"
                href={`/models/${x.slug}`}
                key={x.slug}
              >
                {x.name}
                <ArrowUpRight size={17} />
              </Link>
            ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
