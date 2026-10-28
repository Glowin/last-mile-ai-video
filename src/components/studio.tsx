"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HomeLink } from "./home-link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Aperture,
  ArrowUpRight,
  Sparkles,
  ImageIcon,
  Type,
  Upload,
  X,
  Film,
  Clock,
  Download,
  RefreshCw,
  LoaderCircle,
  LockKeyhole,
  Check,
  LogOut,
  CreditCard,
  UserRound,
} from "lucide-react";
import {
  families,
  getFamily,
  ratios,
  resolutions,
  type FamilySlug,
  type Mode,
} from "@/lib/models";

import { api, generationRequestId, paidGenerationAllowed, usableGenerationQuote, type GenerationQuote, SESSION_ENDED, IDENTITY_CHANGED_KEY, IDENTITY_CHANGED_EVENT } from "@/lib/api";
import {
  clearPendingRequest, adoptLegacyPendingRequest,
  DamagedPendingRequest, resetDamagedPendingRequest,
} from "@/lib/pending-request";
import { GoogleSignIn } from "./google-sign-in";
import { AgeDeclarationFields } from "./age-declaration-fields";
import { emptyAgeDeclaration } from "@/lib/age-declaration";
import { generationPilotInputAllowed, type BillingSummaryResponse } from "@/lib/billing";
import { normalizeImageUpload, ImageUploadError, type NormalizedImageUpload } from "@/lib/image-upload";
import { videoCredits } from "@/lib/video-credit-rates";
import { focusStudioProgress, StudioRequests, studioJobState, studioJobDescription, studioJobSafetyDisclosure, studioHistoryHint, studioHistoryView, type StudioHistoryState, type StudioJob } from "@/lib/studio-generation";
const creditStateLabel = {
  none: "No purchased credits used",
  reserved: "Credits reserved · outcome pending",
  consumed: "Credits used · delivery confirmed",
  released: "Reservation released · no credits consumed",
};
const quoteReason: Record<string, string> = {
  GENERATION_CHARGING_DISABLED: "Paid generation is not yet available.",
  WALLET_BLOCKED: "Credit spending is blocked for this account. Review your orders.",
  INSUFFICIENT_CREDITS: "You do not have enough available credits for this generation.",
  UNVERIFIED_VIDEO_PRICE: "Paid pricing has not been verified for these settings.",
  GENERATION_PILOT_JOB_LIMIT: "Your single paid trial has already been used. Check the original task in My videos.",
};
/** Only the latest selection may update the UI, including its error/busy state. */
export class StudioImageUpload {
  private version = 0;
  get revision() { return this.version; }
  pending = false;
  constructor(private normalize = normalizeImageUpload) {}
  cancel() { this.version++; this.pending = false; }
  async prepare(file: Blob, done: (image: NormalizedImageUpload) => void, failed: (message: string) => void, busy: (value: boolean) => void) {
    const version = ++this.version;
    this.pending = true;
    busy(true);
    try {
      const image = await this.normalize(file);
      if (version === this.version) done(image);
    } catch (error) {
      if (version === this.version) failed(error instanceof ImageUploadError ? error.message : "This image could not be prepared. Choose another JPEG or PNG.");
    } finally {
      if (version === this.version) { this.pending = false; busy(false); }
    }
  }
}
export function Studio() {
  const params = useSearchParams();
  const initial = getFamily(params.get("model") ?? "") ?? families[0];
  const initialMode: Mode = params.get("mode") === "image" ? "image" : "text";
  const [family, setFamily] = useState<FamilySlug>(initial.slug),
    [mode, setMode] = useState<Mode>(initialMode);
  const [prompt, setPrompt] = useState(
      params.get("prompt")?.slice(0, initial.maxPrompt) ?? "",
    ),
    [duration, setDuration] = useState<number>(initial.defaultDuration);
  const [resolution, setResolution] = useState(
      initial.slug === "seedance"
        ? "720p"
        : initial.slug === "minimax"
          ? "2K"
          : "4K",
    ),
    [ratio, setRatio] = useState(initialMode === "image" ? "adaptive" : "16:9");
  const [audio, setAudio] = useState(false),
    [image, setImage] = useState<string>(),
    [imageName, setImageName] = useState("");
  const imageUpload = useRef(new StudioImageUpload());
  const [preparingImage, setPreparingImage] = useState(false);
  const [imageDetails, setImageDetails] = useState<NormalizedImageUpload | null>(null);
  useEffect(() => {
    const upload = imageUpload.current;
    return () => upload.cancel();
  }, []);
  const [authenticated, setAuthenticated] = useState(false),
    [ready, setReady] = useState(false),
    [checked, setChecked] = useState(false),
    [code, setCode] = useState("");
  const [previewAge, setPreviewAge] = useState(emptyAgeDeclaration);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [billingMode, setBillingMode] = useState<"preview" | "paid">("preview");
  const [billing, setBilling] = useState<BillingSummaryResponse | null>(null);
  const [billingError, setBillingError] = useState("");
  const [quote, setQuote] = useState<(GenerationQuote & { payloadKey: string; requestId: string }) | null>(null);
  const [quoting, setQuoting] = useState(false);
  const quoteFlight = useRef(false);
  const generationFlight = useRef(false);
  const submittedRequests = useRef(new StudioRequests());
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmitted, setLastSubmitted] = useState<string>();
  const resultsPanel = useRef<HTMLElement>(null);
  const refreshFlight = useRef(false);
  const recoveryFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resultError, setResultError] = useState("");
  const [historyState, setHistoryState] = useState<StudioHistoryState>("idle");
  const [historyError, setHistoryError] = useState("");
  const historyVersion = useRef(0);
  const [mediaFailure, setMediaFailure] = useState<string>();
  const [mediaRetry, setMediaRetry] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const identityEpoch = useRef(0);
  const sessionOwner = useRef<string | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"preview" | "history">("preview");
  const [pollError, setPollError] = useState("");
  const [damagedPending, setDamagedPending] = useState<DamagedPendingRequest | null>(null);
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const f = getFamily(family)!;
  const generationPayload = {
    family, mode, prompt, duration, resolution, ratio, audio,
    ...(mode === "image" ? { image } : {}),
  };
  const payloadKey = JSON.stringify(generationPayload);
  const currentPayloadKey = useRef(payloadKey);
  currentPayloadKey.current = payloadKey;
  const estimatedCredits = videoCredits(generationPayload);
  const currentQuote = quote?.payloadKey === payloadKey ? quote : null;
  const paidEnabled = !!user && billing?.generationChargingEnabled === true && billing.blocked === false;
  const pilotInputAllowed = !billing?.generationPilot || generationPilotInputAllowed(billing.generationPilot, generationPayload, now);
  const insufficientCredits = billing !== null && (currentQuote?.credits ?? estimatedCredits ?? 0) > billing.availableCredits;
  const paidReady = ageConfirmed && !!user && pilotInputAllowed && !preparingImage && estimatedCredits !== null && paidGenerationAllowed(billing, currentQuote, now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const focused = jobs.find((j) => j.id === selected) ?? jobs[0];
  const mediaKey = focused ? JSON.stringify([focused.id, focused.resultUrl]) : "";
  const historyView = studioHistoryView(checked, authenticated, historyState, jobs.length);
  const matchingJob = submittedRequests.current.job(payloadKey, billingMode, jobs);
  const duplicatePending = !!matchingJob && studioJobState(matchingJob).unresolved;
  const progressJob = matchingJob ?? jobs.find((j) => j.id === lastSubmitted) ?? focused;
  const progressState = progressJob ? studioJobState(progressJob) : null;
  const buttonSpinning = submitting || (!!matchingJob && studioJobState(matchingJob).active);
  function viewProgress() {
    if (progressJob) setSelected(progressJob.id);
    setTab("preview");
    if (resultsPanel.current) focusStudioProgress(resultsPanel.current, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function update(j: StudioJob) {
    const next = [j, ...jobsRef.current.filter((x) => x.id !== j.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    jobsRef.current = next;
    setJobs(next);
  }
  function clearIdentity() {
    clearImage();
    identityEpoch.current++;
    sessionOwner.current = null;
    setAuthenticated(false);
    setUser(null);
    setAgeConfirmed(false);
    setPreviewAge(emptyAgeDeclaration());
    setCanGenerate(false);
    setBilling(null);
    setBillingError("");
    setBillingMode("preview");
    setQuote(null);
    setQuoting(false);
    quoteFlight.current = false;
    generationFlight.current = false;
    submittedRequests.current = new StudioRequests();
    setSubmitting(false);
    setLastSubmitted(undefined);
    refreshFlight.current = false;
    recoveryFlight.current = false;
    setRefreshing(false);
    setRecovering(false);
    setResultError("");
    historyVersion.current++;
    setHistoryState("idle");
    setHistoryError("");
    setMediaFailure(undefined);
    setMediaRetry(0);
    setChecked(false);
    setBusy(false);
    setJobs([]);
    jobsRef.current = [];
    setSelected(undefined);
    setPollError("");
    setDamagedPending(null);
  }
  async function refresh() {
    const epoch = identityEpoch.current;
    const version = ++historyVersion.current;
    setHistoryState("loading");
    setHistoryError("");
    try {
      const d = await api("/jobs");
      if (epoch === identityEpoch.current && version === historyVersion.current) {
        jobsRef.current = d.jobs;
        setJobs(d.jobs);
        setHistoryState("loaded");
      }
    } catch (cause) {
      if (epoch === identityEpoch.current && version === historyVersion.current) {
        setHistoryState("error");
        setHistoryError((cause as Error).message);
      }
      throw cause;
    }
  }
  async function refreshHistory() {
    if (refreshFlight.current) return;
    const epoch = identityEpoch.current;
    refreshFlight.current = true;
    setRefreshing(true);
    setResultError("");
    try {
      await refresh();
      if (epoch === identityEpoch.current) setPollError("");
    } catch {
      // refresh owns history errors and preserves the last known list.
    } finally {
      if (epoch === identityEpoch.current) { refreshFlight.current = false; setRefreshing(false); }
    }
  }
  async function recoverJob(job: StudioJob) {
    const owner = sessionOwner.current;
    if (!owner || busy || recoveryFlight.current) return;
    const epoch = identityEpoch.current;
    recoveryFlight.current = true;
    setRecovering(true);
    setBusy(true);
    setResultError("");
    try {
      const d = await api(`/jobs/${job.id}/recover`, { method: "POST", headers: { "X-KakaReel-Owner": owner } });
      if (epoch !== identityEpoch.current) return;
      update(d.job);
      if (user) await refreshBilling();
    } catch (cause) {
      if (epoch === identityEpoch.current) setResultError((cause as Error).message);
    } finally {
      if (epoch === identityEpoch.current) { recoveryFlight.current = false; setRecovering(false); setBusy(false); }
    }
  }
  async function refreshBilling() {
    const epoch = identityEpoch.current;
    const owner = sessionOwner.current;
    if (!owner) return;
    try {
      const summary: BillingSummaryResponse = await api("/billing", { headers: { "X-KakaReel-Owner": owner } });
      if (epoch !== identityEpoch.current) return;
      setBilling(summary);
      setBillingError("");
    } catch (cause) {
      if (epoch !== identityEpoch.current) return;
      setBilling(null);
      setBillingError((cause as Error).message);
    }
  }
  async function loadSession() {
    const epoch = identityEpoch.current;
    const s = await api("/session");
    if (epoch !== identityEpoch.current) return;
    if (sessionOwner.current && sessionOwner.current !== s.owner) clearIdentity();
    sessionOwner.current = s.owner;
    if (s.owner) {
      try { adoptLegacyPendingRequest(s.owner); } catch { /* Storage can be disabled. */ }
    }
    setAuthenticated(s.authenticated);
    setUser(s.user);
    setAgeConfirmed(s.ageConfirmed === true);
    setCanGenerate(s.canGenerate);
    setReady(s.ready);
    setChecked(true);
    if (s.authenticated) await refresh().catch(() => { /* History has its own retry state. */ });
    else { jobsRef.current = []; setJobs([]); setHistoryState("loaded"); }
    if (s.user && sessionOwner.current === s.owner) await refreshBilling();
  }
  useEffect(() => {
    let live = true;
    const load = () =>
      loadSession().catch((e) => {
        if (live) {
          setChecked(true);
          setError((e as Error).message);
        }
      });
    const ended = () => {
      clearIdentity();
      setChecked(true);
      setError("Your session has ended. Please sign in again.");
    };
    const changed = (e: StorageEvent) => {
      if (e.key === IDENTITY_CHANGED_KEY || e.key === null) {
        clearIdentity();
        void load();
      }
    };
    const localChanged = () => { clearIdentity(); void load(); };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5 * 60_000);
    window.addEventListener(IDENTITY_CHANGED_EVENT, localChanged);
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener("storage", changed);
    return () => {
      live = false;
      identityEpoch.current++;
      clearInterval(timer);
      window.removeEventListener(IDENTITY_CHANGED_EVENT, localChanged);
      window.removeEventListener(SESSION_ENDED, ended);
      window.removeEventListener("storage", changed);
    };
  }, []);
  useEffect(() => {
    if (!authenticated || pollError) return;
    const epoch = identityEpoch.current;
    let active = true,
      running = false,
      failures = 0;
    const interval = setInterval(async () => {
      if (running || document.hidden || failures >= 3) return;
      const pending = jobsRef.current
        .filter((j) => studioJobState(j).unresolved)
        .slice(0, 3);
      if (!pending.length) return;
      running = true;
      try {
        for (const j of pending) {
          const d = await api(`/jobs/${j.id}`);
          if (active && epoch === identityEpoch.current) update(d.job);
        }
        failures = 0;
        if (active && epoch === identityEpoch.current) { setPollError(""); if (user) await refreshBilling(); }
      } catch {
        failures++;
        if (active && epoch === identityEpoch.current && failures >= 3)
          setPollError(
            "Status checks paused after connection errors. Refresh history to check again.",
          );
      } finally {
        running = false;
      }
    }, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [authenticated, pollError, user?.id]);
  function changeModel(slug: FamilySlug) {
    if (slug === "minimax") setAudio(false);
    const model = getFamily(slug)!;
    setFamily(slug);
    setDuration(model.defaultDuration);
    setResolution(
      slug === "seedance" ? "720p" : slug === "minimax" ? "2K" : "4K",
    );
    setRatio(mode === "image" ? "adaptive" : "16:9");
    setPrompt((p) => p.slice(0, model.maxPrompt));
  }
  function changeMode(next: Mode) {
    setMode(next);
    setRatio(next === "image" ? "adaptive" : "16:9");
    if (next === "image" && resolution === "480p") setResolution("720p");
  }
  function clearImage() {
    imageUpload.current.cancel();
    setPreparingImage(false);
    setImage(undefined);
    setImageName("");
    setImageDetails(null);
    setQuote(null);
  }
  async function upload(file?: File) {
    if (!file || busy || generationFlight.current) return;
    clearImage();
    setError("");
    await imageUpload.current.prepare(file, (normalized) => {
      // Preview, quote fingerprint and provider payload share these exact bytes.
      setImage(normalized.dataUrl);
      setImageName(file.name);
      setImageDetails(normalized);
    }, setError, setPreparingImage);
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/session", { method: "POST", body: JSON.stringify({ code,
        ...(!ageConfirmed ? { ageDeclaration: previewAge } : {}),
      }) });
      setCode("");
      await loadSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewAge(emptyAgeDeclaration());
      setBusy(false);
    }
  }
  async function confirmExistingAge(e: React.FormEvent) {
    e.preventDefault();
    const owner = sessionOwner.current;
    if (!owner || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/auth/age", { method: "POST", headers: { "X-KakaReel-Owner": owner },
        body: JSON.stringify({ ageDeclaration: previewAge }),
      });
      await loadSession();
    } catch (cause) { setError((cause as Error).message); }
    finally { setPreviewAge(emptyAgeDeclaration()); setBusy(false); }
  }
  async function requestQuote() {
    const owner = sessionOwner.current;
    if (!owner || !user || quoteFlight.current || busy || imageUpload.current.pending || !pilotInputAllowed || !prompt.trim() || (mode === "image" && !image)) return;
    const existing = submittedRequests.current.job(payloadKey, "paid", jobsRef.current);
    if (existing && studioJobState(existing).unresolved) return;
    quoteFlight.current = true;
    setQuoting(true);
    setQuote(null);
    setError("");
    const epoch = identityEpoch.current;
    const requestedPayload = payloadKey;
    const imageRevision = imageUpload.current.revision;
    try {
      // A terminal task found in server history acknowledges the original
      // request even if its submission response was lost.
      if (existing) clearPendingRequest(owner, existing.id);
      const savedId = existing ? undefined : submittedRequests.current.id(payloadKey, "paid");
      const requestId = billing?.generationPilot?.requestId ?? savedId ?? await generationRequestId(owner, generationPayload, "paid");
      if (epoch !== identityEpoch.current || requestedPayload !== currentPayloadKey.current || imageRevision !== imageUpload.current.revision) return;
      const result: GenerationQuote = await api("/jobs/quote", {
        method: "POST", headers: { "X-KakaReel-Owner": owner },
        body: JSON.stringify({ ...generationPayload, requestId }),
      });
      if (epoch !== identityEpoch.current || requestedPayload !== currentPayloadKey.current || imageRevision !== imageUpload.current.revision) return;
      setNow(Date.now());
      setQuote({ ...result, payloadKey: requestedPayload, requestId });
      await refreshBilling();
    } catch (cause) {
      if (epoch === identityEpoch.current) {
        if (cause instanceof DamagedPendingRequest) setDamagedPending(cause);
        setError((cause as Error).message);
      }
    } finally {
      if (epoch === identityEpoch.current) { quoteFlight.current = false; setQuoting(false); }
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const owner = sessionOwner.current;
    if (busy || imageUpload.current.pending || generationFlight.current || !owner) return;
    const existing = submittedRequests.current.job(payloadKey, billingMode, jobsRef.current);
    if (existing && studioJobState(existing).unresolved) return;
    if (billingMode === "paid" && (!paidReady || !usableGenerationQuote(currentQuote))) {
      setError(insufficientCredits ? "Insufficient available credits. Add credits before submitting this generation." : "Review a current quote before using paid credits.");
      return;
    }
    if (billingMode === "preview" && !canGenerate) return;
    generationFlight.current = true;
    setSubmitting(true);
    setBusy(true);
    setError("");
    const epoch = identityEpoch.current;
    // Persist a stable id before the network call. Reusing identical input after a
    // network interruption cannot accidentally create and bill a second video.
    const body = { ...generationPayload, billingMode };
    try {
      // A known terminal task permits a new generation. An interrupted submit
      // must reuse its ID, including after editing away from these inputs.
      if (existing) clearPendingRequest(owner, existing.id);
      const savedId = existing ? undefined : submittedRequests.current.id(payloadKey, billingMode);
      const requestId = (billingMode === "paid" && billing?.generationPilot ? currentQuote!.requestId : savedId) ?? (billingMode === "paid" ? currentQuote!.requestId
        : await generationRequestId(owner, generationPayload, "preview"));
      if (epoch !== identityEpoch.current) return;
      // History may already contain the saved request after a refresh/reload.
      const savedJob = jobsRef.current.find((job) => job.id === requestId);
      submittedRequests.current.remember(payloadKey, billingMode, requestId);
      setLastSubmitted(requestId);
      if (savedJob && studioJobState(savedJob).unresolved) return;
      const d = await api("/jobs", {
        method: "POST",
        headers: { "X-KakaReel-Owner": owner },
        body: JSON.stringify({ ...body, requestId, ...(billingMode === "paid" ? { quoteId: currentQuote!.quoteId } : {}) }),
      });
      if (epoch !== identityEpoch.current) return;
      update(d.job);
      setSubmitting(false);
      setSelected(d.job.id);
      setTab("preview");
      clearPendingRequest(owner, requestId);
      setQuote(null);
      if (user) await refreshBilling();
    } catch (e) {
      if (epoch !== identityEpoch.current) return;
      if (e instanceof DamagedPendingRequest) setDamagedPending(e);
      setError((e as Error).message);
      try {
        await refresh();
      } catch {
        /* Keep the original error. */
      }
    } finally {
      if (epoch === identityEpoch.current) { generationFlight.current = false; setSubmitting(false); setBusy(false); }
    }
  }
  return (
    <div className="studio-layout">
      <aside className="studio-sidebar">
        <HomeLink className="brand">
          <Image src="/brand/kakapo-logo.png" width={34} height={34} alt="" />{" "}
          <span>KakaReel</span>
        </HomeLink>
        <span className="eyebrow">WORKSPACE</span>
        <button
          className={`side-nav${tab === "preview" ? " active" : ""}`}
          onClick={() => setTab("preview")}
        >
          <Sparkles size={18} />
          Video studio
        </button>
        <button
          className={`side-nav${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          <Clock size={18} />
          My videos<span>{jobs.length}</span>
        </button>
        <a className="side-nav" href="/pricing#access-options" title="Pricing" aria-label="Pricing">
          <CreditCard size={18} />Pricing
        </a>
        <Link className="side-nav" href="/account" title="Account" aria-label="Account">
          <UserRound size={18} />Account
        </Link>
        <div className="side-bottom">
          <span className="preview-tag">
            <i /> EARLY PREVIEW
          </span>
          <p>
            One idea.
            <br />A world of possibilities.
          </p>
          <Link href="/build">
            Follow the build <ArrowUpRight size={15} />
          </Link>
          <a href="https://github.com/Glowin/last-mile-ai-video">
            Source on GitHub ↗
          </a>
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-header">
          <div className="studio-header-crumb">
            <span>
              Workspace <span className="crumb">/</span>{" "}
              <b>{tab === "history" ? "My videos" : "Video studio"}</b>
            </span>
            <span className="studio-spec-pill">
              {f.name} · {resolution} · {duration}s · {ratio === "adaptive" ? "Adaptive" : ratio}
            </span>
          </div>
          <div>
            {!checked && <span className="micro" role="status">Checking your session…</span>}
            {checked && !user && (
              <>
                <span className="preview-tag">INVITE PREVIEW</span>
                <a className="button small secondary" href="#google-sign-in">
                  Sign in with Google
                </a>
              </>
            )}
            {user && (
              <Link
                className="studio-account-link"
                href="/account"
                title={user.email}
                aria-label={`Account: ${user.email}`}
              >
                {user.email}
              </Link>
            )}
            {authenticated && (
              <button
                className="icon-button"
                aria-label={user ? "Sign out" : "End preview session"}
                disabled={busy}
                onClick={async () => {
                  if (
                    !user &&
                    !confirm(
                      "Ending this guest session removes access to its video history. Sign in with Google first to keep it. Continue?",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api("/session", { method: "DELETE", headers: sessionOwner.current ? { "X-KakaReel-Owner": sessionOwner.current } : {} });
                    window.google?.accounts.id.disableAutoSelect();
                    clearIdentity();
                    setChecked(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </header>
        <main id="main" className="studio-content">
          <div className="studio-title">
            <div>
              <span className="eyebrow">YOUR IDEAS, IN MOTION</span>
              <h1>Make your next scene.</h1>
            </div>
            <span className="muted">Text. Image. Possibility.</span>
          </div>
          <div className="workspace">
            <section className="controls-panel" aria-labelledby="video-settings-heading">
              <h2 id="video-settings-heading" className="field-label panel-heading">
                Video settings
              </h2>
              <div className="mode-tabs">
                <button
                  className={mode === "text" ? "selected" : ""}
                  onClick={() => changeMode("text")}
                >
                  <Type size={16} />
                  Text to video
                </button>
                <button
                  className={mode === "image" ? "selected" : ""}
                  onClick={() => changeMode("image")}
                >
                  <ImageIcon size={16} />
                  Image to video
                </button>
              </div>
              <form onSubmit={generate}>
                <label className="field-label" htmlFor="billing-mode">Generation access</label>
                <select id="billing-mode" value={billingMode} disabled={busy} onChange={(event) => {
                  setBillingMode(event.target.value as "preview" | "paid");
                  setQuote(null);
                  setError("");
                }}>
                  <option value="preview">Preview · invitation allowance</option>
                  <option value="paid" disabled={!paidEnabled}>Paid · purchased credits{paidEnabled ? "" : " · unavailable"}</option>
                </select>
                <p className="micro">{billingMode === "preview" ? "Preview uses the invitation allowance, not your purchased credits." : "Paid mode uses your purchased credits. Review the quote, then submit explicitly."}</p>
                {!paidEnabled && <p className="micro">Paid generation is not yet available for this account. <a href="/pricing#access-options">View the published offer</a>.</p>}
                {billing?.generationPilot && <p className="micro" role="status">
                  Private paid trial · One MiniMax image-to-video · 6 seconds · 2K · 23 credits.
                  {billing.generationPilot.available ? <> Submit before <time dateTime={billing.generationPilot.expiresAt}>{new Date(billing.generationPilot.expiresAt).toLocaleString()}</time>. Select MiniMax, Image to video and 6 seconds; audio uses model defaults.</> : <> Your trial task is already recorded. Check My videos to follow it.</>}
                </p>}
                {billing && <p className="micro">{billing.availableCredits} available credits · {billing.reservedCredits} reserved{billing.blocked ? " · Spending blocked" : ""}</p>}
                {billingError && <p className="micro" role="status">Credit balance unavailable. <button type="button" className="text-link" onClick={() => void refreshBilling()}>Check again</button></p>}

                <label className="field-label" htmlFor="model">
                  Model<span>01</span>
                </label>
                <select
                  id="model"
                  value={family}
                  onChange={(e) => changeModel(e.target.value as FamilySlug)}
                >
                  {families.map((x) => (
                    <option key={x.slug} value={x.slug}>
                      {x.name} · {x.maker}
                    </option>
                  ))}
                </select>
                {mode === "image" && (
                  <div className="upload-wrap">
                    <label className="field-label" htmlFor="source-image">
                      First frame
                    </label>
                    <label className="upload-zone" htmlFor="source-image">
                      {image ? (
                        <img src={image} alt="Your uploaded first frame" />
                      ) : (
                        <>
                          <Upload size={23} />
                          <b>Choose your starting image</b>
                          <span>JPEG or PNG · Up to 3 MiB · Prepared locally before upload</span>
                        </>
                      )}
                      <input
                        id="source-image"
                        type="file"
                        accept="image/jpeg,image/png"
                        disabled={busy}
                        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }}
                      />
                    </label>
                    {preparingImage && <p className="micro" role="status">Preparing your image… You can choose a different file.</p>}
                    {imageDetails && <p className="micro" role="status">
                      {imageDetails.optimized ? "Optimized locally" : "Ready to upload"} · {imageDetails.width}×{imageDetails.height} · {Math.ceil(imageDetails.bytes / 1024)} KiB
                      {imageDetails.optimized && <> (from {Math.ceil(imageDetails.originalBytes / 1024)} KiB; transparency flattened onto white)</>}. Preview shows the exact image that will be submitted.
                    </p>}
                    {image && (
                      <div className="image-name">
                        <span>{imageName}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove image"
                          disabled={busy}
                          onClick={clearImage}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <label className="field-label" htmlFor="prompt">
                  Your prompt<span>02</span>
                </label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={f.maxPrompt}
                  required
                  rows={6}
                  placeholder={
                    mode === "image"
                      ? "How should this image move? Describe the action and camera movement…"
                      : "A quiet street after the rain. Neon reflections ripple in a puddle as the camera slowly moves forward…"
                  }
                />
                <div className="prompt-helper">
                  <span>Subject + motion + camera + mood</span>
                  <span>
                    {prompt.length}/{f.maxPrompt}
                  </span>
                </div>
                <h3 className="field-label panel-heading-sub">
                  Output settings<span>03</span>
                </h3>
                <div className="settings-grid">
                  <label>
                    Duration
                    <select
                      aria-label="Duration"
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      {f.durations.map((n) => (
                        <option value={n} key={n}>
                          {n} seconds
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Resolution
                    <select
                      aria-label="Resolution"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    >
                      {resolutions(family, mode).map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="ratio-label">
                  Aspect ratio
                  <select
                    aria-label="Aspect ratio"
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                  >
                    {ratios(family, mode).map((x) => (
                      <option key={x} value={x}>
                        {x === "adaptive" ? "Match input image" : x}
                      </option>
                    ))}
                  </select>
                </label>
                {family !== "minimax" ? (
                  <label className="audio-toggle">
                    <input
                      type="checkbox"
                      checked={audio}
                      onChange={(e) => setAudio(e.target.checked)}
                    />
                    <span>Generate audio</span>
                    <span className="muted">Optional</span>
                  </label>
                ) : (
                  <p className="micro">
                    MiniMax H3 handles audio through its model defaults.
                  </p>
                )}
                {billingMode === "paid" && <div className="access-panel" aria-live="polite">
                  <b>Review credit cost</b>
                  <p>{estimatedCredits === null ? "Paid pricing is not verified for these settings." : `Published rate: ${estimatedCredits} credits. Request a quote for your exact inputs.`}</p>
                  {currentQuote && <p>{currentQuote.available
                    ? `${currentQuote.credits} credits · ${usableGenerationQuote(currentQuote, now) ? `Quote expires at ${new Date(currentQuote.expiresAt).toLocaleTimeString("en-US")}` : "Quote expired. Request a new quote."}`
                    : quoteReason[currentQuote.reason ?? ""] || "A paid quote is not available for these settings."}</p>}
                  {insufficientCredits && <p role="alert">Insufficient available credits. This generation needs {currentQuote?.credits ?? estimatedCredits} credits; you have {billing?.availableCredits}. A Starter Pack contains 150 credits. <Link href="/account">View your balance and packs</Link>.</p>}
                  <button type="button" className="button secondary small" disabled={!paidEnabled || !pilotInputAllowed || preparingImage || busy || quoting || duplicatePending || estimatedCredits === null || !prompt.trim() || (mode === "image" && !image)} onClick={() => void requestQuote()}>{quoting ? "Checking quote…" : "Get current quote"}</button>
                  <p className="micro">Quotes last five minutes. Credits are reserved during generation. Unknown outcomes remain pending; no automatic retry. Download completed videos promptly: storage is not permanent.</p>
                </div>}
                {error && (
                  <p role="alert" className="error-message">
                    {error}
                  </p>
                )}
                {damagedPending && (
                  <button type="button" className="button secondary" disabled={busy}
                    onClick={() => {
                      if (!confirm("Check My videos first and recover any existing task. Resetting this saved request allows a NEW generation and may charge again. Reset without submitting?")) return;
                      resetDamagedPendingRequest(damagedPending);
                      setDamagedPending(null);
                      setError("Saved request reset. No video was submitted. Review your history before generating again.");
                    }}>
                    Reset saved request…
                  </button>
                )}
                <button
                  className="button generate-button"
                  type="submit"
                  aria-describedby="generation-status"
                  aria-busy={buttonSpinning}
                  disabled={
                    busy ||
                    preparingImage ||
                    duplicatePending ||
                    (billingMode === "paid" ? !paidReady : !canGenerate) ||
                    !ready ||
                    !prompt.trim() ||
                    (mode === "image" && !image)
                  }
                >
                  {buttonSpinning ? <LoaderCircle size={18} className="studio-spinner" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                  {submitting ? "Submitting…" : duplicatePending ? studioJobState(matchingJob!).label : busy ? "Working…" : billingMode === "paid" ? `Generate · ${currentQuote?.credits ?? estimatedCredits ?? "—"} credits` : "Generate preview video"}
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
                <div className="generation-feedback">
                  <p id="generation-status" className="micro" role="status" aria-live="polite" aria-atomic="true">
                    {submitting
                      ? "Submitting your request. Progress will appear in the results panel; you can stay here."
                      : progressJob && progressState
                        ? `${progressState.label}. ${studioJobDescription(progressJob)}${duplicatePending ? " These inputs already have an unresolved task. You can edit the inputs for a different video." : ""}${pollError ? " Automatic status checks are paused. Refresh history to check again." : ""}`
                        : !checked ? "Checking your session…" : "Your progress and video will appear in the results panel after you submit."}
                  </p>
                  {progressJob && !submitting && <button type="button" className="button secondary small" aria-controls="studio-results" onClick={viewProgress}>View progress <ArrowUpRight size={16} aria-hidden="true" /></button>}
                </div>
                <p className="micro centered">
                  {billingMode === "preview" ? "Uses the limited preview allowance. No purchased credits spent." : "Submitting reserves the quoted credits. Check pending tasks before starting another generation."}
                </p>
                <p className="micro">When the unattended MVP is enabled for a new task, your prompt is sent to Waffo Pancake for an automated text check. Reference images and generated videos are not individually human-reviewed or automatically moderated in this MVP. Passing the text check does not approve the images or video; delivery checks are technical, not content safety checks. Legacy tasks keep their recorded review process. <a href="/acceptable-use">Content rules</a> · <a href="/privacy">Data handling</a> · <a href="/support">Get help</a></p>
              </form>
              {checked && !user && (
                <div id="google-sign-in">
                  <GoogleSignIn />
                </div>
              )}
              {user && (
                <div className="access-panel">
                  <b>Signed in{user.name ? ` as ${user.name}` : ""}</b>
                  <p>
                    {canGenerate
                      ? "Your preview access and video history are saved to this account."
                      : "Your account is ready. Enter a preview code to unlock generation."}
                  </p>
                </div>
              )}
              {authenticated && !ageConfirmed && <form className="access-panel" onSubmit={confirmExistingAge}>
                <b>Confirm your age before generating</b>
                <p>Your session and existing videos remain available.</p>
                <AgeDeclarationFields value={previewAge} onChange={setPreviewAge} disabled={busy} />
                <button className="button small" disabled={busy || !previewAge.birthDate || !previewAge.confirmed}>Confirm age</button>
              </form>}
              {checked && !canGenerate && (!authenticated || ageConfirmed) && (
                <form className="access-panel" onSubmit={login}>
                  <div>
                    <LockKeyhole size={17} />
                    <b>Have a preview code?</b>
                  </div>
                  <p>
                    {checked && !ready
                      ? "Generation is being connected. You can explore the studio while setup is completed."
                      : user
                        ? "Redeem your code to enable generation for this account."
                        : "Enter it once to unlock generation in this browser."}
                  </p>
                  <label className="sr-only" htmlFor="preview-code">
                    Preview code
                  </label>
                  {!ageConfirmed && <AgeDeclarationFields value={previewAge} onChange={setPreviewAge} disabled={busy} />}
                  <div className="access-row">
                    <input
                      id="preview-code"
                      type="password"
                      autoComplete="off"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Preview code"
                      required
                    />
                    <button className="button small" disabled={busy || !ready}>
                      Unlock
                    </button>
                  </div>
                </form>
              )}
            </section>
            <section id="studio-results" ref={resultsPanel} className="results-panel" aria-label="Video results" tabIndex={-1}>
              <div className="result-tabs">
                <div>
                  <button
                    className={tab === "preview" ? "selected" : ""}
                    onClick={() => setTab("preview")}
                  >
                    Preview
                  </button>
                  <button
                    className={tab === "history" ? "selected" : ""}
                    onClick={() => setTab("history")}
                  >
                    My videos <span>{jobs.length}</span>
                  </button>
                </div>
                {authenticated && (
                  <button
                    className="icon-button"
                    aria-label={refreshing || historyState === "loading" ? "Refreshing history" : "Refresh history"}
                    aria-busy={refreshing || historyState === "loading"}
                    disabled={refreshing || historyState === "loading"}
                    onClick={() => void refreshHistory()}
                  >
                    <RefreshCw size={16} className={refreshing || historyState === "loading" ? "studio-spinner" : undefined} aria-hidden="true" />
                  </button>
                )}
              </div>
              {pollError && (
                <p className="error-message" role="alert">
                  {pollError}
                </p>
              )}
              {resultError && <p className="error-message" role="alert">{resultError}</p>}
              {historyState === "loading" && jobs.length > 0 && <p className="micro" role="status">Refreshing your videos… Your last known tasks are still shown.</p>}
              {historyState === "loaded" && authenticated && <p className="micro" role="status">Video history loaded.</p>}
              {historyState === "error" && jobs.length > 0 && <p className="error-message" role="alert">Couldn’t update your videos. Your last known tasks are still shown. {historyError}</p>}
              {tab === "history" ? (
                <div className="history-list">
                  {jobs.length ? (
                    jobs.map((j) => (
                      <button
                        className="history-item"
                        key={j.id}
                        onClick={() => {
                          setSelected(j.id);
                          setTab("preview");
                        }}
                      >
                        <span className={`status-dot status-${studioJobState(j).phase === "failed" ? "failed" : studioJobState(j).phase === "success" ? "success" : "pending"}`} />
                        <div>
                          <b>{j.prompt}</b>
                          <span>
                            {getFamily(j.family)?.name} · {j.duration}s ·{" "}
                            {new Date(j.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <span>{studioJobState(j).label}</span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))
                  ) : historyView === "loading" || historyView === "error" ? (
                    <div className="empty-state" role={historyView === "error" ? "alert" : "status"}>
                      <h2>{historyView === "error" ? "Your videos could not be loaded." : "Loading your videos…"}</h2>
                      {historyView === "error" && <><p>{historyError}</p><button type="button" className="button secondary small" disabled={refreshing} onClick={() => void refreshHistory()}>Try loading again</button></>}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Clock size={34} />
                      <h2>Your ideas will live here.</h2>
                      <p>
                        Generated videos appear here after you submit your first
                        task.
                      </p>
                    </div>
                  )}
                </div>
              ) : focused ? (
                <div className="focused-job">
                  <div className="video-stage">
                    {studioJobState(focused).phase === "success" && focused.resultUrl ? (
                      <video
                        key={`${mediaKey}:${mediaRetry}`}
                        controls
                        preload="metadata"
                        src={focused.resultUrl}
                        aria-label="Generated video"
                        onError={() => setMediaFailure(mediaKey)}
                        onLoadedData={() => setMediaFailure((current) => current === mediaKey ? undefined : current)}
                      />
                    ) : (
                      <div className="empty-state">
                        <div
                          className={`empty-icon ${studioJobState(focused).active ? "working" : ""}`}
                        >
                          <Film size={32} />
                        </div>
                        <h2>{studioJobState(focused).label}</h2>
                        <p>{studioJobDescription(focused)}</p>
                        <p>{studioHistoryHint(checked, !!user)}</p>
                        {studioJobState(focused).phase === "unknown" && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            aria-busy={recovering}
                            onClick={() => void recoverJob(focused)}
                          >
                            {recovering ? "Checking task…" : "Recover this task"} <RefreshCw size={16} className={recovering ? "studio-spinner" : undefined} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {studioJobState(focused).phase === "success" && mediaFailure === mediaKey && focused.resultUrl && <div className="media-feedback" role="alert">
                    <p>This video could not be loaded. The generation is still complete. Reload the video or open its original link; neither action creates a new generation. The link may have expired.</p>
                    <div>
                      <button type="button" className="button secondary small" onClick={() => { setMediaFailure(undefined); setMediaRetry((value) => value + 1); }}>Reload video</button>
                      <a className="button secondary small" href={focused.resultUrl} target="_blank" rel="noreferrer">Open original video</a>
                      <a href="/support">Contact support</a>
                    </div>
                  </div>}
                  <div className="job-details">
                    <div className="job-heading">
                      <span className="preview-tag">
                        {getFamily(focused.family)?.name} · {focused.duration}s
                        · {focused.resolution}
                      </span>
                      {studioJobState(focused).phase === "success" && focused.resultUrl && (
                        <a
                          className="button small"
                          href={focused.resultUrl}
                          target="_blank"
                          rel="noreferrer"
                          download
                        >
                          <Download size={16} />
                          Open / download
                        </a>
                      )}
                    </div>
                    <p>{focused.prompt}</p>
                    {focused.billingMode && <p className="micro">
                      {focused.billingMode === "paid" ? `Paid generation · ${focused.credits ?? "—"} credits` : "Preview generation"}
                      {focused.creditState && <> · {creditStateLabel[focused.creditState]}</>}
                    </p>}
                    {focused.safety && <p className="micro">{studioJobSafetyDisclosure(focused)} <a href="/acceptable-use">Content rules</a> · <a href="/support">Report content or get help</a>.</p>}
                    {!focused.safety && focused.reviewRequired && <p className="micro" role="status">Legacy review may take time. <a href="/support">Contact support or appeal a decision</a>.</p>}
                    <p className="micro">Task ID: <code>{focused.id}</code></p>
                    <small>
                      Save completed videos promptly. Provider links may expire; permanent storage is not included.
                      {" "}{studioHistoryHint(checked, !!user)}
                    </small>
                  </div>
                </div>
              ) : historyView === "loading" || historyView === "error" ? (
                <div className="empty-preview">
                  <div className="empty-state" role={historyView === "error" ? "alert" : "status"}>
                    <h2>{historyView === "error" ? "Your videos could not be loaded." : "Loading your videos…"}</h2>
                    {historyView === "error" && <><p>{historyError}</p><button type="button" className="button secondary small" disabled={refreshing} onClick={() => void refreshHistory()}>Try loading again</button></>}
                  </div>
                </div>
              ) : (
                <div className="empty-preview">
                  <div className="preview-corners">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Film size={34} />
                    </div>
                    <span className="eyebrow">
                      A LITTLE IMAGINATION GOES A LONG WAY
                    </span>
                    <h2>
                      Your next scene
                      <br />
                      starts here.
                    </h2>
                    <p>
                      Write a prompt on the left.
                      <br />
                      We'll save a place for the result.
                    </p>
                    <div className="empty-pills">
                      <span>
                        <Check size={13} />
                        Three model families
                      </span>
                      <span>
                        <Check size={13} />
                        One workflow
                      </span>
                    </div>
                  </div>
                  <span className="empty-bottom">NO VIDEO GENERATED YET</span>
                </div>
              )}
              <div className="studio-tip">
                <Sparkles size={18} />
                <p>
                  <b>A small tip for a better first take.</b> Focus on one
                  subject and one movement. Add camera direction and lighting to
                  guide the scene.
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
