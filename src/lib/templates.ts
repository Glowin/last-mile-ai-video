import type { FamilySlug, Mode } from "./models";

export type VideoTemplate = {
  slug: string;
  name: string;
  pageTitle: string;
  h1: string;
  eyebrow: string;
  description: string;
  lead: string;
  modelSlug: FamilySlug;
  modelLabel: string;
  mode: Mode;
  specShorthand: string;
  specPills: readonly string[];
  defaultPrompt: string;
  inputGuidance: readonly string[];
  steps: readonly { title: string; text: string }[];
  variations: readonly {
    title: string;
    spec: string;
    prompt: string;
    note: string;
  }[];
  troubleshooting: readonly {
    issue: string;
    fix: string;
  }[];
  faqs: readonly [string, string][];
};

export const templates: readonly VideoTemplate[] = [
  {
    slug: "no-ordinary-love",
    name: "No Ordinary Love AI Animation Template",
    pageTitle: "No Ordinary Love AI Animation Template – MiniMax H3 | KakaReel",
    h1: "No Ordinary Love AI Animation Template",
    eyebrow: "IMAGE-TO-VIDEO TEMPLATE · MINIMAX H3",
    description:
      "Turn a portrait or character illustration into a cinematic 6-second animation with the No Ordinary Love AI animation template on KakaReel. 6s · 2K · 23 credits with MiniMax H3 image-to-video.",
    lead:
      "Upload one portrait or stylized character frame and animate subtle expression, breathing light, and a slow camera push. Pre-configured for MiniMax H3 image-to-video at 6s · 2K · 23 credits.",
    modelSlug: "minimax",
    modelLabel: "MiniMax H3 image-to-video",
    mode: "image",
    specShorthand: "6s · 2K · 23 credits",
    specPills: [
      "6s · 2K · 23 credits",
      "MiniMax H3 image-to-video",
      "Adaptive aspect ratio",
      "1 JPEG / PNG up to 3 MB",
    ],
    defaultPrompt:
      "The subject holds a quiet, emotional gaze as soft evening light shifts across their face. Gentle breathing motion, a subtle blink, and hair moving slightly in a warm breeze while the camera slowly pushes in, cinematic shallow depth of field.",
    inputGuidance: [
      "One clear front or three-quarter portrait, couple frame, or stylized character illustration (JPEG or PNG up to 3 MB).",
      "Even facial lighting with unobstructed eyes and jawline reduces face drift during the 6-second camera move.",
      "Output follows the uploaded image's aspect ratio (adaptive) at 2K resolution.",
    ],
    steps: [
      {
        title: "Open with preset settings",
        text: "Launch the studio with MiniMax H3 image-to-video, 6s · 2K · 23 credits, and the No Ordinary Love motion prompt pre-filled.",
      },
      {
        title: "Upload your starting frame",
        text: "Select one JPEG or PNG up to 3 MB that you have permission to use. The browser normalizes the image before requesting a quote.",
      },
      {
        title: "Quote and generate",
        text: "Review the 23-credit quote (or use an invite preview code), submit once, and save the finished MP4 when delivery is verified.",
      },
    ],
    variations: [
      {
        title: "Neon window reflection",
        spec: "6s · 2K · 23 credits · Adaptive",
        prompt:
          "Soft rain streaks down a glass window in the foreground as warm neon reflections glide across the subject's face. A slow, tender blink and a subtle turn toward the camera as the lens gently pushes in.",
        note: "Best for moody evening portraits and illustrated character close-ups.",
      },
      {
        title: "Golden-hour stillness",
        spec: "6s · 2K · 23 credits · Adaptive",
        prompt:
          "Warm late-afternoon sunlight moves across the scene. Dust motes drift slowly in the air, fabric and hair shift in a gentle breeze, and the subject's expression softens into a quiet smile.",
        note: "Works well with outdoor portraits, album-cover art, and warm editorial frames.",
      },
      {
        title: "Candlelit duet frame",
        spec: "6s · 2K · 23 credits · Adaptive",
        prompt:
          "Two figures remain close in warm low-key light. Subtle breathing motion, soft eye contact, and flickering ambient light across their shoulders while the camera performs a slow, steady dolly in.",
        note: "Use a single composed image containing both characters with clear separation.",
      },
    ],
    troubleshooting: [
      {
        issue: "Facial features warp or drift near the end of the clip",
        fix: "Avoid asking for large head turns or multiple expressions in 6 seconds. Keep the prompt focused on one subtle expression and a slow camera push.",
      },
      {
        issue: "Background moves more than the character",
        fix: "Name the subject's micro-action first (blink, breathing, slight head tilt) before describing ambient light or camera motion.",
      },
      {
        issue: "Generation fails or times out",
        fix: "Confirmed provider failures release reserved credits automatically. If a task shows an uncertain status, check My videos in the studio rather than submitting a duplicate request.",
      },
    ],
    faqs: [
      [
        "How many credits does the No Ordinary Love template use?",
        "Each paid generation uses the verified MiniMax H3 image-to-video setting: 6s · 2K · 23 credits. One Starter Pack (US$19 + applicable taxes for 150 AI video credits) covers six 23-credit clips with 12 credits remaining.",
      ],
      [
        "What image format and size should I upload?",
        "Upload one JPEG or PNG up to 3 MB. MiniMax H3 image-to-video uses adaptive framing so the output matches the aspect ratio of your starting image.",
      ],
      [
        "Can I edit the prompt before generating?",
        "Yes. Clicking any template button opens the KakaReel studio with the model, mode, and prompt pre-filled. You can edit every word before requesting a 5-minute credit quote.",
      ],
    ],
  },
] as const;

export function getTemplate(slug: string): VideoTemplate | undefined {
  return templates.find((t) => t.slug === slug);
}
