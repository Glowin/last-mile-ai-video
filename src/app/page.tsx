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
import { families } from "@/lib/models";
import { SiteHeader, SiteFooter } from "@/components/site-header";
export const metadata = { alternates: { canonical: "/" } };
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
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero shell">
          <div className="hero-copy">
            <span className="eyebrow">
              <i /> AN INDEPENDENT AI VIDEO STUDIO
            </span>
            <h1>
              Your next idea.
              <br />
              <em>In motion.</em>
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
                More ways to make it yours.
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
                <span className="eyebrow">{f.maker}</span>
                <h3>{f.name}</h3>
                <p>{f.description}</p>
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
              <h2>A starting point for your next clip.</h2>
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
            <h2>Make something move.</h2>
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
        <section className="section shell faq-section">
          <div>
            <span className="eyebrow">A FEW GOOD QUESTIONS</span>
            <h2>
              Before you press
              <br />
              generate.
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
          <h2>Let's see it move.</h2>
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
