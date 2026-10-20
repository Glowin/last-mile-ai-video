import { test } from "node:test";
import assert from "node:assert/strict";
import { generationSchema, providerPayload } from "../src/server/input";
import { sessionOwner, issueSession } from "../src/server/auth";
import { safeResultUrl } from "../src/server/provider";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=";
const base = {
  requestId: "95ce170b-a815-4c4a-869e-7ec7dc147130",
  family: "seedance" as const,
  mode: "text" as const,
  prompt: "A leaf moving gently in sunlight",
  duration: 5,
  resolution: "720p",
  ratio: "16:9",
  audio: false,
};
test("Seedance uses ratio; image mode requires adaptive and rejects 480p", () => {
  assert.equal(providerPayload(generationSchema.parse(base)).ratio, "16:9");
  assert.ok(!("aspect_ratio" in providerPayload(base)));
  assert.equal(
    generationSchema.safeParse({ ...base, mode: "image", image: png }).success,
    false,
  );
  assert.equal(
    generationSchema.safeParse({
      ...base,
      mode: "image",
      image: png,
      ratio: "adaptive",
    }).success,
    true,
  );
  assert.equal(
    generationSchema.safeParse({
      ...base,
      mode: "image",
      image: png,
      ratio: "adaptive",
      resolution: "480p",
    }).success,
    false,
  );
});
test("MiniMax schema keeps duration a string and uses aspect_ratio", () => {
  const p = providerPayload(
    generationSchema.parse({
      ...base,
      family: "minimax",
      duration: 6,
      resolution: "2K",
    }),
  );
  assert.equal(p.duration, "6");
  assert.equal(p.aspect_ratio, "16:9");
  assert.ok(!("ratio" in p));
});
test("Kling never receives unsupported resolution or image aspect ratio", () => {
  const p = providerPayload(
    generationSchema.parse({
      ...base,
      family: "kling",
      mode: "image",
      image: png,
      ratio: "adaptive",
      resolution: "4K",
    }),
  );
  assert.ok(!("resolution" in p));
  assert.ok(!("aspect_ratio" in p));
  assert.equal(p.sound, false);
});
test("private URL inputs and disguised image data are not accepted", () => {
  assert.equal(
    generationSchema.safeParse({
      ...base,
      mode: "image",
      ratio: "adaptive",
      image: "http://127.0.0.1/secret",
    }).success,
    false,
  );
  assert.equal(
    generationSchema.safeParse({
      ...base,
      mode: "image",
      ratio: "adaptive",
      image: "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    }).success,
    false,
  );
  assert.equal(
    generationSchema.safeParse({ ...base, duration: 999 }).success,
    false,
  );
  assert.equal(
    generationSchema.safeParse({ ...base, prompt: "  " }).success,
    false,
  );
});
test("signed session rejects tampering and expired cookies", () => {
  process.env.SESSION_SECRET =
    "test-only-session-secret-not-used-in-production";
  const token = issueSession();
  assert.ok(sessionOwner(token));
  assert.equal(sessionOwner(token + "x"), null);
  assert.equal(sessionOwner(token.replace(/\.\d+\./, ".1.")), null);
  assert.equal(sessionOwner(undefined), null);
});
test("result links reject executable schemes and embedded credentials", () => {
  assert.equal(safeResultUrl("javascript:alert(1)"), false);
  assert.equal(safeResultUrl("https://user:password@example.com/v.mp4"), false);
  assert.equal(safeResultUrl("https://example.com/v.mp4"), true);
});
