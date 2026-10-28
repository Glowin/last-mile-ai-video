import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleSignInController, type SignInState } from "../src/lib/google-signin-controller";
import type { GoogleIdentity } from "../src/lib/google-identity";

const tick = () => new Promise<void>((done) => setImmediate(done));
function setup(options: {
  user?: boolean; dismissed?: boolean; expiresInMs?: number;
  authenticate?: (credential: string) => Promise<unknown>;
  config?: () => Promise<{ googleClientId?: string }>;
  sdk?: (google: GoogleIdentity) => Promise<GoogleIdentity>;
} = {}) {
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
    config: options.config ?? (async () => ({ googleClientId: "test-client" })),
    challenge: async () => ({ nonce: `nonce-${++counts.challenge}`, expiresInMs: options.expiresInMs }),
    sdk: async () => options.sdk ? options.sdk(google) : google,
    authenticate: async (credential) => { counts.auth++; await options.authenticate?.(credential); user = true; controller.identityChanged("sign-in"); },
    dismissed: () => dismissed,
    rememberDismissal: (value) => { dismissed = value; },
    schedule: (work, ms) => { delay = ms; timer = work; return 1 as unknown as ReturnType<typeof setTimeout>; },
    unschedule: () => { timer = undefined; },
  });
  const states: SignInState[] = [controller.snapshot()];
  controller.subscribe(() => { states.push(controller.snapshot()); });
  const node = () => ({ replaceChildren() {} }) as unknown as HTMLElement;
  return { controller, counts, node, states, credential: () => callback({ credential: "test-credential" }),
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
  assert.deepEqual([...new Set(h.states.map((state) => state.phase))], ["checking", "loading", "ready"]);
  assert.ok(h.states.every((state) => !state.visible), "automatic lifecycle never shows our overlay");
  h.expire();
  assert.equal(h.controller.state.phase, "error");
  assert.equal(h.controller.state.visible, false);
  h.controller.retry();
  await tick();
  assert.equal(h.controller.state.phase, "ready");
  assert.ok(h.states.every((state) => !state.visible));
  assert.equal(h.counts.prompt, 1);
});

test("signed-in sessions never load a challenge or prompt; returning visitors respect tab dismissal", async () => {
  const signedIn = setup({ user: true });
  await signedIn.controller.start();
  assert.equal(signedIn.controller.state.phase, "signed-in");
  assert.equal(signedIn.counts.challenge, 0);
  assert.equal(signedIn.counts.prompt, 0);
  signedIn.controller.open();
  assert.equal(signedIn.controller.state.visible, false);
  assert.ok(signedIn.states.every((state) => !state.visible));
  const closed = setup({ dismissed: true });
  await closed.controller.start();
  assert.equal(closed.controller.state.visible, false);
  assert.equal(closed.counts.prompt, 0);
});

test("closing preserves inline buttons and nonce expiry; retry refreshes nonce without another automatic prompt", async () => {
  const h = setup();
  h.controller.button(h.node());
  await h.controller.start();
  h.controller.open();
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
  assert.equal(h.controller.state.visible, true);
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
  h.controller.open();
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
  assert.equal(controller.state.visible, false);
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
  assert.equal(expiring.controller.state.visible, false);
  await tick();
  assert.equal(expiring.counts.challenge, 1, "no automatic retry loop");
});


test("manual open cancels native UI before showing the overlay and retains inline buttons, nonce and expiry", async () => {
  const h = setup();
  let clears = 0;
  const node = { replaceChildren() { clears++; } } as unknown as HTMLElement;
  h.controller.button(node);
  await h.controller.start();
  const before = { ...h.counts }, previousClears = clears, nonce = h.nonce;
  h.controller.subscribe(() => {
    if (h.controller.state.visible) assert.ok(h.counts.cancel > before.cancel);
  });
  h.controller.open();
  assert.equal(h.controller.state.visible, true);
  assert.equal(h.controller.state.phase, "ready");
  assert.equal(h.counts.cancel, before.cancel + 1);
  assert.equal(h.counts.challenge, before.challenge);
  assert.equal(h.counts.initialize, before.initialize);
  assert.equal(h.counts.render, before.render);
  assert.equal(clears, previousClears);
  assert.equal(h.nonce, nonce);
  h.controller.close();
  assert.equal(clears, previousClears);
  assert.equal(h.controller.state.visible, false);
  h.expire();
  assert.equal(h.controller.state.phase, "error");
  assert.equal(h.controller.state.visible, false);
});

for (const when of ["before-start", "sdk-loading"] as const) {
  for (const close of [false, true]) {
    test(`manual open suppresses later native prompt (${when}, close: ${close})`, async () => {
      let release!: () => void;
      const waiting = new Promise<void>((done) => { release = done; });
      const h = setup({ sdk: async (google) => { await waiting; return google; } });
      if (when === "before-start") h.controller.open();
      const starting = h.controller.start();
      await tick();
      assert.equal(h.controller.state.phase, "loading");
      if (when === "sdk-loading") h.controller.open();
      assert.equal(h.controller.state.visible, true);
      if (close) h.controller.close();
      release();
      await starting;
      assert.equal(h.controller.state.phase, "ready");
      assert.equal(h.controller.state.visible, !close);
      assert.equal(h.counts.prompt, 0);
      h.controller.retry();
      await tick();
      assert.equal(h.controller.state.visible, !close);
      assert.equal(h.counts.prompt, 0);
    });
  }
}

test("SDK errors stay hidden automatically; manual open and retry retain intent through failure and recovery", async () => {
  let calls = 0;
  const h = setup({ sdk: async (google) => {
    if (++calls <= 2) throw new Error("SDK blocked");
    return google;
  } });
  await h.controller.start();
  assert.equal(h.controller.state.phase, "error");
  assert.ok(h.states.every((state) => !state.visible));
  const manualStates = h.states.length;
  h.controller.open();
  await tick();
  assert.equal(calls, 2);
  assert.equal(h.controller.state.phase, "error");
  assert.equal(h.controller.state.visible, true);
  h.controller.retry();
  await tick();
  assert.equal(h.controller.state.phase, "ready");
  assert.ok(h.states.slice(manualStates).every((state) => state.visible));
  assert.equal(h.counts.prompt, 0);
  h.expire();
  assert.equal(h.controller.state.visible, true);
  h.controller.retry();
  await tick();
  assert.equal(h.controller.state.phase, "ready");
  assert.equal(h.controller.state.visible, true);
  assert.equal(h.counts.challenge, 2);
  assert.equal(h.counts.prompt, 0);
});

test("disabled configuration never shows an automatic overlay and manual open can recover", async () => {
  let configured = false;
  const h = setup({ config: async () => configured ? { googleClientId: "test" } : {} });
  await h.controller.start();
  assert.equal(h.controller.state.phase, "disabled");
  assert.ok(h.states.every((state) => !state.visible));
  assert.equal(h.counts.prompt, 0);
  h.controller.open();
  await tick();
  assert.equal(h.controller.state.phase, "disabled");
  assert.equal(h.controller.state.visible, true);
  configured = true;
  h.controller.retry();
  await tick();
  assert.equal(h.controller.state.phase, "ready");
  assert.equal(h.controller.state.visible, true);
  assert.equal(h.counts.prompt, 0);
});

for (const end of ["sign-out", "external", "session-ended", "stop"] as const) {
  test(`${end} clears manual intent before subsequent preparation`, async () => {
    const h = setup();
    await h.controller.start();
    h.controller.open();
    assert.equal(h.controller.state.visible, true);
    const endedStates = h.states.length;
    if (end === "stop") {
      h.controller.stop();
      await h.controller.start();
    } else if (end === "session-ended") {
      h.controller.sessionEnded();
      h.controller.retry();
      await tick();
    } else {
      await h.controller.identityChanged(end);
    }
    assert.equal(h.controller.state.phase, "ready");
    assert.ok(h.states.slice(endedStates).every((state) => !state.visible));
    assert.equal(h.counts.prompt, 1);
  });
}

test("identity sign-in hides an open overlay throughout session recheck", async () => {
  const h = setup();
  await h.controller.start();
  h.controller.open();
  h.setUser(true);
  const changedStates = h.states.length;
  await h.controller.identityChanged("sign-in");
  assert.equal(h.controller.state.phase, "signed-in");
  h.controller.open();
  assert.ok(h.states.slice(changedStates).every((state) => !state.visible));
});

test("manual credential completion hides the overlay and clears intent for subsequent retry", async () => {
  const h = setup();
  await h.controller.start();
  h.controller.open();
  h.credential();
  await tick();
  assert.equal(h.controller.state.phase, "signed-in");
  assert.equal(h.controller.state.visible, false);
  const signedInStates = h.states.length;
  h.controller.retry();
  await tick();
  assert.ok(h.states.slice(signedInStates).every((state) => !state.visible));
  assert.equal(h.counts.auth, 1);
});
