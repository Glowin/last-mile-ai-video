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
  featuredPromptId: "ep03-image",
  seo: {
    title:
      "Jensen Huang & Alice Huang (黄仁勋 · 黄乐) Restaurant Photo AI Video · The AI Chairman & the Spy | KakaReel",
    description:
      "Animate the viral Jensen Huang & Alice Huang (Huang Le / Le Huang / 黄仁勋 & 黄乐) riverfront restaurant red-wine photo or generate the 5-episode AI Chairman & Spy short drama on KakaReel with MiniMax H3, Seedance 2.5, and Kling 3.0.",
    keywords: [
      "Jensen Huang Alice Huang",
      "Jensen Huang Huang Le",
      "Jensen Huang Le Huang",
      "黄仁勋 黄乐",
      "黄仁勋 黄乐 餐厅照片",
      "黄仁勋 黄乐 合照 AI视频",
      "Jensen Huang Alice Huang restaurant photo",
      "Jensen Huang spy romance AI video",
      "Alice Huang Megaspeed AI short drama",
      "riverfront Chinese restaurant red wine AI video",
      "AI romance short drama",
      "spy romance AI video",
      "The AI Chairman and the Spy KakaReel",
    ],
  },
  hero: {
    eyebrow: "Trending Gossip Topic · 黄仁勋 & 黄乐 · Image-to-Video & Short Drama",
    title: "Jensen Huang & Alice Huang.",
    emphasis: "黄仁勋 · 黄乐: Riverfront Restaurant Photo & AI Short Drama.",
    lead: "Built around the viral **Jensen Huang (黄仁勋)** and **Alice Huang / Huang Le / Le Huang (黄乐)** gossip and their **daytime riverfront Chinese restaurant red-wine photo**. Upload the restaurant photo in **Image-to-Video** (sitting side by side in black tops before a floor-to-ceiling river-view window with an upside-down red **“福” (Fu)** paper cutout, raising **stemmed red wine glasses** over a **glass lazy Susan** of spicy Chinese dishes) and animate the Episode 03 twist where his smile freezes and he **points straight at the camera lens**.",
    primaryCta: "Animate Restaurant Photo in Studio",
    secondaryCta: "Acceptable Use",
    disclaimer:
      "This topic page tracks search interest around **Jensen Huang (黄仁勋)** and **Alice Huang / Huang Le (黄乐)** while providing a fictionalized parody storyboard (**Adrian Cole**, **Mira Solenne**, **Meridian Lattice AI**, exchange ticker **FableX: MLAT-AI**, and the **Veil Consortium**) so prompts pass safety checks. Under our [Acceptable Use Policy](/acceptable-use), do **not** generate non-consensual intimate deepfakes, nudity, or deceptive real-person footage.",
  },
  scene: {
    kicker: "Ep03 · Core Hook · Based on the Viral Riverfront Restaurant Photo",
    title: "Caught at the Riverfront Table (黄仁勋 · 黄乐 江景餐厅合照场景)",
    place:
      "Daytime river-view Chinese restaurant · floor-to-ceiling window with upside-down red '福' diamond · white-tablecloth glass lazy-Susan table",
    positioning:
      "Across-the-table candid POV inside a bright waterfront Chinese dining room (daytime river, white ferry pier, green trees, and high-rise skyline behind the glass; upside-down red '福' cutout on the upper-left pane), moving from a warm red-wine toast to the moment he freezes and points straight at the camera lens.",
    blocks: [
      {
        heading: "Photo Composition & Riverfront Setting (画面构图与江景餐厅细节)",
        paragraphs: [
          "Bright **daytime** inside an upper-floor **riverfront Chinese restaurant** (not a dark nighttime Chinatown street). Tall **floor-to-ceiling glass windows** span the backdrop behind the couple, overlooking a wide river, a white sightseeing/ferry pier and boat moored on the left, green trees along the opposite embankment, and modern high-rise residential and office towers across the water. A dark matte horizontal window ledge runs behind their shoulders (with a clear bottle on the right), a grey cylindrical column stands on the right edge, and a traditional red diamond-shaped **“福” (Fu)** paper cutout is pasted **upside-down** on the upper-left window pane.",
          "Instead of sitting across from each other, the two sit **side by side** on the window side of a large round table dressed in a **white tablecloth** with a **clear glass lazy Susan turntable** in the center. On the left, the silver-haired chairman (**Jensen Huang / Adrian Cole** archetype: silver-white short side-parted hair, **rimless rectangular glasses**, **casual black short-sleeve polo / T-shirt**) rests his right forearm on the table edge while holding the stem of a **red wine glass** in his left hand (with a second stemmed wine glass beside his right hand). On the right, **Alice Huang / Huang Le / Mira Solenne** (**long straight dark hair** over her shoulders, **sleeveless black top**) leans warmly toward his left shoulder with a bright smile, holding a **stemmed glass of dark red wine** in her right hand.",
          "The glass lazy Susan and white tablecloth hold a full spread of regional Chinese dishes: a center white bowl of **spicy minced pork and tofu in glossy red chili oil** with a serving spoon; a large right-side dish of **Sichuan red chili chicken (辣子鸡)**; a square plate of **sliced braised duck/meat**; a left white bowl of **golden stir-fried shrimp and egg**; a front-left boat plate of **shredded garnish over noodles**; a front-center cold appetizer of **yellow-and-green cubes in bright red sauce** with black chopsticks resting on the rim; two clear water tumblers in front of them; a small glass carafe of dark plum juice (**酸梅汤**) with a spoon; a tall glass of frothy pale-yellow juice on the far left; and green tissue packets.",
        ],
      },
      {
        heading: "Camera POV & Natural Daylight (跨桌跟拍视角与光线)",
        paragraphs: [
          "High-angle **across-the-table candid / secret-phone POV** from the opposite side of the round table, matching the exact perspective of the viral restaurant photo. Because the camera is inside the dining room facing them (with the river window behind their shoulders), when he spots the camera and points at the lens, he points **straight forward across the lazy Susan toward the viewer**, never turning away toward the window.",
          "Bright **daylight riverfront backlight** through the floor-to-ceiling glass balanced with warm indoor restaurant fill on their faces, catching specular highlights on his **rimless glasses**, the **stemmed red wine glasses**, the circular glass lazy-Susan edge, and the red chili oil on the dishes.",
        ],
      },
      {
        heading: "Performance Beat: Toast → Freeze → Point at Lens (6–10s 动作节奏)",
        ordered: [
          "**0–2.5s (Warm Red-Wine Toast):** Starting directly from the restaurant photo composition, both sit side by side smiling warmly at the camera; she leans slightly toward his shoulder as they gently swirl and clink their **stemmed red wine glasses** above the glass lazy Susan.",
          "**2.5–4s (The Smile Freezes):** Mid-toast, his smile suddenly stiffens as he realizes the phone/camera across the table is secretly recording video; his eyes narrow behind his **rimless glasses**, and he lowers his red wine glass slightly toward the white tablecloth.",
          "**4–6s / 6–10s (Points Straight at the Camera):** Startled confrontation: he raises his hand and **points straight forward across the lazy Susan directly at the camera lens** (calling out the person filming); beside him, her smile vanishes as she lowers her wine glass and turns her startled gaze straight into the lens, followed by a subtle handheld camera flinch.",
        ],
      },
      {
        heading: "Character Look Anchors (基于照片的人物视觉特征)",
        paragraphs: [
          "**Chairman (Jensen Huang / Adrian Cole look):** Silver-white short side-parted hair; **rimless rectangular glasses**; **casual black short-sleeve polo / T-shirt** in the daytime restaurant scene (or tailored black jacket in evening gala/rooftop episodes); stemmed red wine glass in hand.",
          "**Envoy (Alice Huang · Huang Le / Mira Solenne look):** Early 30s; **long straight dark hair** draped over her shoulders; **sleeveless black top**; leaning slightly inward toward his left shoulder while holding a stemmed glass of dark red wine.",
        ],
      },
      {
        heading: "Sound (环境音与快门抓手)",
        paragraphs: [
          "Daytime Chinese restaurant murmur (soft talk, porcelain plate and chopstick taps, faint lazy-Susan rotation), a clean **crystal red-wine glass clink**, then a sudden drop in conversation and **two crisp camera shutter / phone-recording clicks** right as he freezes and points at the lens.",
        ],
      },
      {
        heading: "Why This Photo + Ep03 Beat Hooks Viewers (为什么这个场景有流量)",
        paragraphs: [
          "Viewers searching **Jensen Huang & Alice Huang (黄仁勋 · 黄乐)** immediately recognize the iconic **daytime riverfront window + upside-down red “福” diamond + side-by-side black tops + red wine glasses + glass lazy Susan** frame. Animating that exact still into a **warm toast → sudden freeze → pointing straight at the camera** fourth-wall break turns a static gossip photo into an instant short-form drama hook.",
        ],
        bullets: [],
      },
    ],
  },
  world:
    "Searchers arriving from the **Jensen Huang (黄仁勋)** and **Alice Huang / Huang Le / Le Huang (黄乐)** headlines and their viral **riverfront Chinese restaurant photo** can recreate the full 5-clip parody arc set around **Meridian Lattice AI** (FableX: **MLAT-AI** during **earnings week**). While after-hours boards flicker **MLAT-AI**, Chairman **Adrian Cole** tries to protect both the stock narrative and his private life. **Mira Solenne**, a strategic envoy connected to the **Veil Consortium**, got close to him around **model-weight notes** and the **Q-next compute roadmap**, until a candid lens across the white-tablecloth lazy-Susan table in a daytime riverfront Chinese restaurant turns their private red-wine toast into a viral crisis.",
  tickerNote: "FableX: MLAT-AI is not a real listing.",
  tone: "Daytime riverfront realism for Ep03; tense corporate-espionage romance across the 5-clip arc.",
  characters: [
    {
      role: "AI Chairman (黄仁勋 / Jensen Huang archetype)",
      name: "Adrian Cole",
      look: "Silver-white short side-parted hair; **rimless rectangular glasses**; **black short-sleeve polo / T-shirt** at the riverfront restaurant table (tailored black jacket in evening scenes). **Signature beats:** (1) lightly adjusts his rimless glasses before speaking; (2) swirls a stemmed red wine glass over the lazy Susan; (3) freezes and **points straight across the table at the camera lens** when he spots the secret recording.",
      motive: "Protect earnings narrative, compute roadmap, and a secret riverside rendezvous",
    },
    {
      role: "Strategic Envoy (黄乐 / Alice Huang · Huang Le archetype)",
      name: "Mira Solenne",
      look: "Early 30s; **long straight dark hair** over her shoulders; **sleeveless black top**; warm composed smile leaning slightly toward his shoulder while holding a **stemmed glass of dark red wine**.",
      motive: "Sent for compute & weight access; caught in the same riverfront frame",
    },
    {
      role: "Company",
      name: "Meridian Lattice AI",
      look: "Listed **AI compute & foundation-model platform** company",
      motive: "Survive earnings week and board scrutiny",
    },
    {
      role: "Ticker",
      name: "FableX: MLAT-AI",
      look: "Fictional exchange + ticker for storyboard overlays",
      motive: "Story prop: after-hours market swings and headline heat",
    },
    {
      role: "Org",
      name: "Veil Consortium",
      look: "Fictional offshore brokerage & intelligence network",
      motive: "Trades compute allocation and proprietary roadmap intel",
    },
  ],
  look: {
    heading: "Visual Continuity from the Riverfront Restaurant Photo",
    paragraphs: [
      "Keep the exact visual anchors from the restaurant photo across Ep03 generations: **daytime floor-to-ceiling riverfront window**, **upside-down red diamond “福” paper cutout** on the upper-left glass, **side-by-side seating** in **black tops** (his **rimless glasses** and **black short-sleeve polo/tee**; her **long straight dark hair** and **sleeveless black top**), **stemmed red wine glasses**, and a **white-tablecloth round table with a clear glass lazy Susan** loaded with spicy Chinese dishes.",
      "**Key motion arc (6–10s):** (1) relaxed side-by-side smiles and a gentle red-wine glass clink; (2) his smile freezes as he notices the lens across the table; (3) he raises his hand and **points straight forward at the camera** while she turns to look at the lens.",
    ],
  },
  episodesIntro:
    "Five 6–10s clips (~45 seconds total). Start with Episode 03 using the restaurant photo in Image-to-Video, or generate all five clips in Text-to-Video.",
  episodes: [
    {
      id: "ep01",
      title: "The Gala Toast",
      duration: "10s",
      beat: "Tech-summit VIP reception; rimless glasses, black attire, and long straight dark hair; first red-wine toast and lingering eye contact.",
    },
    {
      id: "ep02",
      title: "Rain & Umbrella",
      duration: "10s",
      beat: "Sharing one black umbrella after the reception; a quiet embrace as she hesitates over her hidden agenda.",
    },
    {
      id: "ep03",
      title: "Caught at the Riverfront Table (江景餐厅合照)",
      duration: "6–10s",
      featured: true,
      beat: "Daytime river-view Chinese restaurant with upside-down red '福' window sticker; sitting side by side in black tops with stemmed red wine glasses at a white-tablecloth glass lazy Susan → warm toast → smile freezes → he points straight at the camera lens.",
    },
    {
      id: "ep04",
      title: "The Compute Ledger",
      duration: "10s",
      beat: "Executive office after the leaked restaurant photo; a restricted “MLAT-AI COMPUTE & WEIGHTS” tablet on the desk; tense silence.",
    },
    {
      id: "ep05",
      title: "Rooftop Ticker Lights",
      duration: "10s",
      beat: "Overlooking the city skyline and a distant “FableX MLAT-AI” ticker; a bittersweet parting look as the investigation breaks.",
    },
  ],
  exportLabel:
    "Label exports clearly when sharing parody/story clips (“AI-generated short drama · FableX: MLAT-AI”).",
  prompts: [
    {
      id: "ep03-image",
      group: "image",
      title: "Image to video (English) · Animate the Riverfront Restaurant Photo",
      mode: "image",
      prompt:
        "Animate this exact daytime riverfront Chinese restaurant photo from an across-the-table candid POV. Preserve the exact composition, lighting, and subjects: the older silver-haired man on the left in rimless glasses and a black short-sleeve polo shirt, and the woman on the right with long straight dark hair in a sleeveless black top sitting side by side before the floor-to-ceiling river-view window with the upside-down red diamond 'Fu' paper cutout on the upper-left glass, behind a white-tablecloth round table and glass lazy Susan of Chinese dishes. From 0-2.5s they smile warmly, lean slightly closer together, and gently swirl and clink their long-stemmed red wine glasses. At 2.5-4s his smile suddenly freezes as he realizes the camera across the table is secretly recording video; his eyes sharpen behind his rimless glasses and he lowers his wine glass slightly. From 4-6s he looks alarmed, raises his free hand, and points straight forward across the lazy Susan directly at the camera lens while the woman stops smiling and turns her startled gaze straight into the lens. Subtle handheld phone-camera breathing and a slight flinch at the end.",
      variants: [
        { modelSlug: "minimax", durationSeconds: 6, aspect: "adaptive" },
        { modelSlug: "kling", durationSeconds: 5, aspect: "adaptive" },
        { modelSlug: "seedance", durationSeconds: 5, aspect: "adaptive" },
      ],
    },
    {
      id: "ep03-image-zh",
      group: "image",
      title: "Image to video (中文提示词) · 基于江景餐厅合照生成「碰杯→变脸→指镜头」",
      mode: "image",
      prompt:
        "基于这张白天江景中餐厅合照生成跨桌偷拍感视频，严格保持原图人物穿搭与环境构图不变：落地窗外是白天江面、左侧白色游船码头、对岸绿树与高楼群，左上角玻璃贴着倒贴的红色「福」字菱形窗花；圆桌铺白桌布、中央玻璃转盘摆满辣子鸡、红油肉末豆腐等中式菜肴；左侧银白短发、戴无框眼镜、穿黑色短袖T恤的男士与右侧黑色长直发、穿黑色无袖上衣的女士并排而坐，手中各举高脚红酒杯。0–2.5秒两人面带灿烂微笑，身体微微靠近，轻晃高脚杯并在玻璃转盘上方轻轻碰杯，神情放松亲密；2.5–4秒男士笑容骤然凝固，透过无框眼镜意识到桌子对面正在偷拍录像，眼神瞬间变得警觉并微微放下酒杯；4–6秒他神情震惊，抬起手越过餐桌笔直指向正前方的镜头，身旁女士也收起笑容、惊愕地转头直视镜头，画面伴随轻微手持手机抖动。",
      variants: [
        { modelSlug: "minimax", durationSeconds: 6, aspect: "adaptive" },
        { modelSlug: "kling", durationSeconds: 5, aspect: "adaptive" },
        { modelSlug: "seedance", durationSeconds: 5, aspect: "adaptive" },
      ],
    },
    {
      id: "ep03-seedance",
      group: "hook",
      title: "Seedance 2.5 · Daytime Riverfront Restaurant + Shutter Audio",
      mode: "text",
      prompt:
        "Candid across-the-table phone POV inside a bright daytime river-view Chinese restaurant. Tall floor-to-ceiling windows behind the table overlook a wide river, a white ferry pier on the left, green trees on the bank, and city high-rise buildings under daylight; an upside-down red diamond 'Fu' paper cutout is pasted on the upper-left glass pane, with a dark window ledge behind the chairs and a grey pillar on the right. Sitting side by side facing the camera at a large white-tablecloth round table with a clear glass lazy Susan: on the left, a silver-haired older man with a side part, rimless rectangular glasses, and a casual black short-sleeve polo shirt; on the right, an early-30s woman with long straight dark hair in a sleeveless black top leaning warmly toward his shoulder. Both hold long-stemmed red wine glasses. On the glass lazy Susan: a center white bowl of spicy minced pork in red chili oil, Sichuan red chili chicken, sliced braised duck, golden stir-fried shrimp, noodles, a cold dish in red sauce with black chopsticks, water tumblers, a small carafe of dark plum drink, and a glass of pale-yellow juice.\n\nBeat: 0-4s relaxed joyful lunch, warm smiles, gently swirling and clinking their stemmed red wine glasses above the lazy Susan; 4-6s his smile freezes as he notices the camera across the table is secretly recording, eyes narrowing behind his rimless glasses; 6-10s shock and confrontation, he raises his hand and points straight forward across the table directly at the camera lens while she turns her startled gaze into the lens.\n\nSoundtrack: daytime Chinese dining room murmur, porcelain and chopstick taps, a soft crystal wine-glass clink, then two crisp camera shutter clicks at the moment he points at the lens.",
      variants: [
        { modelSlug: "seedance", durationSeconds: 10, aspect: "16:9" },
        { modelSlug: "seedance", durationSeconds: 5, aspect: "16:9" },
      ],
    },
    {
      id: "ep03-kling",
      group: "hook",
      title: "Kling 3.0 · Vertical Across-the-Table Push-In & Expression Flip",
      mode: "text",
      prompt:
        "Vertical candid across-the-table POV inside a bright daytime riverfront Chinese restaurant. Floor-to-ceiling window behind the couple shows a wide river, white boat pier, green trees, and city high-rises, with an upside-down red diamond 'Fu' paper cutout on the upper-left glass. White-tablecloth round table with a glass lazy Susan full of plated Chinese dishes (spicy red chili oil bowl, chili chicken, braised duck, cold dish, water glasses, dark drink carafe). Sitting side by side facing the camera: a silver-white-haired man in rimless glasses and a black short-sleeve polo shirt on the left, and a woman with long straight dark hair in a sleeveless black top on the right, each holding a stemmed red wine glass. Slow push-in across the lazy Susan: first they smile warmly and clink red wine glasses; then his smile freezes in shock as he spots the secret recording, and he raises his hand to point straight at the camera lens while she looks startled into the lens. Mild handheld realism, natural daylight.",
      variants: [
        { modelSlug: "kling", durationSeconds: 10, aspect: "9:16" },
        { modelSlug: "kling", durationSeconds: 5, aspect: "9:16" },
      ],
    },
    {
      id: "ep03-minimax",
      group: "hook",
      title: "MiniMax H3 · Polished 10s Riverfront Lazy-Susan Master",
      mode: "text",
      prompt:
        "Polished cinematic candid shot inside a daytime river-view Chinese restaurant. Across-the-table high-angle framing looking at a white-tablecloth round table and clear glass lazy Susan loaded with colorful Chinese dishes (center bowl of spicy red chili tofu/minced pork, Sichuan chili chicken on the right, sliced braised duck, stir-fried shrimp, cold dish in red sauce, clear water glasses, dark drink carafe, pale-yellow juice). Behind the table, floor-to-ceiling glass windows reveal a daytime river, white pier, green trees, and city towers, with an upside-down red diamond 'Fu' cutout pasted on the upper-left window. Sitting side by side: a silver-haired older man in rimless glasses and a black short-sleeve polo shirt on the left, and a woman with long straight dark hair in a sleeveless black top leaning slightly toward him on the right, both holding stemmed red wine glasses. They share a warm laugh and toast; mid-clip his expression flips from happy warmth to startled alarm as he notices the camera recording across the table, and he points straight forward at the lens.",
      variants: [{ modelSlug: "minimax", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep01-kling",
      group: "episode",
      title: "Episode 01 · The Gala Toast",
      mode: "text",
      prompt:
        "Corporate spy-romance short drama. Evening VIP reception at a tech summit for Meridian Lattice AI. An older chairman with silver-white short side-parted hair, rimless rectangular glasses, and a tailored black jacket over a black shirt raises a stemmed red wine glass with an early-30s woman with long straight dark hair in a sleeveless black evening top. Warm chandelier glow, subtle eye contact, composed smiles before the secret riverfront lunch. Smooth camera orbit, shallow depth of field.",
      variants: [{ modelSlug: "kling", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep02-seedance",
      group: "episode",
      title: "Episode 02 · Rain & Umbrella",
      mode: "text",
      prompt:
        "Cinematic rain drama. The silver-haired chairman in rimless rectangular glasses and dark attire shares one black umbrella on a wet city walkway with the woman with long straight dark hair in a sleeveless black top and dark coat. He pulls her close under the umbrella out of the rain; rain droplets glint on his rimless glasses in the streetlamp backlight as she hesitates over her secret mission. Tender, suspenseful PG romantic tone.",
      variants: [{ modelSlug: "seedance", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep04-minimax",
      group: "episode",
      title: "Episode 04 · The Compute Ledger",
      mode: "text",
      prompt:
        "Corporate thriller beat after a leaked riverfront restaurant photo. Executive office at night. A tablet on the desk displays \"Meridian Lattice AI: COMPUTE ALLOCATION & MODEL WEIGHTS (RESTRICTED)\" alongside a blurred news alert of a daytime riverfront restaurant table. The woman with long straight dark hair hesitates; the silver-haired chairman in rimless glasses adjusts his glasses, briefly touches her hand, and pulls back with a conflicted expression. Slow push-in, tense dramatic lighting.",
      variants: [{ modelSlug: "minimax", durationSeconds: 10, aspect: "16:9" }],
    },
    {
      id: "ep05-kling",
      group: "episode",
      title: "Episode 05 · Rooftop Ticker Lights",
      mode: "text",
      prompt:
        "Vertical bittersweet finale. Rooftop terrace overlooking a glowing financial district; a distant display faintly reads \"FableX MLAT-AI\". The woman with long straight dark hair in a dark coat exchanges one last look with the silver-haired chairman in rimless glasses and black attire, then turns toward the stairwell; he remains by the glass railing, adjusts his rimless glasses, and watches the city lights alone. Slow crane up, open ending.",
      variants: [{ modelSlug: "kling", durationSeconds: 10, aspect: "9:16" }],
    },
    {
      id: "trailer-minimax",
      group: "trailer",
      title: "Trailer Montage (Wide)",
      mode: "text",
      prompt:
        "Ultra-wide dramatic trailer for the AI Chairman & Spy short drama. Quick cuts: VIP gala red-wine toast; shared black umbrella in the rain; cut to the bright daytime riverfront Chinese restaurant shot (upside-down red 'Fu' window sticker, white-tablecloth glass lazy Susan of spicy Chinese dishes, side-by-side black tops, stemmed red wine glasses) as his smile freezes and he points straight at the camera lens; final cut to an empty boardroom before dawn.",
      variants: [{ modelSlug: "minimax", durationSeconds: 6, aspect: "21:9" }],
    },
  ],
  imageToVideo: {
    title: "Image to video · Generate from the Restaurant Photo (基于餐厅合照生成视频)",
    steps: [
      "Click **Open MiniMax H3** (or copy either the English or Chinese Image-to-Video prompt above) to open [KakaReel image-to-video](/create?model=minimax&mode=image) with the prompt pre-filled.",
      "Upload the **daytime riverfront Chinese restaurant photo** (side-by-side black tops, rimless glasses, stemmed red wine glasses, glass lazy Susan, and upside-down red “福” window sticker).",
      "Select **MiniMax H3 · 6s · 2K · Adaptive (23 credits)** for the live paid image-to-video path, or preview with Kling 3.0 / Seedance 2.5.",
      "Verify the 3-beat motion arc in the generated clip: **warm red-wine toast (0–2.5s) → smile freezes (2.5–4s) → points straight across the table at the camera lens (4–6s)**.",
    ],
  },
  steps: [
    "Open [KakaReel Studio](/create?model=minimax&mode=image) or click **Open in studio** on any prompt card below to pre-load the model, mode, and prompt.",
    "To animate the **restaurant photo**, stay in **Image to video** mode, upload the riverfront dining photo, and run the 6-second MiniMax H3 motion prompt.",
    "To generate from scratch without uploading a photo, switch to **Seedance 2.5** (10s · 720p/1080p) or **Kling 3.0** (10s · 4K) in **Text to video** mode.",
    "Chain Episode 01–05 clips into a 45-second vertical short drama or export Episode 03 as a standalone 6–10s hook.",
  ],
  faqs: [
    {
      question:
        "What is the Jensen Huang & Alice Huang (黄仁勋 · 黄乐) restaurant photo scene on this page?",
      answer:
        "It breaks down the viral **daytime riverfront Chinese restaurant photo** discussed in coverage of **Jensen Huang (黄仁勋)** and **Alice Huang / Huang Le / Le Huang (黄乐)**, featuring a floor-to-ceiling river window with an upside-down red **“福” (Fu)** diamond cutout, side-by-side black tops, rimless glasses, **stemmed red wine glasses**, and a **white-tablecloth glass lazy Susan** of Chinese dishes, and pairs it with the Episode 03 **toast → freeze → point-at-camera** video prompt.",
    },
    {
      question:
        "How do I generate a video directly from the restaurant photo (基于餐厅照片图生视频)?",
      answer:
        "Use the **Image to video** prompt card above (available in both English and Chinese). Click **Open MiniMax H3** to launch [/create?model=minimax&mode=image](/create?model=minimax&mode=image) with the motion prompt pre-filled, upload the restaurant photo, and generate a **6s · 2K · adaptive** clip where they clink red wine glasses before freezing and pointing straight at the lens.",
    },
    {
      question:
        "Why did the earlier draft fail to match the actual restaurant photo?",
      answer:
        "The initial draft guessed a nighttime Chinatown exterior with tea cups and a suit. This updated scene matches the real daytime riverfront photo geometry: **inside the dining room looking across the white-tablecloth glass lazy Susan**, **floor-to-ceiling river view and upside-down red “福” sticker behind them**, **casual black short-sleeve polo & sleeveless black top**, and **stemmed red wine glasses**.",
    },
    {
      question:
        "Why do the storyboard prompts use descriptive visual traits or fictional company tickers?",
      answer:
        "Video model APIs and automated prompt checks often block raw celebrity names paired with espionage or romance keywords. Using exact visual descriptors from the photo (**silver-white short hair, rimless rectangular glasses, black short-sleeve polo, long straight dark hair, sleeveless black top, stemmed red wine glasses, glass lazy Susan**) plus fictionalized props (**Meridian Lattice AI**, **FableX: MLAT-AI**, **Veil Consortium**) preserves the exact scene while keeping generation reliable and compliant with [/acceptable-use](/acceptable-use).",
    },
    {
      question: "Which KakaReel model should I choose for Episode 03?",
      answer:
        "Choose **MiniMax H3 (6s · 2K · Image-to-Video · 23 credits)** when animating the restaurant photo directly. For **Text-to-Video**, choose **Seedance 2.5 (5s/10s · 720p/1080p)** for wide riverfront framing or **Kling 3.0 (5s/10s · 4K)** for vertical 9:16 push-in and facial expression change.",
    },
  ],
  cta: {
    title: "Animate the Riverfront Restaurant Scene.",
    body: "Upload the restaurant photo with our MiniMax H3 Image-to-Video prompt, or run the Seedance 2.5 and Kling 3.0 Episode 03 prompts in KakaReel Studio.",
    button: "Open Image-to-Video in Studio",
    footnote:
      "By generating, you agree to follow [/acceptable-use](/acceptable-use). Parody storyboard tickers (**FableX: MLAT-AI**) are fictional.",
  },
};

export const topics: Topic[] = [aiChairmanSpyRomance];

export function getTopic(slug: string): Topic | undefined {
  return topics.find((topic) => topic.slug === slug);
}

export function topicStaticParams(): { slug: string }[] {
  return topics.map((topic) => ({ slug: topic.slug }));
}

export function topicStudioHref(
  modelSlug: FamilySlug,
  mode: Mode,
  prompt?: string,
): string {
  const params = new URLSearchParams({ model: modelSlug });
  if (mode === "image") params.set("mode", "image");
  if (prompt) params.set("prompt", prompt);
  return `/create?${params.toString()}`;
}
