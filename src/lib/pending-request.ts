// Keep unacknowledged requests across logout/reload, scoped to their owner.
// A guest claim moves the same request ID; retrying must never spend twice.
const key = (owner: string) => `kr_pending:${owner}`;
export class DamagedPendingRequest extends Error {
  constructor(readonly owner: string, readonly saved: string) {
    super("Saved request data is damaged. Check My videos for an existing task before resetting it; a new submission could be charged again.");
  }
}
function readPending(owner: string, saved: string) {
  try {
    const value = JSON.parse(saved);
    if (typeof value?.digest !== "string" || typeof value?.requestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)) throw new Error();
    return value as { digest: string; requestId: string };
  } catch {
    throw new DamagedPendingRequest(owner, saved);
  }
}
// Only an explicit user acknowledgement may discard damaged state, and never
// discard a replacement record another tab wrote while the user was reviewing.
export function resetDamagedPendingRequest(error: DamagedPendingRequest) {
  if (localStorage.getItem(key(error.owner)) === error.saved)
    localStorage.removeItem(key(error.owner));
}
export function pendingRequestId(owner: string, digest: string): string {
  const saved = localStorage.getItem(key(owner));
  const pending = saved ? readPending(owner, saved) : null;
  if (pending?.digest === digest && typeof pending.requestId === "string")
    return pending.requestId;
  const requestId = crypto.randomUUID();
  localStorage.setItem(key(owner), JSON.stringify({ digest, requestId }));
  return requestId;
}
export function clearPendingRequest(owner: string, requestId: string) {
  const saved = localStorage.getItem(key(owner));
  if (saved && readPending(owner, saved).requestId === requestId)
    localStorage.removeItem(key(owner));
}
export function adoptPendingRequest(guest: string, user: string) {
  const saved = localStorage.getItem(key(guest));
  if (saved) {
    localStorage.setItem(key(user), saved);
    localStorage.removeItem(key(guest));
  }
}
export function adoptLegacyPendingRequest(owner: string) {
  const saved = localStorage.getItem("lm_pending");
  if (saved) {
    if (!localStorage.getItem(key(owner))) localStorage.setItem(key(owner), saved);
    localStorage.removeItem("lm_pending");
  }
}
