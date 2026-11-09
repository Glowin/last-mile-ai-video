import type { FamilySlug, Mode } from "@/lib/models";

export type TopicPromptVariant = {
  modelSlug: FamilySlug;
  durationSeconds: number;
  aspect: string;
};

export type TopicPrompt = {
  id: string;
  group: "hook" | "image" | "episode" | "trailer";
  title: string;
  mode: Mode;
  prompt: string;
  variants: TopicPromptVariant[];
};

export type SceneBlock = {
  heading: string;
  paragraphs?: string[];
  ordered?: string[];
  bullets?: string[];
};

export type TopicCharacter = {
  role: string;
  name: string;
  look: string;
  motive: string;
};

export type TopicEpisode = {
  id: string;
  title: string;
  duration: string;
  beat: string;
  featured?: boolean;
};

export type Topic = {
  slug: string;
  featuredPromptId: string;
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  hero: {
    eyebrow: string;
    title: string;
    emphasis: string;
    lead: string;
    primaryCta: string;
    secondaryCta: string;
    disclaimer: string;
  };
  scene: {
    kicker: string;
    title: string;
    place: string;
    positioning: string;
    blocks: SceneBlock[];
  };
  world: string;
  tickerNote: string;
  tone: string;
  characters: TopicCharacter[];
  look: { heading: string; paragraphs: string[] };
  episodesIntro: string;
  episodes: TopicEpisode[];
  exportLabel: string;
  prompts: TopicPrompt[];
  imageToVideo: {
    title: string;
    steps: string[];
  };
  steps: string[];
  faqs: { question: string; answer: string }[];
  cta: {
    title: string;
    body: string;
    button: string;
    footnote: string;
  };
};

const aiChairmanSpyRomance: Topic = {
  slug: "ai-chairman-spy-romance",
  featuredPromptId: "ep03-seedance",
  seo: {
    title: "AI Romance Short Drama | Chairman & Spy Love Story + Paparazzi Hook — KakaReel",
    description: "Generate a fictional listed-AI-chairman × spy romance miniseries. Soft kisses, dances, rain, and a paparazzi twist outside a modern Chinatown neo-Chinese restaurant. No real people, no NSFW. Prompts for Seedance, Kling & MiniMax on KakaReel.",
    keywords: [
        "AI romance short drama",
        "spy romance AI video",
        "AI CEO romance short",
        "listed AI chairman love story",
        "AI tycoon spy thriller romance",
        "honeytrap romance AI",
        "paparazzi Chinatown restaurant AI video",
        "modern Chinese restaurant romance AI",
        "neo-Chinese dining spy romance",
        "boardroom romance short film AI",
        "corporate espionage romance AI video",
        "fictional spy love drama prompts",
        "KakaReel romance miniseries",
      ],
  },
  hero: {
    eyebrow: "Fiction only · AI listed-company romance",
    title: "The AI Chairman & the Spy.",
    emphasis: "She came for the weights. She stayed for him.",
    lead: "A five-clip romantic miniseries set around earnings week at a fictional listed AI company. Soft tension, soft kisses—and one viral hook: dinner behind glass at a **modern Chinatown neo-Chinese restaurant**, until the paparazzi lens finds them. Never NSFW. Never real people.",
    primaryCta: "Start in Studio",
    secondaryCta: "Acceptable Use",
    disclaimer: "This page is pure fiction. Characters, company, exchange ticker (**FableX: MLAT-AI**), and the **Veil Consortium** are invented. Do **not** generate lookalikes of living people. Soft romance between fictional adults is allowed; pornography and real-person intimate deepfakes are banned under our [Acceptable Use Policy](/acceptable-use). This is **not** about any real news story.",
  },
  scene: {
    kicker: "Ep03 · the turning episode",
    title: "Caught Through the Glass",
    place: "Chinatown neo-Chinese dining room",
    positioning: "Chinatown at night · a modern, trendy neo-Chinese restaurant (not a traditional old-school Chinese restaurant; no red lanterns).",
    blocks: [
      {
        heading: "Setting",
        paragraphs: [
            "Night in **Chinatown**, outside a **modern, trendy neo-Chinese restaurant** (not a traditional old-school Chinese restaurant; **no red lanterns**). The camera stays on the wet sidewalk, shooting **through a floor-to-ceiling glass wall** into a minimal contemporary dining room: dark wood, brass and marble details, recessed warm lighting and designer pendant lamps; a large round table with a **lazy Susan**; refined plated Chinese dishes and a tea set; optional modernized wood-lattice panels. Fictional listed-AI chairman **Adrian Cole** (silver-white medium-length hair, 3:7 side part, deep-emerald enamel-frame glasses, pure black suit) and **Mira Solenne** dine together—relaxed, romantic, happy—soft eye contact, a gentle clink of tea or small baijiu cups, spinning the lazy Susan to serve each other. Outside: wet asphalt reflections, distant **blurred unreadable or invented** Chinese neon sign glow (e.g. fictional “Cloud Ink” haze—never a real restaurant name), passing cars.",
          ],
      },
      {
        heading: "Camera",
        paragraphs: [
            "Full-clip **paparazzi long-lens POV**. Optional foreground: blurred lens hood / telephoto barrel edge or a modern planter silhouette. Gentle handheld breath; not shaky-cam chaos. The lens *is* the tabloid photographer.",
          ],
      },
      {
        heading: "Light",
        paragraphs: [
            "Interior: warm red-amber recessed glow and designer pendants on faces. Exterior/camera side: cool pink/cyan Chinatown neon spill on wet pavement. The glass is the warm/cold border—romance inside, surveillance outside.",
          ],
      },
      {
        heading: "Performance beat (~8–10s)",
        ordered: [
            "**0–4s:** Happy dinner; before speaking he **lightly pushes up his deep-emerald enamel-frame glasses**; soft tea/baijiu cup clink or lazy-Susan serve.",
            "**4–6s:** His smile freezes as he notices the sidewalk; hand instinctively moves to the **first button** of his black jacket.",
            "**6–8/10s:** Shock; he raises a hand and **points straight at the camera** (out the window); she turns to look. Optional flash reflection in the glass.",
          ],
      },
      {
        heading: "Adrian look (this shot — consistent everywhere)",
        paragraphs: [
            "Silver-white medium-length hair with a 3:7 side part; deep-emerald enamel-frame glasses; pure black suit with open white shirt, no tie; mid-50s; invented face. Never leather jackets, short salt-and-pepper hair, ethnic facial labels, or chubby CEO tropes.",
          ],
      },
      {
        heading: "Sound",
        paragraphs: [
            "Modern Chinese-restaurant ambience (soft talk, porcelain cup taps, faint lazy-Susan turn); Chinatown night bed and distant traffic; then crisp **camera shutter clicks** (one or two) at the turn, optional flash pop. The hook is **sound spike + pointing at the lens**.",
          ],
      },
      {
        heading: "Why it hooks short-form",
        paragraphs: [
            "Readable frame in one glance (lazy Susan + glass + neon vs warm interior); clean emotion flip; fourth-wall break when he points at “us”; chic neo-Chinese Chinatown vibe without traditional lantern clichés; stays 100% fictional.",
          ],
        bullets: [],
      },
    ],
  },
  world: "**Meridian Lattice AI** (FableX: **MLAT-AI**) is a fictional public AI platform company: foundation models, enterprise inference APIs, and a sealed training roadmap. It is **earnings week**. After-hours, fictional boards flicker **MLAT-AI** while Chairman **Adrian Cole** tries to keep both the stock narrative and his private life intact. **Mira Solenne**, “strategic envoy” for the fictional **Veil Consortium**, was sent to get close to him and reach **model-weight notes** and the **Q-next compute roadmap**. She falls for him. He begins to trust her. Romance leads; espionage presses from the edges—until a paparazzi lens outside a modern Chinatown neo-Chinese restaurant turns their secret dinner into a crisis.",
  tickerNote: "FableX: MLAT-AI is not a real listing.",
  tone: "Romance first; spy craft and paparazzi pressure as obstacles. Ending open or bittersweet.",
  characters: [
    {
      role: "Listed AI chairman",
      name: "Adrian Cole",
      look: "Mid-50s, tall; **silver-white medium-length hair, 3:7 side part**; **deep-emerald enamel-frame glasses**; **pure black suit** + open white shirt, no tie; invented face (no real-person likeness). **Signature beats:** (1) lightly pushes up his enamel glasses before speaking; (2) flips a worn old coin between his fingers when thinking; (3) fastens the first button of his black jacket when composing himself. Never: leather jacket, short salt-and-pepper hair, ethnic facial labels, or stocky/chubby CEO tropes.",
      motive: "Protect earnings narrative, model IP, and a fragile new love",
    },
    {
      role: "Spy who falls in love",
      name: "Mira Solenne",
      look: "Early 30s, dark evening dress or coat, composed smile that softens; invent features (e.g. warm olive skin, shoulder-length dark wavy hair, hazel eyes)—**not** modeled on any real person",
      motive: "Mission: weights & roadmap; heart: not to destroy him",
    },
    {
      role: "Company",
      name: "Meridian Lattice AI",
      look: "Listed **AI model/platform** co. (not a chip/GPU giant)",
      motive: "Survive earnings + keep IP",
    },
    {
      role: "Ticker",
      name: "FableX: MLAT-AI",
      look: "Fictional exchange + ticker",
      motive: "Story prop: after-hours moves, media heat",
    },
    {
      role: "Org",
      name: "Veil Consortium",
      look: "Fictional private intelligence broker",
      motive: "Buys secrets as product (no real agency names)",
    },
  ],
  look: {
    heading: "Adrian Cole — look and signature beats",
    paragraphs: [
        "Mid-50s, tall. Silver-white medium-length hair with a **3:7 side part**. **Deep-emerald enamel-frame glasses**. **Pure black suit**, open white shirt, no tie. Invented face—not based on any real person.",
        "**Signature beats:** (1) lightly pushes up his enamel glasses before speaking; (2) flips a worn old coin between his fingers when thinking; (3) fastens the first button of his black jacket when composing himself.",
        "**Banned descriptors:** leather jacket / leather coat; short black-and-white or salt-and-pepper hair; explicit ethnic facial labels; stocky/chubby build tropes that echo any real CEO.",
      ],
  },
  episodesIntro: "About 40–50 seconds overall, as vertical episodes or a horizontal trailer.",
  episodes: [
    {
      id: "ep01",
      title: "The Dance",
      duration: "8s",
      beat: "Earnings-week partnership dinner; they dance together; their eyes meet.",
    },
    {
      id: "ep02",
      title: "Rain & Umbrella",
      duration: "8s",
      beat: "Under one umbrella; a brief embrace and a light kiss; she swallows the confession.",
    },
    {
      id: "ep03",
      title: "Caught Through the Glass",
      duration: "8–10s",
      featured: true,
      beat: "Long lens through the floor-to-ceiling glass outside a Chinatown neo-Chinese restaurant; a romantic dinner at a large round table with a lazy Susan → they notice the paparazzi → shock → he points at the lens.",
    },
    {
      id: "ep04",
      title: "The Tell",
      duration: "8–10s",
      beat: "His office; a restricted “MODEL WEIGHTS” tablet; they hold hands, then let go.",
    },
    {
      id: "ep05",
      title: "Rooftop Lights",
      duration: "8–10s",
      beat: "A rooftop view of the lights and a distant fictional ticker; an embrace goodbye; a light kiss; an open, bittersweet ending.",
    },
  ],
  exportLabel: "Label every export “AI-generated · fiction · FableX: MLAT-AI is not real”.",
  prompts: [
    {
      id: "ep03-seedance",
      group: "hook",
      title: "Seedance 2.5 · ambience and shutter",
      mode: "text",
      prompt: "Cinematic paparazzi POV, fiction only. Night in Chinatown outside a modern trendy neo-Chinese restaurant (not traditional; no red lanterns). Camera on wet sidewalk, shooting through floor-to-ceiling glass into a minimal contemporary dining room: dark wood, brass and marble details, recessed warm lights and designer pendants, modernized wood-lattice accents. Centered: large round table with a lazy Susan, refined plated Chinese dishes and a tea set. Adrian Cole—a fictional mid-50s tall chairman with silver-white medium-length hair in a 3:7 side part, deep-emerald enamel-frame glasses, pure black suit with an open white shirt and no tie, invented face not based on any real person—sits across from Mira Solenne, a fictional early-30s woman with shoulder-length dark wavy hair, hazel eyes, dark elegant dress—also fully invented. They dine happily; he lightly pushes up his enamel glasses, they gently clink small tea or baijiu cups, he turns the lazy Susan to serve her. Warm red-amber interior vs cool Chinatown neon spill outside; distant blurred unreadable Chinese neon sign haze (fictional only). Blurred telephoto lens-hood foreground. Soft handheld breath.\n\nBeat: 0-4s joyful dinner with glasses-push and cup clink; 4-6s his smile freezes as he notices the sidewalk, hand moves to the first button of his black jacket; 6-10s shock, he raises his hand and points straight at the camera (out the window toward the lens); she turns to look. Optional flash reflection on the glass.\n\nSoundtrack: modern Chinese-restaurant ambience (soft talk, porcelain taps, faint lazy-Susan turn), Chinatown night bed, then clear camera shutter clicks (two rapid clicks) at the reveal. Soft romance earlier, sudden tension. No leather jackets, no short salt-and-pepper hair, no ethnic facial labels, no real restaurant names, no real people, no NSFW, no bedroom. Meridian Lattice AI / FableX MLAT-AI are fictional.",
      variants: [{ modelSlug: "seedance", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep03-kling",
      group: "hook",
      title: "Kling 3.0 · vertical, expression, push-in",
      mode: "text",
      prompt: "Vertical spy-romance hook, paparazzi long-lens POV through Chinatown neo-Chinese restaurant glass at night (modern trendy interior, no red lanterns). Large round table with lazy Susan, refined Chinese dishes and tea set; dark wood, brass, marble, designer warm lights. Fictional Adrian Cole (mid-50s, silver-white medium-length hair with 3:7 side part, deep-emerald enamel-frame glasses, pure black suit, open white shirt, no tie, invented face) and Mira Solenne (early 30s, dark dress, dark wavy hair, hazel eyes, invented face) laughing softly; he lightly pushes up his glasses; soft tea-cup clink. Slow push-in through the glass toward their faces. Wet street reflections and blurred Chinese neon outside. His expression changes from happy to startled shock; he points directly at the camera. Mild handheld, shallow depth of field. Fiction only, no leather jacket, no real restaurant names, no real celebrities, no NSFW.",
      variants: [{ modelSlug: "kling", durationSeconds: 8, aspect: "9:16" }],
    },
    {
      id: "ep03-minimax",
      group: "hook",
      title: "MiniMax H3 · polished 10s master",
      mode: "text",
      prompt: "Polished cinematic short. Night in Chinatown outside a modern trendy neo-Chinese restaurant (no traditional lanterns), shooting through floor-to-ceiling glass at a large round table with a lazy Susan, refined plated Chinese dishes and tea set. Minimal interior: dark wood, brass, marble, recessed warm lights and designer pendants. Fictional listed-AI chairman Adrian Cole—silver-white medium-length hair with a 3:7 side part, deep-emerald enamel-frame glasses, pure black suit, open white shirt, no tie, invented face—and Mira Solenne share a romantic happy dinner; he adjusts his enamel glasses while smiling; they gently clink small cups. Wet pavement and blurred Chinese neon outside. Telephoto paparazzi framing with subtle foreground blur. Mid-clip he notices the photographer; joy flips to fear; he points at the window toward the lens; a brief flash reflects in the glass. High detail faces that do not resemble real public figures. No leather jackets, no real restaurant names, no real brands, no chip-factory imagery, no sexual content. Pure fiction romance thriller beat.",
      variants: [{ modelSlug: "minimax", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep03-image",
      group: "image",
      title: "Image to video · motion",
      mode: "image",
      prompt: "Animate this still as a paparazzi shot through Chinatown neo-Chinese restaurant glass. Keep identities and framing: silver-white medium-length side-parted hair, deep-emerald enamel glasses, pure black suit, lazy Susan table. First he lightly pushes up his glasses and gently clinks a small tea or baijiu cup; then he notices the camera outside, smile collapses into shock, he raises his arm and points straight at the lens; the woman turns to look. Subtle handheld, optional shutter click timing mid-clip. No morph into real celebrities, no real restaurant signs becoming readable, no leather jacket, no NSFW.",
      variants: [
        { modelSlug: "kling", durationSeconds: 8, aspect: "9:16" },
        { modelSlug: "seedance", durationSeconds: 10, aspect: "16:9" },
        { modelSlug: "minimax", durationSeconds: 10, aspect: "16:9" },
      ],
    },
    {
      id: "ep01-kling",
      group: "episode",
      title: "Episode 01 · The Dance",
      mode: "text",
      prompt: "Romantic spy drama, fiction only. Earnings-week gala for fictional listed AI company Meridian Lattice AI. Adrian Cole—mid-50s, tall, silver-white medium-length hair with a 3:7 side part, deep-emerald enamel-frame glasses, pure black suit with open white shirt and no tie, invented face—invites Mira Solenne, early 30s in a dark evening dress, dark wavy hair, hazel eyes, invented face, to dance; he lightly pushes up his glasses before offering his hand. They waltz slowly under warm chandeliers; eyes locked; soft smiles; no real people. Elegant camera orbit, shallow depth of field, lush strings. Soft romance, no leather jacket, no NSFW, no real brand logos.",
      variants: [{ modelSlug: "kling", durationSeconds: 8, aspect: "16:9" }],
    },
    {
      id: "ep02-seedance",
      group: "episode",
      title: "Episode 02 · Rain & Umbrella",
      mode: "text",
      prompt: "Cinematic rain romance. Adrian Cole—silver-white medium-length 3:7-part hair, deep-emerald enamel glasses, pure black suit, open white shirt—and Mira Solenne share one black umbrella on a glossy street. He pulls her into a brief embrace; they share a soft, closed-mouth kiss; rain streaks on his glasses in the backlight. Tender, melancholic, PG romantic tone. Fictional adults with invented faces only. No bedroom, no undressing, no leather jacket, no explicit content, no likenesses of real people.",
      variants: [{ modelSlug: "seedance", durationSeconds: 8, aspect: "16:9" }],
    },
    {
      id: "ep04-minimax",
      group: "episode",
      title: "Episode 04 · The Tell",
      mode: "text",
      prompt: "Corporate romance beat after a paparazzi scare. Executive office at night. A tablet shows fictional text \"Meridian Lattice AI — MODEL WEIGHTS — RESTRICTED\" and \"Q-next roadmap\". Mira Solenne hesitates; Adrian Cole—silver-white medium-length 3:7-part hair, deep-emerald enamel glasses, pure black suit—flips a worn old coin between his fingers while thinking, then gently takes her hand for two seconds and releases it with a conflicted look. Soft lamp light, slow push-in. Fiction only, no real companies, no sexual content, AI platform company not a chip factory.",
      variants: [{ modelSlug: "minimax", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep05-kling",
      group: "episode",
      title: "Episode 05 · Rooftop Lights",
      mode: "text",
      prompt: "Vertical bittersweet ending. Rooftop overlooking a glowing city; a distant fictional ticker faintly reads \"FableX MLAT-AI\". Mira Solenne in a dark coat embraces Adrian Cole—silver-white medium-length 3:7-part hair, deep-emerald enamel glasses, pure black suit; a light farewell kiss; she walks to the stairwell; he stays alone, fastens the first button of his black jacket, and watches the lights. Slow crane up, romantic sadness, open ending. Fiction only, soft romance, no leather jacket, no NSFW, invented faces only.",
      variants: [{ modelSlug: "kling", durationSeconds: 10, aspect: "9:16" }],
    },
    {
      id: "trailer-minimax",
      group: "trailer",
      title: "Trailer mood (wide)",
      mode: "text",
      prompt: "Ultra-wide romantic trailer for a fictional AI-chairman spy love story. Quick beats: ballroom dance; rain-umbrella embrace and soft kiss silhouette; cut to paparazzi view through Chinatown neo-Chinese restaurant glass (lazy Susan, warm modern interior, blurred neon outside) as he points at the lens; cut to empty boardroom chair before dawn. No dialogue, lush score swell. Invented characters only, no red lanterns, no real celebrities, no explicit intimacy.",
      variants: [{ modelSlug: "minimax", durationSeconds: 6, aspect: "21:9" }],
    },
  ],
  imageToVideo: {
    title: "Image to video",
    steps: [
      "Generate a still: Chinatown night, modern neo-Chinese restaurant exterior (no red lanterns); paparazzi view through glass; lazy-Susan round table with refined Chinese dishes and tea set; dark wood/brass/marble interior; wet street + blurred Chinese neon; Adrian with silver-white medium-length 3:7-part hair, deep-emerald enamel glasses, pure black suit—invented faces only—**no** real reference photos or real restaurant names.",
      "Upload in [KakaReel image-to-video](/create?mode=image).",
      "Use the motion prompt above.",
      "Prefer Kling 8s 9:16 or Seedance 10s 16:9.",
      "QC for likeness drift, NSFW, and the point-at-lens beat.",
    ],
    
    
    
  },
  steps: [
    "Open [KakaReel Studio](/create).",
    "Pick Seedance 2.5 / Kling 3.0 / MiniMax H3.",
    "Paste an episode prompt—**never** replace names with real people.",
    "For the Hero hook (Ep03), start with the model-specific *Caught Through the Glass* prompt above, or use the **image-to-video** path.",
    "Set duration & aspect as recommended.",
    "Generate, review the full clip, export with a fiction label.",
    "Soft romance OK for fictional adults; if anything looks like a living public figure or turns NSFW, discard and rewrite.",
  ],
  faqs: [
    {
      question: "Is this based on real news?",
      answer: "No. Original fiction. Not about any real chairman, company, or investigation.",
    },
    {
      question: "Can I put real CEOs or real people in romantic or paparazzi scenes?",
      answer: "**No.** Real-person deepfakes—including fabricated kissing, hugging, or intimate acts involving living people—are banned. See [/acceptable-use](/acceptable-use).",
    },
    {
      question: "Can fictional characters kiss or hug?",
      answer: "**Yes, softly.** Dance, shared umbrella, hand-holding, embrace, and a light kiss are OK for invented adult characters. **No** bedrooms, nudity, or sexual/NSFW content.",
    },
    {
      question: "Can I use real tickers or real AI company names?",
      answer: "Please don’t. Use **Meridian Lattice AI** and **FableX: MLAT-AI**, or invent new fictional names.",
    },
    {
      question: "Chip / GPU company OK?",
      answer: "No—keep it an **AI model/platform** company.",
    },
    {
      question: "Why the Chinatown neo-Chinese restaurant paparazzi shot?",
      answer: "It is a short-form emotion-flip hook (happy → shock → points at camera) that fits a secret-romance beat while staying fictional—modern dining, not an old-school lantern restaurant.",
    },
    {
      question: "Which model first for Ep03?",
      answer: "Seedance 2.5 for glass ambience + shutter SFX; Kling 3.0 for vertical push-in and face change; MiniMax H3 for a polished 10s master.",
    },
  ],
  cta: {
    title: "Start with the glass.",
    body: "Paste the Chinatown neo-Chinese paparazzi dinner prompt—or begin Episode 01. Keep it fictional. Soft romance only.",
    button: "Create on KakaReel",
    footnote: "By generating, you agree to follow [/acceptable-use](/acceptable-use). Fiction only. **FableX: MLAT-AI** is not a real listing.",
  },
};

export const topics: Topic[] = [aiChairmanSpyRomance];

export function getTopic(slug: string): Topic | undefined {
  return topics.find((topic) => topic.slug === slug);
}

export function topicStaticParams(): { slug: string }[] {
  return topics.map((topic) => ({ slug: topic.slug }));
}

export function topicStudioHref(modelSlug: FamilySlug, mode: Mode): string {
  const params = new URLSearchParams({ model: modelSlug });
  if (mode === "image") params.set("mode", "image");
  return `/create?${params.toString()}`;
}
