import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleSignInController } from "../src/lib/google-signin-controller";
import type { GoogleIdentity } from "../src/lib/google-identity";

const tick = () => new Promise<void>((done) => setImmediate(done));
function setup(options: { user?: boolean; dismissed?: boolean; expiresInMs?: number; authenticate?: () => Promise<unknown> } = {}) {
  let user = options.user ?? false, dismissed = options.dismissed ?? false;
  let callback!: (response: { credential?: string }) => void;
  const counts = { session: 0, challenge: 0, initialize: 0, prompt: 0, cancel: 0, render: 0, auth: 0 };
  let timer: (() => void) | undefined;
  let lastNonce = "", delay = 0;
  const google: GoogleIdentity = {
    initialize(config) { counts.initialize++; callback = config.callback; lastNonce = config.nonce; assert.equal(config.auto_select, false); },
    renderButton() { counts.render++; }, prompt() { counts.prompt++; },
    cancel() { counts.cancel++; }, disableAutoSelect() {},
  };
  const controller = new GoogleSignInController({
    session: async () => { counts.session++; return { user: user ? { id: "user" } : null }; },
    config: async () => ({ googleClientId: "test-client" }),
    challenge: async () => ({ nonce: `nonce-${++counts.challenge}`, expiresInMs: options.expiresInMs }),
    sdk: async () => google,
    authenticate: async () => { counts.auth++; await options.authenticate?.(); user = true; controller.identityChanged("sign-in"); },
    dismissed: () => dismissed,
    rememberDismissal: (value) => { dismissed = value; },
    schedule: (work, ms) => { delay = ms; timer = work; return 1 as unknown as ReturnType<typeof setTimeout>; },
    unschedule: () => { timer = undefined; },
  });
  const node = () => ({ replaceChildren() {} }) as unknown as HTMLElement;
  return { controller, counts, node, credential: () => callback({ credential: "test-credential" }),
    expire: () => { assert.ok(timer); timer(); }, setUser: (value: boolean) => { user = value; },
    get dismissed() { return dismissed; }, get nonce() { return lastNonce; }, get delay() { return delay; } };
}

test("multiple placements and repeated start share one nonce, initialization and automatic prompt", async () => {
  const h = setup();
  const remove = h.controller.button(h.node());
  h.controller.button(h.node());
  await Promise.all([h.controller.start(), h.controller.start(), h.controller.start()]);
  assert.equal(h.counts.session, 1);
  assert.equal(h.counts.challenge, 1);
  assert.equal(h.counts.initialize, 1);
  assert.equal(h.counts.prompt, 1);
  assert.equal(h.counts.render, 2);
  remove(); // route navigation unregisters a page's button
  h.controller.button(h.node());
  await h.controller.start();
  assert.equal(h.counts.challenge, 1);
  assert.equal(h.counts.prompt, 1);
  assert.equal(h.counts.render, 3);
});

test("signed-in sessions never load a challenge or prompt; returning visitors respect tab dismissal", async () => {
  const signedIn = setup({ user: true });
  await signedIn.controller.start();
  assert.equal(signedIn.controller.state.phase, "signed-in");
  assert.equal(signedIn.counts.challenge, 0);
  assert.equal(signedIn.counts.prompt, 0);
  const closed = setup({ dismissed: true });
  await closed.controller.start();
  assert.equal(closed.controller.state.visible, false);
  assert.equal(closed.counts.prompt, 0);
});

test("closing preserves inline buttons and nonce expiry; retry refreshes nonce without another automatic prompt", async () => {
  const h = setup();
  h.controller.button(h.node());
  await h.controller.start();
  const renders = h.counts.render;
  h.controller.close();
  assert.equal(h.controller.state.visible, false);
  assert.equal(h.controller.state.phase, "ready");
  assert.equal(h.dismissed, true);
  assert.equal(h.counts.render, renders);
  h.expire();
  assert.equal(h.controller.state.phase, "error");
  h.credential(); // credential from the expired SDK callback must be ignored
  await tick();
  assert.equal(h.counts.auth, 0);
  h.controller.open();
  await tick();
  assert.equal(h.controller.state.phase, "ready");
  assert.equal(h.nonce, "nonce-2");
  assert.equal(h.counts.prompt, 1);
});

test("successful same-tab broadcast cannot invalidate its own callback; duplicate credentials submit once", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((done) => { release = done; });
  const h = setup({ authenticate: () => waiting });
  await h.controller.start();
  h.credential(); h.credential();
  assert.equal(h.controller.state.phase, "pending");
  assert.equal(h.counts.auth, 1);
  release();
  await tick();
  assert.equal(h.controller.state.phase, "signed-in");
  assert.equal(h.controller.state.visible, false);
  assert.equal(h.counts.challenge, 1);
  assert.equal(h.counts.session, 1, "self-broadcast does not restart initialization");
});

test("logout cancels a pending sign-in and suppresses subsequent automatic prompt", async () => {
  let release!: () => void;
  const h = setup({ authenticate: () => new Promise<void>((done) => { release = done; }) });
  await h.controller.start();
  h.credential();
  h.setUser(false);
  await h.controller.identityChanged("sign-out");
  assert.equal(h.controller.state.visible, false);
  assert.equal(h.counts.prompt, 1);
  // Simulate a delayed old callback: its epoch may no longer change local UI.
  // Production api identity guards reject a cookie mutation across logout.
  release();
  await tick();
  assert.equal(h.counts.prompt, 1);
  assert.equal(h.dismissed, true);
});

test("SDK failure stops until manual retry; session-ended does not loop session reads", async () => {
  let calls = 0;
  const controller = new GoogleSignInController({
    session: async () => ({ user: null }), config: async () => ({ googleClientId: "test" }),
    challenge: async () => { throw new Error("must not request a nonce"); },
    authenticate: async () => {}, sdk: async () => { calls++; throw new Error("SDK blocked"); },
    dismissed: () => false, rememberDismissal() {}, schedule: setTimeout, unschedule: clearTimeout,
  });
  await controller.start();
  await controller.start();
  assert.equal(calls, 1);
  assert.equal(controller.state.message, "SDK blocked");
  controller.retry();
  await tick();
  assert.equal(calls, 2);
  controller.sessionEnded();
  await tick();
  assert.equal(calls, 2);
  assert.equal(controller.state.visible, false);
});

test("reused nonce expires using remaining server lifetime; nearly expired nonce never initializes GIS", async () => {
  const reused = setup({ expiresInMs: 45_000 });
  await reused.controller.start();
  assert.equal(reused.delay, 40_000);
  reused.expire();
  assert.equal(reused.controller.state.phase, "error");
  const fresh = setup({ expiresInMs: 600_000 });
  await fresh.controller.start();
  assert.equal(fresh.delay, 540_000);
  const expiring = setup({ expiresInMs: 5_000 });
  await expiring.controller.start();
  assert.equal(expiring.controller.state.phase, "error");
  assert.match(expiring.controller.state.message, /Wait a few seconds/);
  assert.equal(expiring.counts.initialize, 0);
  assert.equal(expiring.counts.prompt, 0);
  await tick();
  assert.equal(expiring.counts.challenge, 1, "no automatic retry loop");
});
