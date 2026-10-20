import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { database } from "./db";
import { jobs } from "./schema";
import { configured, issueSession, secureEqual, sessionOwner } from "./auth";
import { generationSchema, providerPayload } from "./input";
import { providerRequest, ProviderError, type ProviderTask } from "./provider";
import { families } from "../lib/models";

export const app = new Hono<{ Variables: { owner: string } }>().basePath(
  "/api",
);
app.use(
  "*",
  bodyLimit({
    maxSize: 4_500_000,
    onError: (c) =>
      c.json(
        { error: "Image is too large. Upload a JPEG or PNG up to 3 MB." },
        413,
      ),
  }),
);
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const expected = process.env.APP_URL;
    if (!expected || c.req.header("origin") !== new URL(expected).origin)
      return c.json(
        { error: "Open the app on its configured website to continue." },
        403,
      );
  }
  await next();
});
app.onError((error, c) => {
  console.error("api_failure", error.name);
  return c.json(
    {
      error:
        "The service is temporarily unavailable. Your existing jobs are safe; try refreshing.",
    },
    503,
  );
});
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/session", (c) =>
  c.json({
    authenticated: !!sessionOwner(getCookie(c, "lm_session")),
    ready: configured(),
    mode: "invite-preview",
  }),
);
app.get("/models", (c) => c.json({ models: families, ready: configured() }));
app.post("/session", async (c) => {
  if (!configured())
    return c.json({ error: "Preview access is not configured yet." }, 503);
  const attempts = await database().execute(
    sql`INSERT INTO demo_login_attempts(minute,attempts) VALUES(date_trunc('minute',now()),1) ON CONFLICT(minute) DO UPDATE SET attempts=demo_login_attempts.attempts+1 RETURNING attempts`,
  );
  if (Number(attempts[0]?.attempts) > 30)
    return c.json(
      { error: "Too many access attempts. Please wait one minute." },
      429,
    );
  const input = await c.req.json().catch(() => null);
  if (
    !input ||
    typeof input.code !== "string" ||
    input.code.length > 200 ||
    !secureEqual(input.code, process.env.DEMO_ACCESS_CODE!)
  )
    return c.json({ error: "That preview code did not work." }, 401);
  const old = getCookie(c, "lm_session");
  setCookie(c, "lm_session", sessionOwner(old) ? old! : issueSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return c.json({ ok: true });
});
app.delete("/session", (c) => {
  deleteCookie(c, "lm_session", { path: "/" });
  return c.json({ ok: true });
});
app.use("/jobs", async (c, next) => {
  const owner = sessionOwner(getCookie(c, "lm_session"));
  if (!owner)
    return c.json(
      { error: "Enter your preview code to generate videos." },
      401,
    );
  c.set("owner", owner);
  await next();
});
app.use("/jobs/*", async (c, next) => {
  const owner = sessionOwner(getCookie(c, "lm_session"));
  if (!owner)
    return c.json({ error: "Enter your preview code to continue." }, 401);
  c.set("owner", owner);
  await next();
});

function publicJob(j: typeof jobs.$inferSelect) {
  return {
    id: j.id,
    family: j.family,
    mode: j.mode,
    prompt: j.prompt,
    duration: j.duration,
    resolution: j.resolution,
    status: j.status,
    resultUrl: j.resultUrl,
    createdAt: j.createdAt.toISOString(),
  };
}
async function storeTask(id: string, t: ProviderTask) {
  const [row] = await database()
    .update(jobs)
    .set({
      upstreamId: t.id,
      status: t.status,
      resultUrl: t.status === "success" ? t.data![0].url : null,
      payload: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(jobs.id, id), sql`${jobs.status} NOT IN ('success','failed')`),
    )
    .returning();
  return row;
}
async function submit(j: typeof jobs.$inferSelect) {
  if (!j.payload) return j;
  try {
    const task = await providerRequest("", {
      method: "POST",
      headers: { "Idempotency-Key": j.id },
      body: JSON.stringify(j.payload),
    });
    return (await storeTask(j.id, task)) ?? j;
  } catch (error) {
    // A timeout is not a failed generation: retain its payload and request id for recovery.
    const definitive =
      error instanceof ProviderError &&
      [400, 401, 402, 403, 404, 422].includes(error.status);
    const [updated] = await database()
      .update(jobs)
      .set({
        status: definitive ? "failed" : "unknown",
        ...(definitive ? { payload: null } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(jobs.id, j.id), sql`${jobs.status} IN ('submitting','unknown')`),
      )
      .returning();
    return updated ?? j;
  }
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function owned(id: string, owner: string) {
  if (!uuidPattern.test(id)) return undefined;
  return database().query.jobs.findFirst({
    where: and(eq(jobs.id, id), eq(jobs.owner, owner)),
  });
}
app.get("/jobs", async (c) => {
  const rows = await database()
    .select()
    .from(jobs)
    .where(eq(jobs.owner, c.get("owner")))
    .orderBy(desc(jobs.createdAt))
    .limit(50);
  return c.json({ jobs: rows.map(publicJob) });
});
app.post("/jobs", async (c) => {
  if (!configured())
    return c.json({ error: "Generation is not configured yet." }, 503);
  const parsed = generationSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Check the generation settings.",
      },
      400,
    );
  const x = parsed.data,
    payload = providerPayload(x),
    fingerprint = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
  const rawLimit = Number(process.env.GENERATION_DAILY_LIMIT ?? 10);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 10;
  const reserved = await database().transaction(async (tx) => {
    // Global limit and idempotent reservation are one transaction, including across app replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7421911)`);
    const [prior] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, x.requestId))
      .limit(1);
    if (prior)
      return prior.owner === c.get("owner") && prior.fingerprint === fingerprint
        ? { job: prior, fresh: false }
        : { error: "This request ID is already in use.", status: 409 as const };
    const count = await tx.execute(
      sql`SELECT count(*)::int AS n FROM video_jobs WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    if (Number(count[0]?.n) >= limit)
      return {
        error:
          "Today's preview generation limit has been reached. Please come back tomorrow.",
        status: 429 as const,
      };
    const [row] = await tx
      .insert(jobs)
      .values({
        id: x.requestId,
        owner: c.get("owner"),
        family: x.family,
        mode: x.mode,
        prompt: x.prompt,
        duration: x.duration,
        resolution: x.resolution,
        fingerprint,
        payload,
        status: "submitting",
      })
      .returning();
    return { job: row, fresh: true };
  });
  if ("error" in reserved)
    return c.json({ error: reserved.error }, reserved.status);
  const row = reserved.fresh ? await submit(reserved.job) : reserved.job;
  return c.json({ job: publicJob(row) }, reserved.fresh ? 201 : 200);
});
app.get("/jobs/:id", async (c) => {
  let j = await owned(c.req.param("id"), c.get("owner"));
  if (!j) return c.json({ error: "Video not found." }, 404);
  if (
    !["success", "failed"].includes(j.status) &&
    Date.now() - j.updatedAt.getTime() > 4500
  ) {
    try {
      const path = j.upstreamId
        ? `/${encodeURIComponent(j.upstreamId)}`
        : `?client_request_id=${encodeURIComponent(j.id)}`;
      const task = await providerRequest(path);
      if (j.upstreamId && task.id !== j.upstreamId)
        throw new ProviderError(502);
      j = (await storeTask(j.id, task)) ?? j;
    } catch {
      // Do not turn transient lookup failures into terminal failed jobs.
      if (
        j.status === "submitting" &&
        Date.now() - j.createdAt.getTime() > 60_000
      ) {
        const [row] = await database()
          .update(jobs)
          .set({ status: "unknown", updatedAt: new Date() })
          .where(and(eq(jobs.id, j.id), eq(jobs.status, "submitting")))
          .returning();
        j = row ?? j;
      }
    }
  }
  return c.json({ job: publicJob(j) });
});
app.post("/jobs/:id/recover", async (c) => {
  const j = await owned(c.req.param("id"), c.get("owner"));
  if (!j) return c.json({ error: "Video not found." }, 404);
  if (j.status !== "unknown") return c.json({ job: publicJob(j) });
  const [claimed] = await database()
    .update(jobs)
    .set({ status: "submitting", updatedAt: new Date() })
    .where(and(eq(jobs.id, j.id), eq(jobs.status, "unknown")))
    .returning();
  return c.json({ job: publicJob(claimed ? await submit(claimed) : j) });
});
