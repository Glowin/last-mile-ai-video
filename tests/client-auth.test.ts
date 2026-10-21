import { test } from "node:test";
import assert from "node:assert/strict";
import { api, SESSION_ENDED } from "../src/lib/api";
import { pendingRequestId, clearPendingRequest, DamagedPendingRequest, resetDamagedPendingRequest } from "../src/lib/pending-request";

test("client refresh deduplicates requests and retries the exact mutation once", async () => {
  const original = global.fetch;
  let valid = false,
    refreshes = 0;
  const bodies: (BodyInit | null | undefined)[] = [];
  global.fetch = async (url, options) => {
    assert.equal(options?.credentials, "same-origin");
    if (url === "/api/auth/refresh") {
      refreshes++;
      valid = true;
      return Response.json({ ok: true });
    }
    if (url === "/api/jobs") bodies.push(options?.body);
    return valid
      ? Response.json({ ok: true, authenticated: true })
      : Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    const body = JSON.stringify({ requestId: "same-id-across-retry" });
    await Promise.all([
      api("/jobs", { method: "POST", body }),
      api("/session"),
      api("/jobs"),
    ]);
    assert.equal(refreshes, 1);
    assert.deepEqual(bodies.filter(Boolean), [body, body]);
  } finally {
    global.fetch = original;
  }
});

test("failed refresh clears client identity; an invalid Google credential never triggers refresh", async () => {
  const original = global.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const windowTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowTarget,
  });
  let ended = 0,
    refreshes = 0;
  windowTarget.addEventListener(SESSION_ENDED, () => ended++);
  global.fetch = async (url) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      return Response.json({ error: "Session ended" }, { status: 401 });
    }
    if (url === "/api/auth/google")
      return Response.json({ error: "Invalid credential" }, { status: 401 });
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    await assert.rejects(api("/jobs"), /sign in again/);
    assert.equal(ended, 1);
    assert.equal(refreshes, 1);
    await assert.rejects(
      api("/auth/google", { method: "POST" }),
      /Invalid credential/,
    );
    assert.equal(refreshes, 1);
  } finally {
    global.fetch = original;
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

function browserState() {
  const names = ["window", "localStorage"] as const;
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const events = new EventTarget();
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } });
  return { events, items, restore() {
    names.forEach((name, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, name, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  } };
}

test("an expired paid mutation cannot retry under a different account", async () => {
  const original = global.fetch;
  const browser = browserState();
  browser.items.set("kr_identity_changed", "account-a");
  let jobCalls = 0;
  global.fetch = async (url) => {
    if (url === "/api/jobs") {
      jobCalls++;
      return jobCalls === 1
        ? Response.json({ code: "SESSION_EXPIRED" }, { status: 401 })
        : Response.json({ job: { owner: "account-b" } });
    }
    assert.equal(url, "/api/session");
    // Another tab completed sign-in while this request was waiting for refresh.
    browser.items.set("kr_identity_changed", "account-b");
    return Response.json({ authenticated: true, user: { id: "account-b" } });
  };
  try {
    await assert.rejects(api("/jobs", { method: "POST", body: "original-paid-request" }), /account changed/i);
    assert.equal(jobCalls, 1, "never submit the paid request with the replacement identity");
  } finally {
    global.fetch = original;
    browser.restore();
  }
});

test("logout in another tab during refresh ends the local session without retry", async () => {
  const original = global.fetch;
  const browser = browserState();
  let ended = 0, jobCalls = 0;
  browser.events.addEventListener(SESSION_ENDED, () => ended++);
  global.fetch = async (url) => {
    if (url === "/api/session") return Response.json({ authenticated: false, user: null });
    jobCalls++;
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    await assert.rejects(api("/jobs"), /sign in again/i);
    assert.equal(ended, 1);
    assert.equal(jobCalls, 1);
  } finally {
    global.fetch = original;
    browser.restore();
  }
});

test("late history responses from a previous identity are rejected", async () => {
  const original = global.fetch;
  const browser = browserState();
  global.fetch = async () => {
    browser.items.set("kr_identity_changed", "replacement-account");
    return Response.json({ jobs: [{ prompt: "Previous account private history" }] });
  };
  try {
    await assert.rejects(api("/jobs"), /account changed/i);
  } finally {
    global.fetch = original;
    browser.restore();
  }
});


test("logout waits for an in-flight refresh before changing cookies", async () => {
  const original = global.fetch;
  const browser = browserState();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  let queue = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_name: string, work: () => Promise<unknown>) => {
      const next = queue.then(work);
      queue = next.catch(() => {});
      return next;
    },
  } });
  let release!: () => void, reached!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const order: string[] = [];
  let valid = false;
  global.fetch = async (url, init) => {
    if (url === "/api/auth/refresh") {
      order.push("refresh-start");
      reached();
      await waiting;
      valid = true;
      order.push("refresh-end");
      return Response.json({ ok: true });
    }
    if (url === "/api/session" && init?.method === "DELETE") {
      order.push("logout");
      valid = false;
      return Response.json({ ok: true });
    }
    return valid
      ? Response.json({ authenticated: true, jobs: [] })
      : Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    const pending = api("/jobs").catch((error: Error) => error);
    await started;
    const logout = api("/session", { method: "DELETE" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["refresh-start"]);
    release();
    await logout;
    await pending;
    assert.deepEqual(order, ["refresh-start", "refresh-end", "logout"]);
    assert.equal(valid, false);
  } finally {
    release();
    global.fetch = original;
    browser.restore();
    if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
    else Reflect.deleteProperty(navigator, "locks");
  }
});


test("Google guest adoption retains the unacknowledged paid request ID and isolates other accounts", async () => {
  const original = global.fetch;
  const browser = browserState();
  const digest = "same-video-input";
  try {
    const guestRequest = pendingRequestId("guest-a", digest);
    global.fetch = async () => Response.json({ ok: true, claimedGuestId: "guest-a", userId: "account-a" });
    await api("/auth/google", { method: "POST", body: "test-credential" });
    assert.equal(pendingRequestId("account-a", digest), guestRequest);
    assert.notEqual(pendingRequestId("account-b", digest), guestRequest);
    // Signing out does not discard an unacknowledged request in account A.
    global.fetch = async () => Response.json({ ok: true });
    await api("/session", { method: "DELETE" });
    assert.equal(pendingRequestId("account-a", digest), guestRequest);
    const newer = pendingRequestId("account-a", "new-input");
    clearPendingRequest("account-a", guestRequest);
    assert.equal(pendingRequestId("account-a", "new-input"), newer, "a late response cannot delete another tab's pending request");
    clearPendingRequest("account-a", newer);
    assert.notEqual(pendingRequestId("account-a", "new-input"), newer);
  } finally {
    global.fetch = original;
    browser.restore();
  }
});

test("legacy unacknowledged guest request survives the first Google sign-in", async () => {
  const original = global.fetch;
  const browser = browserState();
  browser.items.set("lm_pending", JSON.stringify({ digest: "legacy", requestId: "11111111-1111-4111-8111-111111111111" }));
  global.fetch = async () => Response.json({ ok: true, claimedGuestId: "legacy-guest", userId: "account-a" });
  try {
    await api("/auth/google", { method: "POST" });
    assert.equal(pendingRequestId("account-a", "legacy"), "11111111-1111-4111-8111-111111111111");
    assert.equal(browser.items.has("lm_pending"), false);
  } finally {
    global.fetch = original;
    browser.restore();
  }
});


test("damaged pending state fails closed until explicit reset and never discards a newer record", () => {
  const browser = browserState();
  try {
    for (const damaged of ["{broken-json", '{"digest":"old","requestId":42}']) {
      browser.items.set("kr_pending:account-a", damaged);
      let problem!: DamagedPendingRequest;
      assert.throws(() => pendingRequestId("account-a", "input"), (error) => {
        assert.ok(error instanceof DamagedPendingRequest);
        problem = error;
        return true;
      });
      assert.equal(browser.items.get("kr_pending:account-a"), damaged);
      assert.match(problem.message, /charged again/);
      resetDamagedPendingRequest(problem); // Explicit user acknowledgement, never automatic.
      const replacement = pendingRequestId("account-a", "input");
      resetDamagedPendingRequest(problem);
      assert.equal(pendingRequestId("account-a", "input"), replacement);
    }
  } finally { browser.restore(); }
});


function sessionLockQueue() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  let queue = Promise.resolve<unknown>(undefined);
  let active = false, requests = 0;
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (name: string, work: () => Promise<unknown>) => {
      assert.equal(name, "kakareel-session");
      requests++;
      const next = queue.then(async () => {
        assert.equal(active, false);
        active = true;
        try { return await work(); }
        finally { active = false; }
      });
      queue = next.catch(() => {});
      return next;
    },
  } });
  return {
    get active() { return active; },
    get requests() { return requests; },
    restore() {
      if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
      else Reflect.deleteProperty(navigator, "locks");
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("expired owner-bound logout refreshes inside its existing Web Lock and retries with the same owner", { timeout: 2000 }, async () => {
  const original = global.fetch;
  const browser = browserState(), lock = sessionLockQueue();
  const calls: string[] = [];
  let valid = false;
  global.fetch = async (url, init) => {
    assert.equal(lock.active, true, "cookie-changing work must remain protected");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url === "/api/auth/refresh") {
      valid = true;
      return Response.json({ ok: true });
    }
    assert.equal(url, "/api/session");
    if (method === "DELETE") {
      assert.equal((init?.headers as Record<string, string>)["X-KakaReel-Owner"], "account-a");
      if (valid) {
        valid = false;
        return Response.json({ ok: true });
      }
    }
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    await api("/session", { method: "DELETE", headers: { "X-KakaReel-Owner": "account-a" } });
    assert.equal(valid, false);
    assert.equal(lock.requests, 1, "refresh must not reacquire the held Web Lock");
    assert.deepEqual(calls, ["DELETE /api/session", "GET /api/session", "POST /api/auth/refresh", "DELETE /api/session"]);
  } finally {
    global.fetch = original;
    lock.restore();
    browser.restore();
  }
});

for (const webLocks of [true, false]) {
  test(`logout does not await a refresh flight queued behind its own lock (Web Locks: ${webLocks})`, { timeout: 2000 }, async () => {
    const original = global.fetch;
    const browser = browserState();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    const lock = webLocks ? sessionLockQueue() : undefined;
    if (!webLocks) Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const started = deferred(), release = deferred();
    let valid = false, deletes = 0, refreshes = 0, reads = 0;
    global.fetch = async (url, init) => {
      if (url === "/api/jobs") {
        reads++;
        return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
      }
      if (url === "/api/auth/refresh") {
        refreshes++;
        valid = true;
        return Response.json({ ok: true });
      }
      assert.equal(url, "/api/session");
      if (init?.method === "DELETE") {
        deletes++;
        assert.equal((init.headers as Record<string, string>)["X-KakaReel-Owner"], "account-a");
        if (deletes === 1) {
          started.resolve();
          await release.promise;
          return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
        }
        assert.equal(valid, true);
        valid = false;
        return Response.json({ ok: true });
      }
      return valid ? Response.json({ authenticated: true })
        : Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
    };
    try {
      const logout = api("/session", { method: "DELETE", headers: { "X-KakaReel-Owner": "account-a" } });
      await started.promise;
      const reader = api("/jobs").catch((error: Error) => error);
      // Let the reader's expired response enqueue its refresh behind logout.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (lock) assert.equal(lock.requests, 2);
      assert.equal(refreshes, 0, "queued refresh must not overlap the identity mutation");
      release.resolve();
      await logout;
      const rejected = await reader;
      assert.ok(rejected instanceof Error);
      assert.match(rejected.message, /account changed/i);
      assert.equal(deletes, 2);
      assert.equal(reads, 1, "the old reader cannot retry after logout");
      assert.equal(refreshes, 1);
      assert.equal(valid, false, "a late refresh cannot restore logged-out cookies");
    } finally {
      release.resolve();
      global.fetch = original;
      if (lock) lock.restore();
      else if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
      else Reflect.deleteProperty(navigator, "locks");
      browser.restore();
    }
  });
}

test("expired logout retains its displayed owner after refresh reveals another account", { timeout: 2000 }, async () => {
  const original = global.fetch;
  const browser = browserState(), lock = sessionLockQueue();
  let valid = false, deletes = 0, revoked = false;
  global.fetch = async (url, init) => {
    if (url === "/api/auth/refresh") {
      valid = true; // Cookie identity is B, while the initiating page still shows A.
      return Response.json({ ok: true });
    }
    assert.equal(url, "/api/session");
    if (init?.method === "DELETE") {
      deletes++;
      const expectedOwner = (init.headers as Record<string, string>)["X-KakaReel-Owner"];
      const matchesCookieOwner = expectedOwner === "account-b";
      assert.equal(expectedOwner, "account-a");
      if (valid) {
        // Mirror DELETE /session's server-side guard after authenticating B.
        if (!matchesCookieOwner)
          return Response.json({ error: "Your account changed. Refresh before signing out." }, { status: 409 });
        revoked = true;
        return Response.json({ ok: true });
      }
    }
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    await assert.rejects(api("/session", { method: "DELETE", headers: { "X-KakaReel-Owner": "account-a" } }), /account changed/i);
    assert.equal(deletes, 2);
    assert.equal(revoked, false);
    assert.equal(valid, true);
    assert.equal(lock.requests, 1);
  } finally {
    global.fetch = original;
    lock.restore();
    browser.restore();
  }
});


test("failed refresh during logout releases the session lock and does not retry DELETE", { timeout: 2000 }, async () => {
  const original = global.fetch;
  const browser = browserState(), lock = sessionLockQueue();
  let deletes = 0, ended = 0;
  browser.events.addEventListener(SESSION_ENDED, () => ended++);
  global.fetch = async (url, init) => {
    assert.equal(lock.active, true);
    if (init?.method === "DELETE") deletes++;
    if (url === "/api/auth/refresh") return Response.json({ error: "Session ended" }, { status: 401 });
    return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 });
  };
  try {
    await assert.rejects(api("/session", { method: "DELETE", headers: { "X-KakaReel-Owner": "account-a" } }), /sign in again/i);
    assert.equal(deletes, 1);
    assert.equal(ended, 1);
    assert.equal(lock.active, false);
    // A later identity mutation must be able to acquire the same lock.
    global.fetch = async () => {
      assert.equal(lock.active, true);
      return Response.json({ ok: true });
    };
    await api("/session", { method: "DELETE" });
    assert.equal(lock.requests, 2);
  } finally {
    global.fetch = original;
    lock.restore();
    browser.restore();
  }
});
