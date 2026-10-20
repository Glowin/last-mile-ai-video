import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ImageIcon, Type, Clock, ArrowRight } from "lucide-react";
import { families, getFamily } from "@/lib/models";
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
    title: `${f.name} AI Video Generator`,
    description: `Explore ${f.name} text-to-video and image-to-video in the KakaReel studio. Choose your settings, track your task, and save the result.`,
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
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell model-detail">
        <Link className="text-link" href="/#models">
          ← All models
        </Link>
        <span className="eyebrow">{f.maker} · INDEPENDENT STUDIO PREVIEW</span>
        <h1>
          {f.name}.<br />
          <em>Your next take.</em>
        </h1>
        <p className="lead">{f.description}</p>
        <div className="actions">
          <Link className="button" href={`/create?model=${f.slug}`}>
            Try {f.name} <ArrowUpRight size={19} />
          </Link>
          <Link
            className="text-link"
            href={`/create?model=${f.slug}&mode=image`}
          >
            Start with an image <ArrowRight size={17} />
          </Link>
        </div>
        <div className="detail-grid">
          <article>
            <Type />
            <h3>Text to video</h3>
            <p>
              Describe the subject, its movement, the light, and the camera.
              Keep your first idea focused.
            </p>
          </article>
          <article>
            <ImageIcon />
            <h3>Image to video</h3>
            <p>
              Upload one first frame and describe what happens next. Output
              controls follow the selected model.
            </p>
          </article>
          <article>
            <Clock />
            <h3>Stay with your task</h3>
            <p>
              Track generation and revisit your result in the same browser. A
              refresh does not start a new job.
            </p>
          </article>
        </div>
        <p className="muted">
          Generation requires preview access. Model availability and output
          depend on the provider. No commercial-use guarantee is made by this
          preview.
        </p>
        <h2>Explore another direction</h2>
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
