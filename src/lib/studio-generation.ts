import type { PublicJob } from "./models";

export type StudioSafety = {
  policyVersion: string;
  status: "checking" | "review" | "allowed" | "blocked" | "expired" | "error" | "canceled";
  reason: string | null;
  attempts: number;
  deadlineAt: string;
  imageReview: "not_applicable" | "not_reviewed_mvp";
  outputReview: "not_reviewed_mvp";
};

export type StudioJob = PublicJob & {
  billingMode?: "preview" | "paid";
  credits?: number;
  creditState?: "none" | "reserved" | "consumed" | "released";
  reviewRequired?: boolean;
  moderation?: { phase: "input" | "output"; state: "pending" | "approved" | "rejected" | "expired"; version: number }[] | null;
  safety?: StudioSafety | null;
};

export function studioJobState(job: StudioJob) {
  if (job.safety) {
    // An unsuccessful text check never permits delivery. Terminal job outcomes
    // outrank stale checking/review metadata, so history cannot restart a spinner.
    if (["blocked", "expired", "error", "canceled"].includes(job.safety.status) || job.status === "failed")
      return { phase: "failed", label: "Failed", active: false, unresolved: false } as const;
    if (job.status === "success") return job.resultUrl
      ? { phase: "success", label: "Ready", active: false, unresolved: false } as const
      : { phase: "unknown", label: "Confirming result", active: false, unresolved: true } as const;
    if (job.safety.status === "checking")
      return { phase: "safety-check", label: "Safety check in progress", active: true, unresolved: true } as const;
    if (job.safety.status === "review")
      return { phase: "safety-review", label: "Safety check pending confirmation", active: false, unresolved: true } as const;
    if (job.status === "unknown")
      return { phase: "unknown", label: "Confirming result", active: false, unresolved: true } as const;
    return { phase: "generating", label: "Generating", active: true, unresolved: true } as const;
  }
  // Only the latest decision for each phase describes the current review.
  const reviews = (["input", "output"] as const).flatMap((phase) => {
    const latest = job.moderation?.filter((r) => r.phase === phase)
      .sort((a, b) => b.version - a.version)[0];
    return latest ? [latest] : [];
  });
  const declined = reviews.find((r) => r.state === "rejected" || r.state === "expired");
  if (declined) return { phase: "failed", label: declined.state === "rejected" ? "Legacy content review declined" : "Legacy content review expired", active: false, unresolved: false } as const;
  const pending = reviews.find((r) => r.state === "pending");
  if (pending) return { phase: `${pending.phase}-review`, label: pending.phase === "input" ? "Legacy: awaiting input review" : "Legacy: awaiting output review", active: false, unresolved: true } as const;
  if (job.reviewRequired) return { phase: "review", label: "Legacy: on hold for review", active: false, unresolved: true } as const;
  switch (job.status) {
    case "submitting": return { phase: "submitting", label: "Submitting", active: true, unresolved: true } as const;
    case "pending": return { phase: "generating", label: "Generating", active: true, unresolved: true } as const;
    case "unknown": return { phase: "unknown", label: "Outcome unconfirmed", active: false, unresolved: true } as const;
    case "failed": return { phase: "failed", label: "Generation failed", active: false, unresolved: false } as const;
    case "success": return { phase: "success", label: "Ready", active: false, unresolved: false } as const;
  }
}

export function studioHistoryHint(checked: boolean, hasUser: boolean) {
  if (!checked) return "Checking your session…";
  return hasUser
    ? "Your video history is saved to your account. You can check it later on any device using this account."
    : "History belongs to this browser session. Return in the same browser, or sign in with Google to keep it with your account.";
}

export function studioJobDescription(job: StudioJob) {
  const { phase, label } = studioJobState(job);
  if (job.safety && phase === "failed") {
    // Do not render the provider's reason: it can contain private details or
    // untrusted text. Status determines the customer-facing explanation.
    const creditNote = job.creditState === "released"
      ? " Any reserved credits have been released."
      : job.creditState === "reserved"
        ? " Credit release is not yet confirmed in this task. Refresh history or contact support."
        : " No credits are consumed for a stopped safety check.";
    if (job.safety.status === "blocked")
      return "This prompt could not proceed under our usage policy. No video generation was started." + creditNote + " Read the content rules and edit your prompt, or contact support to appeal.";
    if (["expired", "error", "canceled"].includes(job.safety.status))
      return "The safety check " + (job.safety.status === "expired" ? "timed out" : job.safety.status === "canceled" ? "was canceled" : "could not be completed") + ". No video generation was started." + creditNote + " Please try again later with a new task.";
    return "This task failed. Check the credit status below before creating a new generation, or contact support with the task ID.";
  }
  switch (phase) {
    case "safety-check": return "Your prompt is being sent to Waffo Pancake for an automated text check. Video generation has not started. Keep this task; you do not need to submit it again.";
    case "safety-review": return "The automated text check is awaiting confirmation. It has a fixed time limit and may expire without an allowed result. Video generation has not started. This is not a queue for operator approval; keep the existing task.";
    case "input-review": return "This legacy task's prompt and any uploaded image are awaiting human review before generation can start.";
    case "output-review": return "This legacy task's generated video is awaiting human review before it can be delivered.";
    case "review": return "This legacy task is on hold for review. Check the credit status and contact support with the task ID if you need help. Recovery cannot approve content or restart generation.";
    case "submitting": return "Your request is being submitted. Keep this task open for updates; you do not need to submit it again.";
    case "generating": return "Your idea is with the model. This may take a few minutes.";
    case "unknown": return job.safety
      ? "We are confirming the generation outcome and technical delivery. This is not a content safety review or a confirmed failure. Recover this task or refresh history without starting another video; check the credit status below."
      : "The request may already be running. This is not a confirmed failure; any credit reservation remains pending. Recover this task to check it without starting another video.";
    case "failed": return label === "Legacy content review declined" || label === "Legacy content review expired"
      ? "This task did not pass content review. Check the credit status below and contact support to appeal."
      : "The provider could not finish this task. You can edit your prompt and create a new generation.";
    case "success": return job.resultUrl ? "Your video is ready. Open or download it from the results panel." : "The task completed. Refresh history to check video availability.";
  }
}

export function studioJobSafetyDisclosure(job: StudioJob) {
  if (!job.safety) return null;
  const images = job.safety.imageReview === "not_applicable"
    ? "Reference image: not applicable."
    : "Reference image: not reviewed under the MVP.";
  return `${images} Generated video: not reviewed under the MVP. Reference images and generated videos are neither individually human-reviewed nor automatically moderated in this MVP. A passed Waffo Pancake text check does not approve an image or video. Technical delivery verification is not a content safety check.`;
}

export type StudioHistoryState = "idle" | "loading" | "loaded" | "error";
export function studioHistoryView(checked: boolean, authenticated: boolean, state: StudioHistoryState, count: number) {
  if (count > 0) return "jobs";
  if (!checked || (authenticated && (state === "idle" || state === "loading"))) return "loading";
  if (state === "error") return "error";
  return "empty";
}

// Scope duplicate protection to exact inputs AND access mode in this tab.
// Retain an unacknowledged ID even if the user edits inputs and then returns,
// so a manual retry after a network error cannot create another paid task.
export class StudioRequests {
  private requests = new Map<string, string>();
  private key(payloadKey: string, billingMode: "preview" | "paid") {
    return JSON.stringify([payloadKey, billingMode]);
  }
  remember(payloadKey: string, billingMode: "preview" | "paid", requestId: string) {
    this.requests.set(this.key(payloadKey, billingMode), requestId);
  }
  id(payloadKey: string, billingMode: "preview" | "paid") {
    return this.requests.get(this.key(payloadKey, billingMode));
  }
  job(payloadKey: string, billingMode: "preview" | "paid", jobs: StudioJob[]) {
    const id = this.id(payloadKey, billingMode);
    return jobs.find((job) => job.id === id);
  }
}

export function focusStudioProgress(target: HTMLElement, reducedMotion: boolean) {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
}
