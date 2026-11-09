import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { renderInline } from "@/lib/inline-copy";
import { getFamily } from "@/lib/models";
import { topicStudioHref, type Topic, type TopicPrompt } from "@/lib/topics";

function PromptCard({ prompt }: { prompt: TopicPrompt }) {
  return (
    <article className="topic-prompt" id={prompt.id}>
      <h3>{prompt.title}</h3>
      <ul className="topic-specs">
        {prompt.variants.map((variant) => (
          <li key={`${variant.modelSlug}-${variant.durationSeconds}-${variant.aspect}`}>
            <span>{getFamily(variant.modelSlug)?.name}</span>
            <span>{variant.durationSeconds}s</span>
            <span>{variant.aspect}</span>
            <span>{prompt.mode === "image" ? "Image to video" : "Text to video"}</span>
          </li>
        ))}
      </ul>
      <pre className="topic-prompt-text">{prompt.prompt}</pre>
      <div className="actions">
        <CopyPromptButton text={prompt.prompt} />
        {prompt.variants.map((variant) => {
          const name = getFamily(variant.modelSlug)?.name ?? variant.modelSlug;
          return (
            <Link
              className="button small"
              href={topicStudioHref(variant.modelSlug, prompt.mode)}
              key={`${variant.modelSlug}-${variant.aspect}`}
            >
              {prompt.variants.length === 1 ? "Open in studio" : `Open ${name}`}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </article>
  );
}

export function TopicLanding({ topic }: { topic: Topic }) {
  const featured = topic.prompts.find((prompt) => prompt.id === topic.featuredPromptId);
  const featuredVariant = featured?.variants[0];
  const hookPrompts = topic.prompts.filter((prompt) => prompt.group === "hook");
  const imagePrompt = topic.prompts.find((prompt) => prompt.group === "image");
  const laterPrompts = topic.prompts.filter(
    (prompt) => prompt.group === "episode" || prompt.group === "trailer",
  );

  return (
    <>
      <SiteHeader />
      <main id="main" className="shell model-detail topic-page">
        <span className="eyebrow">{topic.hero.eyebrow}</span>
        <h1>
          {topic.hero.title}
          <br />
          <em>{topic.hero.emphasis}</em>
        </h1>
        <p className="lead">{renderInline(topic.hero.lead)}</p>
        <div className="actions">
          <Link className="button" href="/create">
            {topic.hero.primaryCta} <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
          <Link className="text-link" href="/acceptable-use">
            {topic.hero.secondaryCta} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="prose-callout topic-disclaimer">
          <p>{renderInline(topic.hero.disclaimer)}</p>
        </div>

        {featured && featuredVariant && (
          <article className="topic-prompt" aria-labelledby="featured-shot">
            <span className="eyebrow">Ep03 · featured example</span>
            <h2 id="featured-shot">{topic.scene.title}</h2>
            <p className="topic-note">{topic.scene.place}</p>
            <ul className="topic-specs">
              <li>
                <span>{getFamily(featuredVariant.modelSlug)?.name}</span>
                <span>{featuredVariant.durationSeconds}s</span>
                <span>{featuredVariant.aspect}</span>
                <span>{featured.mode === "image" ? "Image to video" : "Text to video"}</span>
              </li>
            </ul>
            <div className="actions">
              <CopyPromptButton text={featured.prompt} />
              <Link className="button small" href={topicStudioHref(featuredVariant.modelSlug, featured.mode)}>
                Open in studio <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <a className="text-link" href="#prompts">
                All model prompts <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </article>
        )}

        <section id="scene" aria-labelledby="scene-title">
          <span className="eyebrow">{topic.scene.kicker}</span>
          <h2 id="scene-title">{topic.scene.title}</h2>
          <p className="topic-note">{topic.scene.positioning}</p>
          <div className="topic-blocks">
            {topic.scene.blocks.map((block) => (
              <article key={block.heading}>
                <h3>{block.heading}</h3>
                {block.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{renderInline(paragraph)}</p>
                ))}
                {block.ordered && block.ordered.length > 0 && (
                  <ol className="topic-list">
                    {block.ordered.map((line) => (
                      <li key={line}>{renderInline(line)}</li>
                    ))}
                  </ol>
                )}
                {block.bullets && block.bullets.length > 0 && (
                  <ul className="topic-list">
                    {block.bullets.map((line) => (
                      <li key={line}>{renderInline(line)}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>

        <section id="story" aria-labelledby="story-title">
          <span className="eyebrow">Story bible</span>
          <h2 id="story-title">Story and characters.</h2>
          <p>{renderInline(topic.world)}</p>
          <p className="topic-note">{topic.tickerNote}</p>
          <div className="topic-table-wrap">
            <table className="topic-table">
              <caption className="sr-only">Fictional characters</caption>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Name</th>
                  <th>Safe look</th>
                  <th>Motive</th>
                </tr>
              </thead>
              <tbody>
                {topic.characters.map((character) => (
                  <tr key={character.name}>
                    <td>{character.role}</td>
                    <th scope="row">{character.name}</th>
                    <td>{renderInline(character.look)}</td>
                    <td>{character.motive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="topic-note">{topic.tone}</p>
          <article className="prose-callout topic-look">
            <h3>{topic.look.heading}</h3>
            {topic.look.paragraphs.map((paragraph) => (
              <p key={paragraph}>{renderInline(paragraph)}</p>
            ))}
          </article>
        </section>

        <section id="episodes" aria-labelledby="episodes-title">
          <span className="eyebrow">Five clips</span>
          <h2 id="episodes-title">Five-episode storyboard.</h2>
          <p className="topic-note">{topic.episodesIntro}</p>
          <div className="topic-table-wrap">
            <table className="topic-table">
              <caption className="sr-only">Five-episode storyboard</caption>
              <thead>
                <tr>
                  <th>Ep</th>
                  <th>Title</th>
                  <th>Length</th>
                  <th>Beat</th>
                </tr>
              </thead>
              <tbody>
                {topic.episodes.map((episode, index) => (
                  <tr key={episode.id} className={episode.featured ? "is-featured" : undefined}>
                    <td>0{index + 1}</td>
                    <th scope="row">
                      {episode.title}
                      {episode.featured && <span className="topic-badge">Core hook</span>}
                    </th>
                    <td>{episode.duration}</td>
                    <td>{episode.beat}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="topic-note">{topic.exportLabel}</p>
        </section>

        <section id="prompts" aria-labelledby="prompts-title">
          <span className="eyebrow">Ready to paste</span>
          <h2 id="prompts-title">Example prompts.</h2>
          <h3>Episode 03 · three models</h3>
          <div className="topic-prompt-list">
            {hookPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>
          {imagePrompt && (
            <>
              <h3>{topic.imageToVideo.title}</h3>
              <PromptCard prompt={imagePrompt} />
              <ol className="topic-list">
                {topic.imageToVideo.steps.map((step) => (
                  <li key={step}>{renderInline(step)}</li>
                ))}
              </ol>
            </>
          )}
          <h3>Other episodes and a trailer</h3>
          <div className="topic-prompt-list">
            {laterPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>
        </section>

        <section id="steps" aria-labelledby="steps-title">
          <span className="eyebrow">From prompt to export</span>
          <h2 id="steps-title">Steps.</h2>
          <ol className="topic-list">
            {topic.steps.map((step) => (
              <li key={step}>{renderInline(step)}</li>
            ))}
          </ol>
        </section>

        <section className="faq-section" id="faq" aria-labelledby="faq-title">
          <div>
            <span className="eyebrow">Before you generate</span>
            <h2 id="faq-title">FAQ.</h2>
            <Link className="text-link" href="/acceptable-use">
              {topic.hero.secondaryCta} <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="faq">
            {topic.faqs.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{renderInline(faq.answer)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing" id="start">
          <h2>{topic.cta.title}</h2>
          <p className="topic-cta-body">{topic.cta.body}</p>
          <Link className="button" href="/create">
            {topic.cta.button} <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
          <p className="topic-note topic-cta-note">{renderInline(topic.cta.footnote)}</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
