import { test } from "node:test";
import assert from "node:assert/strict";
import { collectCheckoutAnalytics, revokeBrowserAnalytics } from "../src/lib/analytics-consent";

test("checkout consent follows this browser, including delayed callbacks and withdrawal failure", async (t) => {
  const descriptors = new Map(["window", "localStorage", "navigator", "fetch"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let consent = "granted";
  const calls: string[] = [];
  const w = { __krAnalyticsReady: true, __krAnalyticsMeasurementId: "G-TEST",
    gtag: (...args: unknown[]) => (args[3] as (v: unknown) => void)(args[2] === "client_id" ? "111.222" : 1793188800) };
  let transport = async (_url: unknown, init?: RequestInit) => {
    calls.push(init!.method!); return Response.json({ ok: true });
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: w });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => consent } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (u: unknown, i?: RequestInit) => transport(u, i) });
  try {
    await t.test("consented checkout includes both actual GA IDs", async () => {
      assert.deepEqual(await collectCheckoutAnalytics(), { clientId: "111.222", sessionId: "1793188800" });
      assert.deepEqual(calls, ["POST"]);
    });
    await t.test("denied browser cannot use an account's earlier consent", async () => {
      consent = "denied"; calls.length = 0;
      assert.equal(await collectCheckoutAnalytics(), undefined);
      assert.deepEqual(calls, []);
    });
    await t.test("late gtag callbacks cannot restore withdrawn consent", async () => {
      consent = "granted";
      const callbacks: (() => void)[] = [];
      w.gtag = (...args) => { callbacks.push(() => (args[3] as (v: unknown) => void)(args[2] === "client_id" ? "111.222" : 1793188800)); };
      const capture = collectCheckoutAnalytics();
      consent = "denied";
      callbacks.forEach(f => f());
      assert.equal(await capture, undefined);
      assert.deepEqual(calls, []);
    });
    await t.test("withdrawal waits for acknowledgment and exposes failure for retry", async () => {
      let respond!: (response: Response) => void;
      transport = async () => new Promise<Response>(resolve => { respond = resolve; });
      let done = false;
      const revoke = revokeBrowserAnalytics().then(() => { done = true; });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(done, false);
      respond(Response.json({ ok: true }));
      await revoke;
      transport = async () => Response.json({ error: "unavailable" }, { status: 503 });
      await assert.rejects(revokeBrowserAnalytics(), /could not be saved/);
      transport = async () => Response.json({ ok: true });
      await revokeBrowserAnalytics();
    });
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
