"use client";

import { useEffect, useState } from "react";
import { api, starterCheckoutEnvironment, starterCheckoutProvider } from "@/lib/api";
import type { BillingCatalogResponse } from "@/lib/billing";
import { VIDEO_CREDIT_RATES } from "@/lib/video-credit-rates";
import { getFamily } from "@/lib/models";
import { STARTER_CREDIT_OFFER } from "@/lib/credit-offer";
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
    answer: "The Starter Pack price is published: US$19 plus applicable taxes for 150 credits. Sales have not opened yet. Signing in does not reserve a pack or create a purchase. Availability is checked before checkout.",
  },
  {
    question: "Will I need a subscription?",
    answer: "No. The Starter Pack is a one-time purchase with no automatic renewal and no expiry. You can buy it again to add another 150 credits to your balance when sales open.",
  },
  {
    question: "How many videos will a credit pack make?",
    answer: "It depends on the model, duration and resolution. Review the text-to-video rates below and request an exact quote in the studio. One credit does not mean one video. Some settings need more than the 150 credits in one pack.",
  },
  {
    question: "Why sign in with Google?",
    answer: "Your account keeps your video history so you can return to it when you sign in again. Preview generation still requires an invitation. Download finished videos promptly, because the provider's video links may expire.",
  },
  {
    question: "What happens if a generation fails or I need a refund?",
    answer: "Under the paid offer, a confirmed failed generation consumes no credits. An uncertain status stays pending until resolved; it is not automatically retried or treated as a failure. A wholly unused pack is refundable within 14 days for the full amount paid, including tax, with no KakaReel refund fee. A delivered video that does not suit your taste does not qualify for an automatic refund. These are the paid-offer rules; sales have not opened yet.",
  },
];

export function StarterPackAction({ catalog, notice = "Not yet on sale" }: { catalog: BillingCatalogResponse | null; notice?: string }) {
  const testMode = starterCheckoutEnvironment(catalog) === "test";
  const available = !!starterCheckoutProvider(catalog) && !testMode;
  return <div className={styles.cardActions}>
    <p className={testMode ? styles.testNotice : styles.checkoutNotice} role="status">
      {testMode ? "Test mode · No real payment. Not yet on sale." : available ? "Available to purchase" : notice}
    </p>
    <Link className={styles.secondaryButton} href="/account">{testMode ? "View test checkout in your account" : available ? "Continue to your account" : "Sign in to prepare"} <ArrowUpRight size={18} aria-hidden="true" /></Link>
  </div>;
}

export function PricingPanel() {
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [catalogState, setCatalogState] = useState("Checking sale availability…");
  useEffect(() => {
    let active = true;
    api("/billing/catalog").then((data: BillingCatalogResponse) => {
      if (!active) return;
      setCatalog(data);
      setCatalogState("Not yet on sale");
    }).catch(() => { if (active) setCatalogState("Sale availability could not be checked. Checkout is unavailable."); });
    return () => { active = false; };
  }, []);
  const testMode = starterCheckoutEnvironment(catalog) === "test";
  const available = !!starterCheckoutProvider(catalog) && !testMode;
  return (
    <div className={`shell ${styles.page}`}>
      <section className={styles.hero} aria-labelledby="pricing-title">
        <div>
          <span className={styles.eyebrow}>PRICING & ACCESS</span>
          <h1 id="pricing-title">A little idea.<br /><em>Room to take flight.</em></h1>
          <p className={styles.lead}>
            One simple pack for your next ideas. Published pricing, no subscription.
            Explore the invite-only preview while paid access is being prepared.
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
              <span className={`${styles.badge} ${styles.plannedBadge}`}>{available ? "One-time purchase" : "Not yet on sale"}</span>
            </div>
            <h3 id="credits-title">{STARTER_CREDIT_OFFER.name}</h3>
            <p className={styles.cardIntro}>One-time packs for the clips you want to make.</p>
            <div className={styles.offer}>
              <p className={styles.offerTitle}>US$19 <small>+ applicable taxes</small></p>
              <p><strong>{STARTER_CREDIT_OFFER.credits} credits</strong> · One-time purchase</p>
            </div>
            <ul className={styles.features}>
              <li><ArrowRight size={17} aria-hidden="true" />No expiry · No automatic renewal</li>
              <li><ArrowRight size={17} aria-hidden="true" />Buy again to add another 150 credits</li>
              <li><ArrowRight size={17} aria-hidden="true" />14-day refund for a wholly unused pack</li>
            </ul>
            <StarterPackAction catalog={catalog} notice={catalogState} />
            <p className={styles.small}>Signing in creates no order or payment commitment.</p>
          </article>
        </div>
      </section>

      <section className={styles.rates} aria-labelledby="video-rates">
        <span className={styles.eyebrow}>PLAN YOUR NEXT CLIP</span>
        <h2 id="video-rates">Text-to-video credit rates</h2>
        <p className={styles.small}>Paid-offer rates. Sales have not opened yet. Request a current quote in the studio before generating.</p>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Text-to-video credit rates">
          <table>
            <thead><tr><th scope="col">Model</th><th scope="col">Resolution</th><th scope="col">Length</th><th scope="col">Credits</th></tr></thead>
            <tbody>{VIDEO_CREDIT_RATES.map((rate) => <tr key={`${rate.family}-${rate.resolution}-${rate.duration}`}>
              <td>{getFamily(rate.family)?.name}</td><td>{rate.resolution}</td><td>{rate.duration}s</td><td>{rate.credits}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className={styles.small}>Seedance 1080p for 10 seconds costs 160 credits, more than one Starter Pack. You need sufficient available credits; repeat purchases add to your balance. Image-to-video pricing is not yet verified and paid image generation is unavailable.</p>
      </section>

      <section className={styles.explainer} aria-labelledby="credits-explained">
        <div className={styles.explainerHeading}>
          <span className={styles.eyebrow}>UNDERSTANDING CREDITS</span>
          <h2 id="credits-explained">Different clips.<br /><em>Different possibilities.</em></h2>
          <p>The paid offer is published; sales have not opened yet. Your quote makes the credit cost clear before you generate.</p>
        </div>
        <div className={styles.explainerItems}>
          <article>
            <SlidersHorizontal size={20} aria-hidden="true" />
            <div><h3>Your settings shape usage</h3><p>Model, duration and resolution affect the credit cost. Studio quotes are valid for five minutes and apply to the exact inputs you choose.</p></div>
          </article>
          <article>
            <Film size={20} aria-hidden="true" />
            <div><h3>Know the total before you pay</h3><p>US$19 is before tax. Applicable tax and the final total are shown before you confirm payment. Repeat purchases add credits; they never start a subscription.</p></div>
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
          <Link className={styles.inlineLink} href="/terms">Read the offer terms <ArrowUpRight size={16} aria-hidden="true" /></Link>
          <p className={styles.small}>Questions about pricing or refunds? Email <a className={styles.inlineLink} href="mailto:support@kakareel.com">support@kakareel.com</a>.</p>
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
