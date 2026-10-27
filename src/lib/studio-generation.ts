import type { PublicJob } from "./models";

export type StudioJob = PublicJob & {
  billingMode?: "preview" | "paid";
  credits?: number;
  creditState?: "none" | "reserved" | "consumed" | "released";
  reviewRequired?: boolean;
  moderation?: { phase: "input" | "output"; state: "pending" | "approved" | "rejected" | "expired"; version: number }[];
};

export function studioJobState(job: StudioJob) {
  // Only the latest decision for each phase describes the current review.
  const reviews = (["input", "output"] as const).flatMap((phase) => {
    const latest = job.moderation?.filter((r) => r.phase === phase)
      .sort((a, b) => b.version - a.version)[0];
    return latest ? [latest] : [];
  });
  const declined = reviews.find((r) => r.state === "rejected" || r.state === "expired");
  if (declined) return { phase: "failed", label: declined.state === "rejected" ? "Content review declined" : "Content review expired", active: false, unresolved: false } as const;
  const pending = reviews.find((r) => r.state === "pending");
  if (pending) return { phase: `${pending.phase}-review`, label: pending.phase === "input" ? "Awaiting input review" : "Awaiting output review", active: false, unresolved: true } as const;
  if (job.reviewRequired) return { phase: "review", label: "On hold for review", active: false, unresolved: true } as const;
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
  switch (phase) {
    case "input-review": return "Your prompt and any uploaded image are awaiting review before generation can start.";
    case "output-review": return "The generated video is awaiting review before it can be delivered.";
    case "review": return "This task is on hold for review. Check the credit status and contact support with the task ID if you need help. Recovery cannot approve content or restart generation.";
    case "submitting": return "Your request is being submitted. Keep this task open for updates; you do not need to submit it again.";
    case "generating": return "Your idea is with the model. This may take a few minutes.";
    case "unknown": return "The request may already be running. This is not a confirmed failure; any credit reservation remains pending. Recover this task to check it without starting another video.";
    case "failed": return label === "Content review declined" || label === "Content review expired"
      ? "This task did not pass content review. Check the credit status below and contact support to appeal."
      : "The provider could not finish this task. You can edit your prompt and create a new generation.";
    case "success": return job.resultUrl ? "Your video is ready. Open or download it from the results panel." : "The task completed. Refresh history to check video availability.";
  }
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
