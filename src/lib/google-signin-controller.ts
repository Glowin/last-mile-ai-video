import type { GoogleIdentity } from "./google-identity";

export type SignInState = {
  phase: "checking" | "loading" | "ready" | "pending" | "signed-in" | "disabled" | "error";
  visible: boolean;
  message: string;
};
type Dependencies = {
  session: () => Promise<{ user?: { id: string } | null }>;
  config: () => Promise<{ googleClientId?: string }>;
  challenge: () => Promise<{ nonce: string; expiresInMs?: number }>;
  authenticate: (credential: string) => Promise<unknown>;
  sdk: () => Promise<GoogleIdentity>;
  dismissed: () => boolean;
  rememberDismissal: (dismissed: boolean) => void;
  schedule: (work: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule: (timer: ReturnType<typeof setTimeout>) => void;
};

// One instance belongs to RootLayout, not to a route or button. SDK callbacks
// and challenge cookies remain owned here when page components mount/unmount.
export class GoogleSignInController {
  state: SignInState = { phase: "checking", visible: false, message: "" };
  private listeners = new Set<() => void>();
  private buttons = new Set<HTMLElement>();
  private google?: GoogleIdentity;
  private flight?: Promise<void>;
  private epoch = 0;
  private started = false;
  private prompted = false;
  private closed = false;
  private manualOpen = false;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private deps: Dependencies) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.state;
  private update(next: Partial<SignInState>) {
    this.state = { ...this.state, ...next };
    if (this.state.phase !== "ready") this.buttons.forEach((node) => node.replaceChildren());
    this.listeners.forEach((listener) => listener());
  }
  private cancel() {
    if (this.expiry) this.deps.unschedule(this.expiry);
    this.expiry = undefined;
    this.cancelPrompt();
  }
  private cancelPrompt() {
    try { this.google?.cancel(); } catch { /* UI cancellation must not affect auth. */ }
  }
  start() {
    if (this.started) return this.flight ?? Promise.resolve();
    this.started = true;
    this.closed = this.deps.dismissed();
    return this.prepare();
  }
  stop() {
    ++this.epoch;
    this.started = false;
    this.manualOpen = false;
    this.cancel();
    this.update({ phase: "checking", visible: false });
  }
  private prepare() {
    const epoch = ++this.epoch;
    this.cancel();
    this.update({ phase: "checking", visible: this.manualOpen, message: "" });
    // Serialize attempts, including abandoned challenge requests: an older
    // response must never overwrite a newer challenge cookie.
    const previous = this.flight;
    this.flight = (previous ?? Promise.resolve()).then(async () => {
      if (epoch !== this.epoch) return;
      const session = await this.deps.session();
      if (epoch !== this.epoch) return;
      if (session.user) {
        this.manualOpen = false;
        this.update({ phase: "signed-in", visible: false });
        return;
      }
      this.update({ phase: "loading", visible: this.manualOpen });
      const { googleClientId } = await this.deps.config();
      if (epoch !== this.epoch) return;
      if (!googleClientId) { this.update({ phase: "disabled" }); return; }
      this.google = await this.deps.sdk();
      if (epoch !== this.epoch) return;
      const { nonce, expiresInMs } = await this.deps.challenge();
      if (epoch !== this.epoch) return;
      const expiresAfter = expiresInMs === undefined ? 9 * 60_000
        : Math.max(0, Math.min(9 * 60_000, expiresInMs - 5_000));
      if (!Number.isFinite(expiresAfter) || expiresAfter <= 0)
        throw new Error("Google sign-in is about to expire. Wait a few seconds, then retry.");
      const google = this.google;
      google.initialize({ client_id: googleClientId, nonce, auto_select: false,
        callback: ({ credential }) => {
          if (this.state.phase === "ready") void this.complete(epoch, credential);
        },
      });
      this.update({ phase: "ready" });
      this.buttons.forEach((node) => this.render(node));
      this.expiry = this.deps.schedule(() => {
        if (epoch !== this.epoch || this.state.phase !== "ready") return;
        ++this.epoch;
        this.cancel();
        this.update({ phase: "error", message: "Sign-in expired. Retry to get a fresh Google sign-in button." });
      }, expiresAfter);
      if (!this.prompted && !this.closed && !this.manualOpen) {
        this.prompted = true;
        // Browsers may suppress One Tap. The official button always remains.
        // No display-moment callbacks or timers are used to guess FedCM UI.
        try { google.prompt(); } catch { /* Keep the official button available. */ }
      }
    }).catch((error: unknown) => {
      if (epoch === this.epoch) this.update({ phase: "error", visible: this.manualOpen, message: error instanceof Error ? error.message : "Google sign-in is unavailable. Please retry." });
    });
    return this.flight;
  }
  private async complete(epoch: number, credential?: string) {
    if (epoch !== this.epoch || this.state.phase !== "ready") return;
    this.cancel();
    this.update({ phase: "pending" });
    try {
      if (!credential) throw new Error("Google did not return a credential. Please retry.");
      await this.deps.authenticate(credential);
      if (epoch !== this.epoch) return;
      this.manualOpen = false;
      this.update({ phase: "signed-in", visible: false });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.update({ phase: "error", visible: true, message: error instanceof Error ? error.message : "Sign-in failed. Please retry." });
    }
  }
  identityChanged(reason: "sign-in" | "sign-out" | "external") {
    // api() broadcasts before its promise resolves. Do not invalidate our own
    // successful credential callback; page subscribers still refresh normally.
    if (reason === "sign-in" && this.state.phase === "pending") return;
    this.prompted = true;
    this.manualOpen = false;
    if (reason !== "sign-in") {
      this.closed = true;
      this.deps.rememberDismissal(true);
      try { this.google?.disableAutoSelect(); } catch { /* Best effort. */ }
    }
    return this.prepare();
  }
  close = () => {
    this.manualOpen = false;
    this.closed = true;
    this.deps.rememberDismissal(true);
    this.cancelPrompt(); // Keep inline buttons and nonce expiry usable.
    this.update({ visible: false });
  };
  sessionEnded() {
    ++this.epoch;
    this.manualOpen = false;
    this.prompted = true;
    this.closed = true;
    this.deps.rememberDismissal(true);
    this.cancel();
    this.update({ phase: "error", visible: false, message: "Your session has ended. Retry to sign in again." });
  }

  open = () => {
    if (this.state.phase === "signed-in") return;
    this.manualOpen = true;
    // Consume the automatic attempt even while the SDK is still loading.
    this.prompted = true;
    this.closed = false;
    this.deps.rememberDismissal(false);
    this.cancelPrompt(); // Cancel native UI before showing ours; retain nonce expiry.
    this.update({ visible: true });
    if (["error", "disabled"].includes(this.state.phase)) void this.prepare();
  };
  retry = () => {
    if (["checking", "loading", "pending"].includes(this.state.phase)) return;
    void this.prepare();
  };
  private render(node: HTMLElement) {
    node.replaceChildren();
    this.google?.renderButton(node, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 260 });
  }
  button = (node: HTMLElement) => {
    this.buttons.add(node);
    if (this.state.phase === "ready") this.render(node);
    return () => { this.buttons.delete(node); node.replaceChildren(); };
  };
}
