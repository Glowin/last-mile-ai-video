import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  normalizeImageUpload, planImageUpload, ImageUploadError,
  MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_DECODED_PIXELS,
} from "../src/lib/image-upload";

// These synthetic headers and decoder/canvas stubs test policy and byte plumbing.
// They DO NOT verify real JPEG/PNG decoding, EXIF, alpha blending, or visual quality.
// Main's real-browser check must inspect the canonical result.dataUrl with real art.
function source(width = 1600, height = 1200, size = 200_000, type = "image/png"): Blob {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  if (type === "image/png") {
    data.set([137, 80, 78, 71, 13, 10, 26, 10]);
    view.setUint32(8, 13); view.setUint32(12, 0x49484452);
    view.setUint32(16, width); view.setUint32(20, height);
  } else {
    data.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 11, 8]);
    view.setUint16(13, height); view.setUint16(15, width);
    data.set([1, 1, 0x11, 0], 17);
  }
  return new Blob([data], { type });
}

function replace(t: TestContext, target: object, key: PropertyKey, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

function browser(t: TestContext, width = 1600, height = 1200) {
  const state = {
    decoded: 0, closed: 0, canvases: 0,
    attempts: [] as { width: number; height: number; quality: number; type: string }[],
    draws: [] as unknown[][], fills: [] as unknown[][],
    events: [] as string[],
    encode: (_index: number): Blob | null => new Blob([new Uint8Array(90_000)], { type: "image/jpeg" }),
  };
  const bitmap = { width, height, close() { state.closed++; } };
  replace(t, globalThis, "createImageBitmap", async (_file: Blob, options: unknown) => {
    state.decoded++;
    assert.deepEqual(options, { imageOrientation: "from-image" });
    return bitmap;
  });
  const ctx = {
    fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "",
    fillRect(...args: unknown[]) { state.fills.push([ctx.fillStyle, ...args]); state.events.push("fill"); },
    drawImage(...args: unknown[]) { state.draws.push(args); state.events.push("draw"); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: (_type: string): typeof ctx | null => ctx,
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) {
      state.attempts.push({ width: canvas.width, height: canvas.height, quality, type });
      state.events.push("encode");
      callback(state.encode(state.attempts.length - 1));
    },
  };
  replace(t, globalThis, "document", { createElement(tag: string) {
    assert.equal(tag, "canvas"); state.canvases++; return canvas;
  } });
  replace(t, globalThis, "fetch", () => { assert.fail("Image normalization must never use the network"); });
  return { state, bitmap, canvas, ctx };
}

test("planning preserves landscape/portrait aspect, bounded sizes, and never upscales", () => {
  assert.deepEqual(planImageUpload(1600, 1200), [{ width: 1024, height: 768 }, { width: 768, height: 576 }]);
  assert.deepEqual(planImageUpload(1200, 1600), [{ width: 768, height: 1024 }, { width: 576, height: 768 }]);
  assert.deepEqual(planImageUpload(512, 384), [{ width: 512, height: 384 }]);
  assert.deepEqual(planImageUpload(2048, 768), [{ width: 1024, height: 384 }]);
  assert.deepEqual(planImageUpload(1920, 1080), [{ width: 1024, height: 576 }, { width: 768, height: 432 }]);
  for (const [w, h] of [[1729, 997], [997, 1729], [801, 503], [4000, 4000]]) {
    for (const plan of planImageUpload(w, h)) {
      const scale = Math.min(1, Math.max(plan.width, plan.height) / Math.max(w, h));
      assert.ok(Math.abs(plan.width - w * scale) <= 0.5);
      assert.ok(Math.abs(plan.height - h * scale) <= 0.5);
      assert.ok(plan.width <= w && plan.height <= h);
      assert.ok(Math.min(plan.width, plan.height) >= 384);
      assert.ok(Math.max(plan.width, plan.height) <= 1024);
    }
  }
});

test("planning rejects invalid dimensions, pixel bombs, too-small and too-narrow inputs", () => {
  for (const dims of [[0, 500], [-1, 500], [NaN, 500], [Infinity, 500], [500.5, 500],
    [Number.MAX_SAFE_INTEGER, 500], [4001, 4000], [383, 900], [3000, 1000], [1000, 3000]]) {
    assert.throws(() => planImageUpload(...dims as [number, number]), ImageUploadError);
  }
  assert.equal(MAX_IMAGE_DECODED_PIXELS, 16_000_000);
  assert.equal(planImageUpload(4000, 4000).length, 2);
});

test("small PNG/JPEG originals retain exact bytes and displayed dimensions, including above 1024", async t => {
  const { state } = browser(t, 2048, 1024);
  for (const type of ["image/png", "image/jpeg"]) {
    const input = source(2048, 1024, MAX_IMAGE_UPLOAD_BYTES, type);
    const result = await normalizeImageUpload(input);
    assert.deepEqual(result, {
      dataUrl: `data:${type};base64,${Buffer.from(await input.arrayBuffer()).toString("base64")}`,
      mimeType: type, width: 2048, height: 1024, bytes: MAX_IMAGE_UPLOAD_BYTES,
      originalBytes: MAX_IMAGE_UPLOAD_BYTES, optimized: false,
    });
  }
  assert.equal(state.decoded, 2); assert.equal(state.closed, 2); assert.equal(state.canvases, 0);
});

test("six bounded attempts use white fill, original source, ordered qualities, and exact encoded bytes", async t => {
  const { state, bitmap, canvas, ctx } = browser(t);
  const accepted = new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES).fill(37)], { type: "image/jpeg" });
  state.encode = index => index === 5 ? accepted : new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)], { type: "image/jpeg" });
  const result = await normalizeImageUpload(source());
  assert.deepEqual(state.attempts, [1024, 768].flatMap(width => [0.85, 0.75, 0.65].map(quality => ({
    width, height: width * 0.75, quality, type: "image/jpeg",
  }))));
  assert.deepEqual(state.fills, [["#ffffff", 0, 0, 1024, 768], ["#ffffff", 0, 0, 768, 576]]);
  assert.deepEqual(state.draws, [[bitmap, 0, 0, 1024, 768], [bitmap, 0, 0, 768, 576]]);
  assert.deepEqual(state.events, ["fill", "draw", "encode", "encode", "encode", "fill", "draw", "encode", "encode", "encode"]);
  assert.equal(ctx.imageSmoothingEnabled, true); assert.equal(ctx.imageSmoothingQuality, "high");
  assert.equal(result.dataUrl, `data:image/jpeg;base64,${Buffer.from(await accepted.arrayBuffer()).toString("base64")}`);
  assert.deepEqual({ ...result, dataUrl: "omitted" }, { dataUrl: "omitted", mimeType: "image/jpeg",
    width: 768, height: 576, originalBytes: 200_000, bytes: MAX_IMAGE_UPLOAD_BYTES, optimized: true });
  assert.equal(state.closed, 1); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test("stops at first fitting quality and accepts input exactly 3 MiB", async t => {
  const { state } = browser(t);
  state.encode = index => new Blob([new Uint8Array(index === 0 ? 130_000 : 100_000)], { type: "image/jpeg" });
  const result = await normalizeImageUpload(source(1600, 1200, MAX_IMAGE_INPUT_BYTES));
  assert.equal(state.attempts.length, 2); assert.equal(result.bytes, 100_000);
  assert.equal(result.originalBytes, MAX_IMAGE_INPUT_BYTES); assert.equal(result.width, 1024);
});

test("cannot fit refuses after six attempts instead of returning an oversized payload", async t => {
  const { state } = browser(t);
  state.encode = () => new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)], { type: "image/jpeg" });
  await assert.rejects(normalizeImageUpload(source()), /cannot fit within 120 KiB/);
  assert.equal(state.attempts.length, 6); assert.equal(state.closed, 1);
});

test("fallback cannot violate minimum short edge; smaller inputs never upscale", async t => {
  const { state, bitmap } = browser(t, 2048, 768);
  state.encode = () => new Blob([new Uint8Array(130_000)], { type: "image/jpeg" });
  await assert.rejects(normalizeImageUpload(source(2048, 768)), /cannot fit/);
  assert.equal(state.attempts.length, 3);
  assert.ok(state.attempts.every(a => a.width === 1024 && a.height === 384));
  bitmap.width = 512; bitmap.height = 384; state.attempts.length = 0;
  state.encode = () => new Blob([new Uint8Array(100_000)], { type: "image/jpeg" });
  const result = await normalizeImageUpload(source(512, 384));
  assert.equal(result.width, 512); assert.equal(result.height, 384);
});

test("bad types, size, signatures, malformed JPEG segments, and pixel bombs fail before decode", async t => {
  const { state } = browser(t);
  const badInputs = [new Blob([], { type: "image/png" }), new Blob(["private"], { type: "image/gif" }),
    source(500, 500, MAX_IMAGE_INPUT_BYTES + 1), source(4001, 4000, 100),
    source(0, 500, 100), new Blob(["not an image"], { type: "image/png" }),
    new Blob([await source().arrayBuffer()], { type: "image/jpeg" }),
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])], { type: "image/jpeg" })];
  for (const input of badInputs) await assert.rejects(normalizeImageUpload(input), ImageUploadError);
  assert.equal(state.decoded, 0); assert.equal(state.canvases, 0);
});

test("small files still require a successful decode and local 384 px minimum", async t => {
  const { state, bitmap } = browser(t, 383, 500);
  await assert.rejects(normalizeImageUpload(source(383, 500, 100)), /384 pixels/);
  bitmap.width = 600; bitmap.height = 500;
  await assert.rejects(normalizeImageUpload(source(500, 500, 100)), /inconsistent dimensions/);
  bitmap.width = 4001; bitmap.height = 4000;
  await assert.rejects(normalizeImageUpload(source(500, 500, 100)), /too large/);
  assert.equal(state.closed, 3); assert.equal(state.canvases, 0);
});

test("decoder-oriented dimensions drive output and planning", async t => {
  const { state } = browser(t, 1200, 1600);
  const result = await normalizeImageUpload(source(1600, 1200, 200_000, "image/jpeg"));
  assert.equal(result.width, 768); assert.equal(result.height, 1024);
  assert.equal(state.attempts.length, 1);
});

test("browser failures return safe copy without logging or exposing image data", async t => {
  const { state, canvas, bitmap } = browser(t);
  const secret = "PRIVATE_FILENAME data:image/png;base64,PRIVATE_BYTES";
  const logs = ["log", "warn", "error"].map(method => t.mock.method(console, method as "log", () => {}));
  for (const output of [null, new Blob([], { type: "image/jpeg" }), new Blob(["bad"], { type: "image/png" })]) {
    state.encode = () => output;
    await assert.rejects(normalizeImageUpload(source()), /could not encode/);
  }
  state.encode = () => { throw new Error(secret); };
  bitmap.close = () => { throw new Error(secret); };
  await assert.rejects(normalizeImageUpload(source()), error => {
    assert.ok(error instanceof ImageUploadError); assert.ok(!error.message.includes("PRIVATE")); return true;
  });
  canvas.getContext = () => null;
  await assert.rejects(normalizeImageUpload(source()), /unavailable/);
  replace(t, globalThis, "createImageBitmap", async () => { throw new Error(secret); });
  await assert.rejects(normalizeImageUpload(source(500, 500, 100)), /could not be prepared/);
  const unreadable = source();
  unreadable.arrayBuffer = async () => { throw new Error(secret); };
  await assert.rejects(normalizeImageUpload(unreadable), /could not be prepared/);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});

test("Image fallback uses only a local object URL and cleans it up on success and error", async t => {
  browser(t);
  replace(t, globalThis, "createImageBitmap", undefined);
  let revoked = 0, fail = false;
  const assigned: string[] = [];
  replace(t, URL, "createObjectURL", () => "blob:local-reference");
  replace(t, URL, "revokeObjectURL", (url: string) => { assert.equal(url, "blob:local-reference"); revoked++; });
  class FakeImage {
    naturalWidth = 512; naturalHeight = 384;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) {
      assigned.push(value);
      if (value) queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
    }
  }
  replace(t, globalThis, "Image", FakeImage);
  const result = await normalizeImageUpload(source(512, 384, 100));
  assert.equal(result.optimized, false); assert.equal(revoked, 1);
  fail = true;
  await assert.rejects(normalizeImageUpload(source(512, 384, 100)), /could not be opened/);
  assert.equal(revoked, 2);
  assert.deepEqual(assigned, ["blob:local-reference", "", "blob:local-reference", ""]);
});

test("hung decoding times out with safe copy and closes a late bitmap", async t => {
  const { state, bitmap } = browser(t);
  let finish!: (bitmap: unknown) => void;
  replace(t, globalThis, "createImageBitmap", () => new Promise(resolve => { finish = resolve; }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = assert.rejects(normalizeImageUpload(source()), /took too long/);
  await nextTurn();
  t.mock.timers.tick(10_000);
  await pending;
  bitmap.close = () => { state.closed++; throw new Error("PRIVATE_BROWSER_ERROR"); };
  finish(bitmap); await nextTurn();
  assert.equal(state.closed, 1); assert.equal(state.canvases, 0);
});

test("hung canvas callback is bounded and resources are released", async t => {
  const { state, canvas } = browser(t);
  canvas.toBlob = () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = assert.rejects(normalizeImageUpload(source()), /took too long/);
  await nextTurn(); t.mock.timers.tick(10_000); await pending;
  assert.equal(state.closed, 1); assert.equal(canvas.width, 0);
});
