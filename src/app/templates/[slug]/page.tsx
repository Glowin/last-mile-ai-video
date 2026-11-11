import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ArrowRight, ImageIcon, Sparkles, Play } from "lucide-react";
import { templates, getTemplate } from "@/lib/templates";
import { SiteHeader, SiteFooter } from "@/components/site-header";

export function generateStaticParams() {
  return templates.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const t = getTemplate((await params).slug);
  if (!t) return {};
  return {
    title: { absolute: t.pageTitle },
    description: t.description,
    alternates: { canonical: `/templates/${t.slug}` },
    openGraph: {
      title: t.pageTitle,
      description: t.description,
      type: "website",
      url: `/templates/${t.slug}`,
      siteName: "KakaReel",
    },
    twitter: {
      card: "summary" as const,
      title: t.pageTitle,
      description: t.description,
    },
  };
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const t = getTemplate((await params).slug);
  if (!t) notFound();
  const studioHref = `/create?model=${t.modelSlug}&mode=${t.mode}&prompt=${encodeURIComponent(t.defaultPrompt)}`;
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell model-detail">
        <Link className="text-link" href={`/models/${t.modelSlug}`}>
          ← {t.modelLabel}
        </Link>
        <span className="eyebrow">{t.eyebrow}</span>
        <h1>{t.h1}</h1>
        <p className="lead">{t.lead}</p>
        <div className="model-specs" aria-label={`${t.name} specifications`}>
          {t.specPills.map((pill) => (
            <span key={pill}>{pill}</span>
          ))}
        </div>
        <div className="actions">
          <Link className="button" href={studioHref}>
            Use template in studio <ArrowUpRight size={19} />
          </Link>
          <Link className="text-link" href="/pricing#access-options">
            Starter Pack · 150 AI video credits <ArrowRight size={17} />
          </Link>
        </div>

        <section className="section" aria-labelledby="default-prompt-heading">
          <span className="eyebrow">PRESET MOTION PROMPT</span>
          <h2 id="default-prompt-heading">
            Default prompt for <em>{t.name}</em>
          </h2>
          <blockquote className="starter-prompt">“{t.defaultPrompt}”</blockquote>
          <p className="muted">
            {t.specShorthand} · Input requirements: {t.inputGuidance.join(" ")}
          </p>
        </section>

        <section className="section" aria-labelledby="how-to-use-heading">
          <span className="eyebrow">THREE STEPS IN STUDIO</span>
          <h2 id="how-to-use-heading">
            How to animate with the <em>No Ordinary Love</em> template
          </h2>
          <div className="detail-grid">
            {t.steps.map((step, i) => (
              <article key={step.title}>
                <div className="detail-card-head">
                  {i === 0 ? <Sparkles /> : i === 1 ? <ImageIcon /> : <Play />}
                  <span>0{i + 1}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="variations-heading">
          <span className="eyebrow">SCENE VARIATIONS</span>
          <h2 id="variations-heading">
            Prompt variations for <em>portrait & character animation</em>
          </h2>
          <div className="starter-grid">
            {t.variations.map((v) => (
              <Link
                href={`/create?model=${t.modelSlug}&mode=${t.mode}&prompt=${encodeURIComponent(v.prompt)}`}
                className="starter-card"
                key={v.title}
              >
                <span className="eyebrow">{v.spec}</span>
                <h3>{v.title}</h3>
                <blockquote className="starter-prompt">“{v.prompt}”</blockquote>
                <p className="micro">{v.note}</p>
                <p>
                  Open variation in studio <ArrowRight size={15} />
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="troubleshooting-heading">
          <span className="eyebrow">CLEANER MOTION RESULTS</span>
          <h2 id="troubleshooting-heading">
            Fixing face drift and <em>motion artifacts</em>
          </h2>
          <div className="detail-grid">
            {t.troubleshooting.map((item, i) => (
              <article key={item.issue}>
                <div className="detail-card-head">
                  <span>0{i + 1}</span>
                </div>
                <h3>{item.issue}</h3>
                <p>{item.fix}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section faq-section" aria-labelledby="template-faq-heading">
          <div>
            <span className="eyebrow">TEMPLATE FAQ</span>
            <h2 id="template-faq-heading">
              Questions before you <em>animate.</em>
            </h2>
          </div>
          <div className="faq">
            {t.faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
