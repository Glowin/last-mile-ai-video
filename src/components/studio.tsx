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

async function api(path: string, options: RequestInit = {}) {
  const r = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed. Please try again.");
  return data;
}
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
  const [jobs, setJobs] = useState<PublicJob[]>([]),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"preview" | "history">("preview");
  const [pollError, setPollError] = useState("");
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
  async function refresh() {
    const d = await api("/jobs");
    setJobs(d.jobs);
  }
  useEffect(() => {
    let live = true;
    api("/session")
      .then(async (s) => {
        if (!live) return;
        setAuthenticated(s.authenticated);
        setReady(s.ready);
        setChecked(true);
        if (s.authenticated) {
          const d = await api("/jobs");
          if (live) setJobs(d.jobs);
        }
      })
      .catch(() => {
        if (live) {
          setChecked(true);
          setError(
            "The studio could not connect. Refresh the page to try again.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!authenticated || pollError) return;
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
          if (active) update(d.job);
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
  }, [authenticated, pollError]);
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
      setAuthenticated(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
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
      let requestId = crypto.randomUUID();
      const old = JSON.parse(localStorage.getItem("lm_pending") ?? "null");
      if (old?.digest === digest && typeof old?.requestId === "string")
        requestId = old.requestId;
      localStorage.setItem("lm_pending", JSON.stringify({ digest, requestId }));
      const d = await api("/jobs", {
        method: "POST",
        body: JSON.stringify({ ...body, requestId }),
      });
      update(d.job);
      setSelected(d.job.id);
      setTab("preview");
      localStorage.removeItem("lm_pending");
    } catch (e) {
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
            <span className="preview-tag">INVITE PREVIEW</span>
            {authenticated && (
              <button
                className="icon-button"
                aria-label="End preview session"
                onClick={async () => {
                  if (
                    confirm(
                      "Ending this browser session removes access to its video history. Save your videos first. Continue?",
                    )
                  ) {
                    await api("/session", { method: "DELETE" });
                    setAuthenticated(false);
                    setJobs([]);
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
            <section className="controls-panel" aria-label="Video settings">
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
                <label className="field-label">
                  Output settings<span>03</span>
                </label>
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
                <button
                  className="button generate-button"
                  type="submit"
                  disabled={
                    busy ||
                    !authenticated ||
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
              {!authenticated && (
                <form className="access-panel" onSubmit={login}>
                  <div>
                    <LockKeyhole size={17} />
                    <b>Have a preview code?</b>
                  </div>
                  <p>
                    {checked && !ready
                      ? "Generation is being connected. You can explore the studio while setup is completed."
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
                              : "Your idea is with the model. This may take a few minutes. You can safely leave this tab and return in the same browser."}
                        </p>
                        {focused.status === "unknown" && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                const d = await api(
                                  `/jobs/${focused.id}/recover`,
                                  { method: "POST" },
                                );
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
                      History belongs to this browser session.
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
