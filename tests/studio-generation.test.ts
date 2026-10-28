import assert from "node:assert/strict";
import { test } from "node:test";
import { generationRequestId } from "../src/lib/api";
import { clearPendingRequest } from "../src/lib/pending-request";
import {
  focusStudioProgress, StudioRequests, studioHistoryHint,
  studioJobDescription, studioJobState, studioJobSafetyDisclosure, studioHistoryView, type StudioJob, type StudioSafety,
} from "../src/lib/studio-generation";

const job = (overrides: Partial<StudioJob> = {}): StudioJob => ({
  id: "task-a", family: "seedance", mode: "text", prompt: "A bird in flight",
  status: "pending", resultUrl: null, createdAt: "2026-10-27T00:00:00Z",
  duration: 5, resolution: "720p", ...overrides,
});

const safety = (status: StudioSafety["status"], overrides: Partial<StudioSafety> = {}): StudioSafety => ({
  policyVersion: "unattended-mvp-test", status, reason: null, attempts: 1,
  deadlineAt: "2026-10-28T01:00:00Z", imageReview: "not_applicable",
  outputReview: "not_reviewed_mvp", ...overrides,
});

test("MVP checks distinguish checking and automatic confirmation from model generation", () => {
  for (const [status, label, active] of [
    ["checking", "Safety check in progress", true],
    ["review", "Safety check pending confirmation", false],
    ["allowed", "Generating", true],
  ] as const) {
    const current = job({ status: "submitting", safety: safety(status), moderation: null, reviewRequired: true });
    const state = studioJobState(current);
    assert.equal(state.label, label);
    assert.equal(state.active, active);
    assert.equal(state.unresolved, true, "all pre-terminal states block duplicates");
    assert.doesNotMatch(state.label, /legacy|awaiting input|awaiting output|on hold/i);
    assert.equal(studioJobState(job({ ...current, status: "pending" })).label, label);
    if (status !== "allowed") assert.match(studioJobDescription(current), /generation has not started/);
  }
  assert.match(studioJobDescription(job({ safety: safety("review") })), /fixed time limit and may expire/);
  assert.match(studioJobDescription(job({ safety: safety("review") })), /not a queue for operator approval/);
  const confirming = job({ status: "unknown", safety: safety("allowed") });
  assert.equal(studioJobState(confirming).label, "Confirming result");
  assert.equal(studioJobState(confirming).phase, "unknown", "existing task recovery stays available");
  assert.equal(studioJobState(confirming).unresolved, true);
  assert.match(studioJobDescription(confirming), /not a content safety review/);
});

test("terminal MVP job outcomes outrank stale checking or review metadata", () => {
  for (const status of ["checking", "review", "allowed"] as const) {
    const failed = job({ status: "failed", safety: safety(status) });
    assert.deepEqual(studioJobState(failed), { phase: "failed", label: "Failed", active: false, unresolved: false });
    const delivered = job({ status: "success", resultUrl: "https://example.test/video.mp4", safety: safety(status) });
    assert.deepEqual(studioJobState(delivered), { phase: "success", label: "Ready", active: false, unresolved: false });
    assert.match(studioJobDescription(delivered), /ready/);
    assert.doesNotMatch(studioJobDescription(failed), /being sent|awaiting confirmation/);
  }
});

test("stopped safety checks override stale job status and never reveal provider reasons", () => {
  for (const status of ["blocked", "expired", "error", "canceled"] as const) {
    for (const jobStatus of ["submitting", "pending", "unknown", "failed", "success"] as const) {
      const current = job({ status: jobStatus, safety: safety(status, { reason: "PRIVATE-provider-payload" }),
        resultUrl: "https://example.test/withheld.mp4", creditState: "released" });
      assert.deepEqual(studioJobState(current), { phase: "failed", label: "Failed", active: false, unresolved: false });
      const description = studioJobDescription(current);
      assert.match(description, /No video generation was started/);
      assert.match(description, /reserved credits have been released/);
      assert.doesNotMatch(description, /PRIVATE|provider-payload/);
      assert.match(description, status === "blocked" ? /usage policy/ : /try again later/);
    }
  }
  assert.match(studioJobDescription(job({ safety: safety("expired"), creditState: "reserved" })), /release is not yet confirmed/);
});

test("MVP success without a result URL remains recoverable and cannot claim delivery", () => {
  const current = job({ status: "success", safety: safety("allowed"), resultUrl: null });
  assert.equal(studioJobState(current).label, "Confirming result");
  assert.equal(studioJobState(current).phase, "unknown");
  assert.equal(studioJobState(current).unresolved, true);
  assert.match(studioJobDescription(current), /Recover this task or refresh history/);
  assert.doesNotMatch(studioJobDescription(current), /video is ready/);
});

test("MVP image and output limits never become a claim of review or retroactive approval", () => {
  assert.equal(studioJobSafetyDisclosure(job()), null);
  assert.equal(studioJobSafetyDisclosure(job({ safety: null, moderation: [] })), null);
  for (const status of ["checking", "review", "allowed", "blocked", "expired", "error", "canceled"] as const) {
    for (const imageReview of ["not_applicable", "not_reviewed_mvp"] as const) {
      const disclosure = studioJobSafetyDisclosure(job({ safety: safety(status, { imageReview, reason: "PRIVATE" }) }))!;
      assert.match(disclosure, imageReview === "not_applicable" ? /Reference image: not applicable/ : /Reference image: not reviewed/);
      assert.match(disclosure, /Generated video: not reviewed/);
      assert.match(disclosure, /neither individually human-reviewed nor automatically moderated/);
      assert.match(disclosure, /text check does not approve an image or video/);
      assert.match(disclosure, /Technical delivery verification is not a content safety check/);
      assert.doesNotMatch(disclosure, /PRIVATE/);
    }
  }
});

test("legacy history keeps actual reviews and does not acquire an MVP safety check", () => {
  for (const safetyValue of [undefined, null]) {
    const legacy = job({ safety: safetyValue, status: "success", moderation: [
      { phase: "input", state: "approved", version: 1 },
      { phase: "output", state: "pending", version: 2 },
    ] });
    const before = JSON.stringify(legacy);
    assert.equal(studioJobState(legacy).label, "Legacy: awaiting output review");
    assert.equal(studioJobState(legacy).unresolved, true);
    assert.match(studioJobDescription(legacy), /legacy.*human review/);
    assert.equal(studioJobSafetyDisclosure(legacy), null);
    assert.equal(JSON.stringify(legacy), before, "deriving labels never mutates history");
  }
});

test("an MVP check survives history refresh/loading and retains the original duplicate guard", () => {
  const requests = new StudioRequests();
  requests.remember("input-a", "paid", "task-a");
  requests.remember("input-b", "paid", "task-b");
  for (const status of ["checking", "review", "allowed"] as const) {
    const jobs = [job({ safety: safety(status), billingMode: "paid" })];
    for (const loadState of ["loading", "error", "loaded"] as const) {
      const snapshot = JSON.parse(JSON.stringify(jobs)) as StudioJob[];
      assert.equal(studioHistoryView(true, true, loadState, snapshot.length), "jobs");
      const original = requests.job("input-a", "paid", snapshot)!;
      assert.equal(original.id, "task-a");
      assert.equal(studioJobState(original).unresolved, true);
      assert.equal(requests.id("input-b", "paid"), "task-b");
    }
  }
  assert.equal(studioJobState(requests.job("input-a", "paid", [job({ safety: safety("expired") })])!).unresolved, false);
});

test("submission completion keeps generation active until a confirmed terminal outcome", () => {
  const requests = new StudioRequests();
  requests.remember("input-a", "preview", "task-a");
  for (const status of ["submitting", "pending", "unknown", "failed", "success"] as const) {
    const current = requests.job("input-a", "preview", [job({ status })]);
    assert.ok(current);
    const state = studioJobState(current);
    assert.equal(state.active, status === "submitting" || status === "pending");
    assert.equal(state.unresolved, !["failed", "success"].includes(status));
  }
  assert.equal(studioJobState(job({ status: "submitting" })).label, "Submitting");
  assert.equal(studioJobState(job()).label, "Generating");
  assert.equal(studioJobState(job({ status: "unknown" })).label, "Outcome unconfirmed");
  assert.match(studioJobDescription(job({ status: "unknown" })), /not a confirmed failure/);
});

test("review holds stop the model spinner without presenting delivery or allowing a duplicate", () => {
  for (const phase of ["input", "output"] as const) {
    const held = job({ status: "success", resultUrl: "https://example.test/video.mp4", reviewRequired: true,
      moderation: [{ phase, state: "pending", version: 1 }] });
    const state = studioJobState(held);
    assert.equal(state.phase, `${phase}-review`);
    assert.equal(state.active, false);
    assert.equal(state.unresolved, true);
    assert.match(state.label, new RegExp(phase));
    assert.match(studioJobDescription(held), phase === "input" ? /before generation can start/ : /before it can be delivered/);
  }
  assert.equal(studioJobState(job({ reviewRequired: true })).phase, "review");
  assert.equal(studioJobState(job({ reviewRequired: true })).active, false);
});

test("review decisions distinguish declined and expired from an unknown provider outcome", () => {
  for (const state of ["rejected", "expired"] as const) {
    const denied = job({ status: "unknown", reviewRequired: true,
      moderation: [{ phase: "input", state, version: 1 }] });
    assert.equal(studioJobState(denied).phase, "failed");
    assert.equal(studioJobState(denied).unresolved, false);
    assert.match(studioJobDescription(denied), /contact support to appeal/);
  }
  const reviewed = job({ moderation: [
    { phase: "input", state: "rejected", version: 1 },
    { phase: "input", state: "approved", version: 2 },
    { phase: "output", state: "pending", version: 1 },
  ] });
  assert.equal(studioJobState(reviewed).phase, "output-review");
  const providerFailed = job({ status: "failed", moderation: [
    { phase: "input", state: "rejected", version: 1 },
    { phase: "input", state: "approved", version: 2 },
  ] });
  assert.equal(studioJobState(providerFailed).label, "Generation failed");
  assert.match(studioJobDescription(providerFailed), /provider could not finish/);
  assert.doesNotMatch(studioJobDescription(providerFailed), /content review/);
});

test("duplicate protection permits changed inputs and retains each task when switching back", () => {
  const requests = new StudioRequests();
  requests.remember("input-a", "paid", "task-a");
  const jobs = [job({ billingMode: "paid" })];
  assert.equal(requests.job("input-b", "paid", jobs), undefined);
  assert.equal(requests.job("input-a", "preview", jobs), undefined);
  requests.remember("input-b", "paid", "task-b");
  jobs.push(job({ id: "task-b", billingMode: "paid" }));
  assert.equal(requests.job("input-a", "paid", jobs)?.id, "task-a");
  assert.equal(requests.job("input-b", "paid", jobs)?.id, "task-b");
  assert.equal(studioJobState(requests.job("input-a", "paid", jobs)!).unresolved, true);
  jobs[0] = job({ status: "success", billingMode: "paid" });
  assert.equal(studioJobState(requests.job("input-a", "paid", jobs)!).unresolved, false);
  assert.equal(studioJobState(requests.job("input-b", "paid", jobs)!).unresolved, true);
});

test("interrupted submission retains its original ID after edits; recovery binds to the same task", () => {
  const requests = new StudioRequests();
  requests.remember("input-a", "paid", "unacknowledged-task");
  requests.remember("input-b", "paid", "another-task");
  assert.equal(requests.job("input-a", "paid", []), undefined);
  assert.equal(requests.id("input-a", "paid"), "unacknowledged-task");
  const recovered = job({ id: "unacknowledged-task", status: "unknown" });
  assert.equal(studioJobState(requests.job("input-a", "paid", [recovered])!).unresolved, true);
  // The component replaces this owner-scoped tracker on identity change.
  const nextOwner = new StudioRequests();
  assert.equal(nextOwner.id("input-a", "paid"), undefined);
});

test("acknowledging the original task preserves a newer saved intent and an unresolved ID is stable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const requests = new StudioRequests();
    const payloadA = { prompt: "A bird" }, payloadB = { prompt: "A river" };
    const inputA = JSON.stringify(payloadA), inputB = JSON.stringify(payloadB);
    const idA = await generationRequestId("owner", payloadA, "paid");
    requests.remember(inputA, "paid", idA);
    assert.equal(await generationRequestId("owner", payloadA, "paid"), idA);
    const idB = await generationRequestId("owner", payloadB, "paid");
    requests.remember(inputB, "paid", idB);
    assert.notEqual(idA, idB);
    assert.equal(requests.id(inputA, "paid"), idA, "switching back retries the original request");
    clearPendingRequest("owner", idA);
    assert.equal(await generationRequestId("owner", payloadB, "paid"), idB, "late acknowledgement never clears the newer saved intent");
    clearPendingRequest("owner", idB);
    assert.notEqual(await generationRequestId("owner", payloadB, "paid"), idB, "an acknowledged task permits a fresh intent");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("history copy distinguishes session loading, a Google account and a preview guest", () => {
  assert.equal(studioHistoryHint(false, false), "Checking your session…");
  assert.equal(studioHistoryHint(false, true), "Checking your session…");
  const signedIn = studioHistoryHint(true, true);
  assert.match(signedIn, /saved to your account/);
  assert.doesNotMatch(signedIn, /sign in|browser session/i);
  assert.match(studioHistoryHint(true, false), /same browser/);
  assert.match(studioHistoryHint(true, false), /sign in with Google/);
});

test("View progress focuses without an implicit jump, then scrolls with the motion preference", () => {
  for (const reducedMotion of [true, false]) {
    const calls: unknown[] = [];
    const target = {
      focus: (options: FocusOptions) => calls.push(["focus", options]),
      scrollIntoView: (options: ScrollIntoViewOptions) => calls.push(["scroll", options]),
    } as unknown as HTMLElement;
    assert.deepEqual(calls, [], "creating the target never moves the page");
    focusStudioProgress(target, reducedMotion);
    assert.deepEqual(calls, [
      ["focus", { preventScroll: true }],
      ["scroll", { behavior: reducedMotion ? "instant" : "smooth", block: "start" }],
    ]);
  }
});

test("successful tasks without a video URL do not claim that a download is available", () => {
  assert.match(studioJobDescription(job({ status: "success" })), /Refresh history/);
  assert.match(studioJobDescription(job({ status: "success", resultUrl: "https://example.test/video.mp4" })), /ready/);
});

test("history is only truly empty after a successful load or a checked anonymous session", () => {
  assert.equal(studioHistoryView(false, false, "idle", 0), "loading");
  assert.equal(studioHistoryView(true, true, "idle", 0), "loading");
  assert.equal(studioHistoryView(true, true, "loading", 0), "loading");
  assert.equal(studioHistoryView(true, true, "error", 0), "error");
  assert.equal(studioHistoryView(true, true, "loaded", 0), "empty");
  assert.equal(studioHistoryView(true, false, "loaded", 0), "empty");
  assert.equal(studioHistoryView(true, true, "loading", 3), "jobs");
  assert.equal(studioHistoryView(true, true, "error", 3), "jobs");
});
