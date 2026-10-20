import { test } from "node:test";
import assert from "node:assert/strict";
import { api, SESSION_ENDED } from "../src/lib/api";

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
      ? Response.json({ ok: true })
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
