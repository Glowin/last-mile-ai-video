"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  type PublicJob,
} from "@/lib/models";

import { api, SESSION_ENDED, IDENTITY_CHANGED_KEY, IDENTITY_CHANGED_EVENT } from "@/lib/api";
import {
  pendingRequestId, clearPendingRequest, adoptLegacyPendingRequest,
  DamagedPendingRequest, resetDamagedPendingRequest,
} from "@/lib/pending-request";
import { GoogleSignIn } from "./google-sign-in";

const statusLabel: Record<string, string> = {
  submitting: "Submitting",
  pending: "Generating",
  unknown: "Connection interrupted",
  success: "Ready",
  failed: "Generation failed",
};
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
  const [authenticated, setAuthenticated] = useState(false),
    [ready, setReady] = useState(false),
    [checked, setChecked] = useState(false),
    [code, setCode] = useState("");
  const [user, setUser] = useState<{
    id: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const identityEpoch = useRef(0);
  const sessionOwner = useRef<string | null>(null);
  const [jobs, setJobs] = useState<PublicJob[]>([]),
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
  const focused = jobs.find((j) => j.id === selected) ?? jobs[0];
  function update(j: PublicJob) {
    setJobs((old) =>
      [j, ...old.filter((x) => x.id !== j.id)].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }
  function clearIdentity() {
    identityEpoch.current++;
    sessionOwner.current = null;
    setAuthenticated(false);
    setUser(null);
    setCanGenerate(false);
    setJobs([]);
    setSelected(undefined);
    setPollError("");
    setDamagedPending(null);
  }
  async function refresh() {
    const epoch = identityEpoch.current;
    const d = await api("/jobs");
    if (epoch === identityEpoch.current) setJobs(d.jobs);
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
    setCanGenerate(s.canGenerate);
    setReady(s.ready);
    setChecked(true);
    if (s.authenticated) await refresh();
    else setJobs([]);
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
      setError("Your session has ended. Please sign in again.");
    };
    const changed = (e: StorageEvent) => {
      if (e.key === IDENTITY_CHANGED_KEY) {
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
        .filter((j) => ["pending", "submitting", "unknown"].includes(j.status))
        .slice(0, 3);
      if (!pending.length) return;
      running = true;
      try {
        for (const j of pending) {
          const d = await api(`/jobs/${j.id}`);
          if (active && epoch === identityEpoch.current) update(d.job);
        }
        failures = 0;
        if (active) setPollError("");
      } catch {
        failures++;
        if (active && failures >= 3)
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
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    ) {
      setError("Choose a JPEG or PNG image up to 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setImageName(file.name);
    };
    reader.onerror = () => setError("This image could not be read.");
    reader.readAsDataURL(file);
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/session", { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      await loadSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const owner = sessionOwner.current;
    if (busy || !owner) return;
    setBusy(true);
    setError("");
    const epoch = identityEpoch.current;
    // Persist a stable id before the network call. Reusing identical input after a
    // network interruption cannot accidentally create and bill a second video.
    const body = {
      family,
      mode,
      prompt,
      duration,
      resolution,
      ratio,
      audio,
      ...(mode === "image" ? { image } : {}),
    };
    try {
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(body)),
          ),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      if (epoch !== identityEpoch.current) return;
      const requestId = pendingRequestId(owner, digest);
      const d = await api("/jobs", {
        method: "POST",
        headers: { "X-KakaReel-Owner": owner },
        body: JSON.stringify({ ...body, requestId }),
      });
      if (epoch !== identityEpoch.current) return;
      update(d.job);
      setSelected(d.job.id);
      setTab("preview");
      clearPendingRequest(owner, requestId);
    } catch (e) {
      if (e instanceof DamagedPendingRequest) setDamagedPending(e);
      setError((e as Error).message);
      try {
        await refresh();
      } catch {
        /* Keep the original error. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="studio-layout">
      <aside className="studio-sidebar">
        <Link className="brand" href="/">
          <Image src="/brand/kakapo-logo.png" width={34} height={34} alt="" />{" "}
          <span>KakaReel</span>
        </Link>
        <span className="eyebrow">WORKSPACE</span>
        <button className="side-nav active" onClick={() => setTab("preview")}>
          <Sparkles size={18} />
          Video studio
        </button>
        <button className="side-nav" onClick={() => setTab("history")}>
          <Clock size={18} />
          My videos<span>{jobs.length}</span>
        </button>
        <Link className="side-nav" href="/pricing" title="Pricing" aria-label="Pricing">
          <CreditCard size={18} />Pricing
        </Link>
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
          <span>
            Workspace <span className="crumb">/</span> <b>Video studio</b>
          </span>
          <div>
            {!user && (
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
              <h2 id="video-settings-heading" className="field-label" style={{ marginTop: 0, letterSpacing: 0, lineHeight: "normal" }}>
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
                          <span>JPEG or PNG · Up to 3 MB</span>
                        </>
                      )}
                      <input
                        id="source-image"
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={(e) => upload(e.target.files?.[0])}
                      />
                    </label>
                    {image && (
                      <div className="image-name">
                        <span>{imageName}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove image"
                          onClick={() => {
                            setImage(undefined);
                            setImageName("");
                          }}
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
                <h3 className="field-label" style={{ letterSpacing: 0 }}>
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
                  disabled={
                    busy ||
                    !canGenerate ||
                    !ready ||
                    !prompt.trim() ||
                    (mode === "image" && !image)
                  }
                >
                  <Sparkles size={18} />
                  {busy ? "Working…" : "Generate video"}
                  <ArrowUpRight size={18} />
                </button>
                <p className="micro centered">
                  Uses the limited project demo allowance. No checkout.
                </p>
              </form>
              {!user && (
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
              {!canGenerate && (
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
            <section className="results-panel" aria-label="Video results">
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
                    aria-label="Refresh history"
                    onClick={async () => {
                      setPollError("");
                      try {
                        await refresh();
                      } catch (e) {
                        setPollError((e as Error).message);
                      }
                    }}
                  >
                    <RefreshCw size={16} />
                  </button>
                )}
              </div>
              {pollError && (
                <p className="error-message" role="alert">
                  {pollError}
                </p>
              )}
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
                        <span className={`status-dot status-${j.status}`} />
                        <div>
                          <b>{j.prompt}</b>
                          <span>
                            {getFamily(j.family)?.name} · {j.duration}s ·{" "}
                            {new Date(j.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <span>{statusLabel[j.status]}</span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))
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
                    {focused.status === "success" && focused.resultUrl ? (
                      <video
                        controls
                        preload="metadata"
                        src={focused.resultUrl}
                        aria-label="Generated video"
                      />
                    ) : (
                      <div className="empty-state">
                        <div
                          className={`empty-icon ${["pending", "submitting"].includes(focused.status) ? "working" : ""}`}
                        >
                          <Film size={32} />
                        </div>
                        <h2>{statusLabel[focused.status]}</h2>
                        <p>
                          {focused.status === "failed"
                            ? "The provider could not finish this task. You can edit your prompt and create a new generation."
                            : focused.status === "unknown"
                              ? "The request may already be running. Recover it with the same ID to avoid a duplicate generation."
                              : user
                                ? "Your idea is with the model. This may take a few minutes. Sign in to this account to check it later on any device."
                                : "Your idea is with the model. This may take a few minutes. You can safely leave this tab and return in the same browser."}
                        </p>
                        {focused.status === "unknown" && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={async () => {
                              const epoch = identityEpoch.current;
                              const owner = sessionOwner.current;
                              if (!owner) return;
                              setBusy(true);
                              try {
                                const d = await api(
                                  `/jobs/${focused.id}/recover`,
                                  { method: "POST", headers: { "X-KakaReel-Owner": owner } },
                                );
                                if (epoch !== identityEpoch.current) return;
                                update(d.job);
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Recover this task <RefreshCw size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="job-details">
                    <div className="job-heading">
                      <span className="preview-tag">
                        {getFamily(focused.family)?.name} · {focused.duration}s
                        · {focused.resolution}
                      </span>
                      {focused.status === "success" && focused.resultUrl && (
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
                    <small>
                      Save completed videos promptly. Provider links may expire.
                      {user
                        ? " Your video history is saved to your account."
                        : " History belongs to this browser session. Sign in with Google to keep it with your account."}
                    </small>
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
