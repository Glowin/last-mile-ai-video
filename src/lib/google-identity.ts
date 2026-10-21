type GoogleIdentity = {
  initialize(config: {
    client_id: string;
    nonce: string;
    auto_select: boolean;
    callback: (response: { credential?: string }) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  disableAutoSelect(): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let loading: Promise<GoogleIdentity> | undefined;
export function loadGoogleIdentity() {
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error || !window.google?.accounts.id) {
        script.remove();
        reject(error ?? new Error("Google sign-in did not load."));
      } else resolve(window.google.accounts.id);
    };
    const timer = window.setTimeout(
      () =>
        finish(
          new Error(
            "Google sign-in timed out. Check your connection and retry.",
          ),
        ),
      15_000,
    );
    script.onload = () => finish();
    script.onerror = () =>
      finish(
        new Error(
          "Google sign-in could not load. Check your connection or content blocker.",
        ),
      );
    document.head.appendChild(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
