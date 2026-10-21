import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Film, SlidersHorizontal, UserRound } from "lucide-react";
import styles from "./pricing.module.css";

const questions = [
  {
    question: "Can I make a video today?",
    answer: "Generation is invite only during the preview. If you have a preview code, redeem it in the studio. You can explore models and prompt starters without one. Signing in with Google does not grant generation access on its own.",
  },
  {
    question: "Can I buy credits now?",
    answer: "Not yet. Paid checkout is not open. Pack prices, credit quantities, eligible models and any expiry terms will be published before launch. Signing in today does not reserve a pack or create a purchase.",
  },
  {
    question: "Will I need a subscription?",
    answer: "The planned paid option is a one-time credit pack. There is no annual plan or unlimited-generation offer. The exact pack details are still being finalized.",
  },
  {
    question: "How many videos will a credit pack make?",
    answer: "There is no confirmed video count yet. Credit use will depend on the model, clip duration and resolution you choose. A credit is a usage unit, not a promise of one video; the usage rates will be published with pricing.",
  },
  {
    question: "Why sign in with Google?",
    answer: "Your account keeps your video history so you can return to it when you sign in again. Preview generation still requires an invitation. Download finished videos promptly, because the provider's video links may expire.",
  },
  {
    question: "What happens if a generation fails or I need a refund?",
    answer: "Paid-generation and refund terms are still being finalized. Those terms will be published before checkout opens, including how failed generations and unused credits are handled. No automatic credit return or refund policy is promised at this stage.",
  },
];

export function PricingPanel() {
  return (
    <div className={`shell ${styles.page}`}>
      <section className={styles.hero} aria-labelledby="pricing-title">
        <div>
          <span className={styles.eyebrow}>PRICING & ACCESS</span>
          <h1 id="pricing-title">A little idea.<br /><em>Room to take flight.</em></h1>
          <p className={styles.lead}>
            Explore the studio in our invite-only preview. One-time credit
            packs are next, with prices announced before paid access opens.
          </p>
          <a className={styles.inlineLink} href="#access-options">
            Explore your options <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
        <div className={styles.mascot}>
          <Image src="/brand/kakapo-mascot.png" width={1296} height={1184}
            sizes="(max-width: 760px) 180px, 280px" priority
            alt="KakaReel's friendly green kakapo waving a wing" />
          <span>BIG IDEAS. SMALL BEGINNINGS.</span>
        </div>
      </section>

      <section id="access-options" className={styles.options} aria-labelledby="options-title">
        <div className={styles.sectionTop}>
          <h2 id="options-title">Start exploring. Plan your next step.</h2>
          <span className={styles.availability}>Early preview</span>
        </div>
        <div className={styles.cards}>
          <article className={styles.card} aria-labelledby="preview-title">
            <div className={styles.cardTop}>
              <Film size={23} strokeWidth={1.5} aria-hidden="true" />
              <span className={styles.badge}>Invite only</span>
            </div>
            <h3 id="preview-title">Preview</h3>
            <p className={styles.cardIntro}>Get to know your creative space.</p>
            <div className={styles.offer}>
              <p className={styles.offerTitle}>A first look</p>
              <p>Generation requires a preview code.</p>
            </div>
            <ul className={styles.features}>
              <li><Check size={17} aria-hidden="true" />Explore Seedance, Kling and MiniMax</li>
              <li><Check size={17} aria-hidden="true" />Start from text or an image</li>
              <li><Check size={17} aria-hidden="true" />Keep video history with your account</li>
            </ul>
            <div className={styles.cardActions}>
              <Link className={styles.primaryButton} href="/create">Open studio <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <Link className={styles.inlineLink} href="/account">Sign in with Google <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <p className={styles.small}>Invited generation uses a limited preview allowance.</p>
          </article>

          <article className={`${styles.card} ${styles.plannedCard}`} aria-labelledby="credits-title">
            <div className={styles.cardTop}>
              <span className={styles.packIcon} aria-hidden="true"><span /><span /><span /></span>
              <span className={`${styles.badge} ${styles.plannedBadge}`}>Planned</span>
            </div>
            <h3 id="credits-title">Credit packs</h3>
            <p className={styles.cardIntro}>One-time packs for the clips you want to make.</p>
            <div className={styles.offer}>
              <p className={styles.offerTitle}>Price announced<br />before launch</p>
              <p>Pack sizes and usage rates to be confirmed.</p>
            </div>
            <ul className={styles.features}>
              <li><ArrowRight size={17} aria-hidden="true" />One-time purchase planned</li>
              <li><ArrowRight size={17} aria-hidden="true" />Usage varies by model and video settings</li>
              <li><ArrowRight size={17} aria-hidden="true" />Review pack details and total before paying</li>
            </ul>
            <div className={styles.cardActions}>
              <p className={styles.checkoutNotice}>Paid checkout is not yet open.</p>
              <Link className={styles.secondaryButton} href="/account">Sign in to prepare <ArrowUpRight size={18} aria-hidden="true" /></Link>
            </div>
            <p className={styles.small}>Signing in creates no order or payment commitment.</p>
          </article>
        </div>
      </section>

      <section className={styles.explainer} aria-labelledby="credits-explained">
        <div className={styles.explainerHeading}>
          <span className={styles.eyebrow}>UNDERSTANDING CREDITS</span>
          <h2 id="credits-explained">Different clips.<br /><em>Different possibilities.</em></h2>
          <p>Credit packs are still in preparation. Here is what to look for when pricing is announced.</p>
        </div>
        <div className={styles.explainerItems}>
          <article>
            <SlidersHorizontal size={20} aria-hidden="true" />
            <div><h3>Your settings shape usage</h3><p>Model, duration and resolution affect how many credits a generation uses. Rates are not yet published.</p></div>
          </article>
          <article>
            <Film size={20} aria-hidden="true" />
            <div><h3>Know the total before you pay</h3><p>At launch, review the pack price, included credits and final total, including any applicable taxes, before confirming a payment.</p></div>
          </article>
          <article>
            <UserRound size={20} aria-hidden="true" />
            <div><h3>Come back to your ideas</h3><p>Sign in to keep your video history with your account. Save completed videos to your device while their download links are available.</p></div>
          </article>
        </div>
      </section>

      <section className={styles.faqSection} aria-labelledby="pricing-questions">
        <div>
          <span className={styles.eyebrow}>BEFORE YOUR FIRST CLIP</span>
          <h2 id="pricing-questions">A few good<br />questions.</h2>
          <Link className={styles.inlineLink} href="/terms">Read preview terms <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className={styles.faq}>
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>{question}<span aria-hidden="true">+</span></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="pricing-next">
        <div><span className={styles.eyebrow}>START WITH CURIOSITY</span><h2 id="pricing-next">Your next idea is welcome here.</h2></div>
        <Link className={styles.primaryButton} href="/create">Explore the studio <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </section>
    </div>
  );
}
