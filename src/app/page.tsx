import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Film,
  ImageIcon,
  Sparkles,
  MoveUpRight,
  Play,
  Code2,
} from "lucide-react";
import { families, resolutions } from "@/lib/models";
import { SiteHeader, SiteFooter } from "@/components/site-header";
const title = "KakaReel: AI Video Generator for Text and Image to Video";
const description = "Create AI videos from text or images with KakaReel. Explore Seedance, Kling and MiniMax, compare settings, and turn your next idea into a downloadable clip.";
export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: "/", siteName: "KakaReel" },
  twitter: { card: "summary" as const, title, description },
};
const starters = [
  {
    title: "A product, in motion",
    prompt:
      "A ceramic perfume bottle on a pale stone pedestal. Soft morning light moves across its surface as the camera slowly orbits. Minimal composition, subtle shadows, a quiet editorial mood.",
    kind: "Product story",
    className: "still-product",
  },
  {
    title: "A different kind of escape",
    prompt:
      "A solitary explorer walks through a vast moss-covered canyon. Mist drifts between the cliffs. The camera slowly pulls back to reveal the landscape, cinematic natural light.",
    kind: "World building",
    className: "still-landscape",
  },
  {
    title: "Give an idea a little life",
    prompt:
      "A small paper bird unfolds its wings on a sunlit desk and gently lifts into the air. Warm afternoon light, tactile paper texture, whimsical stop-motion feel.",
    kind: "Visual experiment",
    className: "still-bird",
  },
];
export default function Home() {
  const siteUrl = process.env.APP_URL ? new URL("/", process.env.APP_URL).href : null;
  const structuredData = siteUrl ? {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${siteUrl}#website`, name: "KakaReel", url: siteUrl, description, inLanguage: "en" },
      { "@type": "WebApplication", "@id": `${siteUrl}#app`, name: "KakaReel", url: siteUrl,
        applicationCategory: "MultimediaApplication", operatingSystem: "Web browser",
        description, featureList: ["Text to video", "Image to video", "Seedance, Kling and MiniMax model selection"],
        isPartOf: { "@id": `${siteUrl}#website` } },
    ],
  } : null;
  return (
    <>
      {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />}
      <SiteHeader />
      <main id="main">
        <section className="hero shell">
          <div className="hero-copy">
            <span className="eyebrow">
              <i /> AN INDEPENDENT AI VIDEO STUDIO
            </span>
            <h1>
              KakaReel.
              <br />
              <em>AI video studio.</em>
            </h1>
            <p>
              Create AI videos from text and images. Explore Seedance, Kling,
              and MiniMax in one place, from the first prompt to the final clip.
            </p>
            <div className="actions">
              <Link className="button" href="/create">
                Start creating <ArrowUpRight size={19} />
              </Link>
              <a className="text-link" href="#models">
                Find your model <ArrowRight size={16} />
              </a>
            </div>
            <span className="micro">
              Invite-only preview · Starter Pack: US$19 + applicable taxes / 150 credits · Not yet on sale
            </span>
          </div>
          <div
            className="hero-art"
            aria-label="KakaReel kakapo mascot illustration"
          >
            <div className="art-top">
              <span>FROM A THOUGHT TO A FRAME</span>
              <span>KAKAREEL</span>
            </div>
            <Image
              className="hero-mascot"
              src="/brand/kakapo-mascot.png"
              width={1296}
              height={1184}
              alt="A friendly moss-green kakapo waving a wing"
              priority
            />
            <div className="horizon" />
            <div className="art-grain" />
            <div className="art-frame">
              <div />
              <div />
              <div />
              <div />
            </div>
            <div className="art-caption">
              <span>
                <Sparkles size={16} /> Imagine what happens next.
              </span>
              <span>MEET OUR KAKAPO</span>
            </div>
            <div className="floating-prompt">
              <span className="prompt-icon">
                <Film size={18} />
              </span>
              <div>
                <span>A little light. A little movement.</span>
                <small>Every great clip starts with an idea.</small>
              </div>
              <MoveUpRight size={18} />
            </div>
          </div>
        </section>
        <div className="model-strip shell">
          <span>
            THREE MODEL FAMILIES.
            <br />
            ONE CREATIVE SPACE.
          </span>
          <b>
            Seedance <small>by ByteDance</small>
          </b>
          <b>
            Kling <small>by Kuaishou</small>
          </b>
          <b>
            MiniMax <small>H3</small>
          </b>
        </div>
        <section id="models" className="section shell">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR CREATIVE TOOLKIT</span>
              <h2>
                Different models.
                <br />
                <em>More ways to make it yours.</em>
              </h2>
            </div>
            <p>
              Keep the same workflow. Change the model.
              <br />
              Explore the possibilities one clip at a time.
            </p>
          </div>
          <div className="model-grid">
            {families.map((f, i) => (
              <Link
                href={`/models/${f.slug}`}
                className="model-card"
                key={f.slug}
              >
                <span className="model-number">
                  0{i + 1}
                  <ArrowUpRight size={20} />
                </span>
                <div
                  className={`model-symbol symbol-${f.slug}`}
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                </div>
                <span className="eyebrow">{f.maker} · {f.tag}</span>
                <h3>{f.name}</h3>
                <p>{f.description}</p>
                <div className="model-specs" aria-label={`${f.name} specifications`}>
                  <span>{resolutions(f.slug, "text").join(" · ")}</span>
                  <span>{f.durations[0]}–{f.durations[f.durations.length - 1]}s</span>
                  <span>Up to {f.maxPrompt.toLocaleString("en-US")} chars</span>
                </div>
                <div className="card-foot">
                  <span>Text + image to video</span>
                  <ArrowRight size={18} />
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="section shell">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE BLANK PAGE ENDS HERE</span>
              <h2>A starting point for your <em>next clip.</em></h2>
            </div>
            <p>
              Try a prompt. Change the details.
              <br />
              See where the idea takes you.
            </p>
          </div>
          <div className="starter-grid">
            {starters.map((s) => (
              <Link
                href={`/create?prompt=${encodeURIComponent(s.prompt)}`}
                className="starter-card"
                key={s.title}
              >
                <div className={`starter-art ${s.className}`}>
                  <div className="shape-a" />
                  <div className="shape-b" />
                  <span className="illustration-label">
                    PROMPT CONCEPT · ILLUSTRATION
                  </span>
                  <span className="round-link">
                    <ArrowUpRight size={21} />
                  </span>
                </div>
                <span className="eyebrow">{s.kind}</span>
                <h3>{s.title}</h3>
                <blockquote className="starter-prompt">“{s.prompt}”</blockquote>
                <p>
                  Open this prompt in the studio <ArrowRight size={15} />
                </p>
              </Link>
            ))}
          </div>
          <p className="micro">
            Illustrations show prompt concepts, not model-generated video
            results.
          </p>
        </section>
        <section id="how-it-works" className="section steps-section">
          <div className="shell">
            <span className="eyebrow">FROM IDEA TO DOWNLOAD</span>
            <h2>Make something <em>move.</em></h2>
            <div className="steps">
              {[
                {
                  icon: <ImageIcon />,
                  title: "Start with an idea",
                  text: "Write a scene or upload a JPEG or PNG. Tell the model what should move.",
                },
                {
                  icon: <Sparkles />,
                  title: "Choose your direction",
                  text: "Pick a model and the available duration, format, and sound settings.",
                },
                {
                  icon: <Play />,
                  title: "Make it a clip",
                  text: "Follow the task status, preview the result, and open the video to save it.",
                },
              ].map((s, i) => (
                <div key={s.title}>
                  <div className="step-icon">
                    {s.icon}
                    <span>0{i + 1}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="section shell home-guide" aria-labelledby="video-guide-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MAKE YOUR FIRST AI VIDEO</span>
              <h2 id="video-guide-title">A scene, an image,<br /><em>a little direction.</em></h2>
            </div>
            <p>KakaReel brings text-to-video and image-to-video tools into one studio. Start with the material you have, then choose the settings that suit the shot.</p>
          </div>
          <div className="home-guide-grid">
            <article>
              <h3>Turn a text prompt into a video</h3>
              <p>Describe a single scene: the subject, its surroundings, and the movement you want to see. A product on a table, a walk through a landscape, or a small animated character gives the model a clear starting point. Add the lighting and camera movement when they matter to the idea.</p>
              <p>For a short clip, keep the action focused. Try “the camera slowly moves closer as sunlight crosses the bottle” before asking for several scene changes. The prompt starters above open directly in the studio, where you can edit every detail before submitting a generation.</p>
            </article>
            <article>
              <h3>Animate an image you already have</h3>
              <p>Choose image-to-video when the composition is already in a picture. Upload one JPEG or PNG up to 3 MB, then describe what should happen next. You might ask for fabric to move in a breeze, a character to turn its head, or a slow camera move around a still object.</p>
              <p>Use an image you have permission to upload. Check that the subject is clear and that the starting frame suits your intended shot. The generated result can differ from the source, so review faces, shapes, text, and other important details before sharing it.</p>
            </article>
            <article>
              <h3>Compare models with a consistent idea</h3>
              <p>Seedance, Kling, and MiniMax offer different combinations of duration, resolution, aspect ratio, and sound. Their model pages explain the available options; the studio updates its controls when you change models. Choose settings for the place where you plan to use the clip, such as a portrait social post or a landscape presentation.</p>
              <p>Keep the prompt and input image consistent when exploring a different model. Changing one setting at a time makes the results easier to compare. AI generation can vary between runs, and higher resolution alone does not guarantee that a model will follow every instruction.</p>
            </article>
            <article>
              <h3>Review and save the finished clip</h3>
              <p>Once a generation is accepted, follow its status in the studio. Wait for the existing task to finish before submitting another attempt. On completion, preview the clip and check whether its motion, framing, and details match your intended use. Download a copy promptly because provider links can expire.</p>
              <p>KakaReel is currently an invite-only preview. Signing in keeps your account accessible, but generation still requires preview access. The <Link href="/pricing#access-options">pricing page</Link> explains the planned Starter Pack and model credit rates. If a task needs help, contact <Link href="/support">support</Link> with the task reference shown in your history.</p>
            </article>
          </div>
        </section>
        <section className="section shell faq-section">
          <div>
            <span className="eyebrow">A FEW GOOD QUESTIONS</span>
            <h2>
              Before you press
              <br />
              <em>generate.</em>
            </h2>
            <Link className="text-link" href="/build">
              Follow the build <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="faq">
            {[
              [
                "Can I try it today?",
                "The studio is an early, invite-only preview. You can explore its models and prompt starters without a code. Generating a video requires a preview code from the project owner.",
              ],
              [
                "What can I use as an input?",
                "A text prompt, or one JPEG or PNG image up to 3 MB with a description of how it should move. The studio shows the output settings available for each model.",
              ],
              [
                "What does a generation cost?",
                "The published Starter Pack is US$19 plus applicable taxes for 150 credits, with no expiry or automatic renewal. It is not yet on sale. Invited preview generations use a separate limited allowance. Credit usage depends on the model and settings; see Pricing for the offer and rates.",
              ],
              [
                "How long will it take?",
                "Generation runs as a background task with the model provider. Timing varies by model and demand. You can refresh or return to your history in the same browser without starting another job.",
              ],
              [
                "Can I download and keep my video?",
                "Successful tasks include a preview and a link to the video. Open the file and use your browser's Save Video option. Provider links may expire, so save your result promptly.",
              ],
              [
                "Is this an official model-provider website?",
                "No. This is an independent, open-source studio using VibeToken's APIs. Model names belong to their respective owners. You are responsible for rights to your inputs and use of your outputs.",
              ],
            ].map(([q, a]) => (
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
        <section className="closing shell">
          <span className="eyebrow">START WITH ONE IDEA</span>
          <h2>Let's see it <em>move.</em></h2>
          <Link className="button" href="/create">
            Open the studio <ArrowUpRight size={19} />
          </Link>
          <a
            className="source-link"
            href="https://github.com/Glowin/last-mile-ai-video"
          >
            <Code2 size={16} /> Open source. Built in public.
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
