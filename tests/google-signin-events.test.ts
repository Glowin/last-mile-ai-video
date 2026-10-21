import { test } from "node:test";
import assert from "node:assert/strict";
import { api, IDENTITY_CHANGED_EVENT, type IdentityChangedEvent } from "../src/lib/api";

test("successful Google sign-in broadcasts once before resolving, with the updated identity marker", async () => {
  const originalFetch = global.fetch;
  const names = ["window", "localStorage"] as const;
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const events = new EventTarget(), values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  let notifications = 0, resolved = false;
  events.addEventListener(IDENTITY_CHANGED_EVENT, (event) => {
    notifications++;
    assert.equal((event as IdentityChangedEvent).reason, "sign-in");
    assert.ok(values.get("kr_identity_changed"));
    assert.equal(resolved, false);
  });
  try {
    global.fetch = async () => Response.json({ ok: true });
    await api("/auth/google", { method: "POST" });
    resolved = true;
    assert.equal(notifications, 1);
    global.fetch = async () => Response.json({ error: "Invalid credential" }, { status: 401 });
    await assert.rejects(api("/auth/google", { method: "POST" }), /Invalid credential/);
    assert.equal(notifications, 1, "failed sign-in cannot broadcast an identity change");
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

for (const webLocks of [true, false]) {
  test(`nonce challenge cookie writes are serialized without identity broadcasts (Web Locks: ${webLocks})`, async () => {
    const originalFetch = global.fetch;
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const lockDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    const events = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    let notifications = 0, calls = 0, locks = 0;
    events.addEventListener(IDENTITY_CHANGED_EVENT, () => notifications++);
    let queue = Promise.resolve<unknown>(undefined);
    Object.defineProperty(navigator, "locks", { configurable: true, value: webLocks ? {
      request: (name: string, work: () => Promise<unknown>) => {
        assert.equal(name, "kakareel-session");
        locks++;
        const next = queue.then(work);
        queue = next.catch(() => {});
        return next;
      },
    } : undefined });
    let release!: () => void, reached!: () => void;
    const waiting = new Promise<void>((done) => { release = done; });
    const started = new Promise<void>((done) => { reached = done; });
    global.fetch = async (url) => {
      assert.equal(url, "/api/auth/challenge");
      calls++;
      if (calls === 1) { reached(); await waiting; }
      return Response.json({ nonce: "shared-nonce" });
    };
    try {
      const first = api("/auth/challenge", { method: "POST" });
      await started;
      const second = api("/auth/challenge", { method: "POST" });
      await new Promise<void>((done) => setImmediate(done));
      assert.equal(calls, 1, "the second challenge cannot overwrite the first response in flight");
      release();
      await Promise.all([first, second]);
      assert.equal(calls, 2);
      assert.equal(locks, webLocks ? 2 : 0);
      assert.equal(notifications, 0);
    } finally {
      release();
      global.fetch = originalFetch;
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (lockDescriptor) Object.defineProperty(navigator, "locks", lockDescriptor);
      else Reflect.deleteProperty(navigator, "locks");
    }
  });
}
