let refreshFlight: Promise<void> | undefined;
export const SESSION_ENDED = "kakareel:session-ended";
const send = (path: string, options: RequestInit) =>
  fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
async function refreshSession() {
  if (!refreshFlight) {
    const work = async () => {
      // Another tab may have rotated while we waited for the browser-wide lock.
      const current = await send("/session", {});
      if (current.ok) return;
      if (current.status !== 401)
        throw new Error("Session service is unavailable. Please try again.");
      const response = await send("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        if (response.status === 401)
          window.dispatchEvent(new Event(SESSION_ENDED));
        throw new Error(
          "Your session could not be refreshed. Please sign in again.",
        );
      }
    };
    refreshFlight = (
      navigator.locks
        ? navigator.locks.request("kakareel-session", work)
        : work()
    ).finally(() => {
      refreshFlight = undefined;
    });
  }
  return refreshFlight;
}
export async function api(path: string, options: RequestInit = {}) {
  let r = await send(path, options);
  let data = await r.json();
  if (r.status === 401 && data.code === "SESSION_EXPIRED") {
    await refreshSession();
    r = await send(path, options);
    data = await r.json();
  }
  if (!r.ok) throw new Error(data.error ?? "Request failed. Please try again.");
  return data;
}
