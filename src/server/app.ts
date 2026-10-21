import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { database } from "./db";
import { jobs } from "./schema";
import { configured } from "./auth";
import {
  identity,
  hasAccountCookies,
  lockGuest,
  type Identity,
} from "./account";
import { authRoutes } from "./auth-routes";
import { accountRoutes } from "./account-routes";
import { billingRoutes, billingWebhookRoutes, isBillingWebhookRequest } from "./billing/routes";
import { generationSchema, providerPayload } from "./input";
import { providerRequest, ProviderError, type ProviderTask } from "./provider";
import { families } from "../lib/models";

export const app = new Hono<{
  Variables: { owner: string; identity: Identity };
}>().basePath("/api");
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
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      !isBillingWebhookRequest(c.req.method, c.req.path)) {
    const expected = process.env.APP_URL;
    if (
      !expected ||
      c.req.header("origin") !== new URL(expected).origin ||
      c.req.header("sec-fetch-site") === "cross-site"
    )
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
app.route("/", authRoutes);
app.route("/", accountRoutes);
// Signed provider callbacks have their own exact-path authentication boundary.
app.route("/billing/webhooks", billingWebhookRoutes);
app.route("/billing", billingRoutes);
app.get("/models", (c) => c.json({ models: families, ready: configured() }));
const requireIdentity: import("hono").MiddlewareHandler<{
  Variables: { owner: string; identity: Identity };
}> = async (c, next) => {
  const who = await identity(c);
  if (!who)
    return c.json(
      {
        error: "Sign in or enter your preview code to continue.",
        ...(hasAccountCookies(c) ? { code: "SESSION_EXPIRED" } : {}),
      },
      401,
    );
  // A tab can still display account A after another tab changed browser cookies.
  // Bind paid actions to the identity shown when the user initiated the action.
  const expectedOwner = c.req.header("X-KakaReel-Owner");
  if (c.req.method !== "GET" && expectedOwner && expectedOwner !== who.owner)
    return c.json(
      { error: "Your account changed. Refresh before generating or recovering a video." },
      409,
    );
  if (c.req.method !== "GET" && !who.canGenerate)
    return c.json(
      { error: "Redeem a preview code before generating videos." },
      403,
    );
  c.set("owner", who.owner);
  c.set("identity", who);
  await next();
};
app.use("/jobs", requireIdentity);
app.use("/jobs/*", requireIdentity);

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
    if (!c.get("identity").user && !(await lockGuest(tx, c.get("owner"))))
      return {
        error: "This guest session has ended. Sign in again.",
        status: 401 as const,
      };
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
  const id = c.req.param("id");
  if (!uuidPattern.test(id)) return c.json({ error: "Video not found." }, 404);
  const result = await database().transaction(async (tx) => {
    if (!c.get("identity").user && !(await lockGuest(tx, c.get("owner"))))
      return null;
    const [j] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.owner, c.get("owner"))));
    if (!j) return null;
    if (j.status !== "unknown") return { job: j, claimed: false };
    const [claimed] = await tx
      .update(jobs)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, j.id),
          eq(jobs.owner, c.get("owner")),
          eq(jobs.status, "unknown"),
        ),
      )
      .returning();
    return { job: claimed ?? j, claimed: !!claimed };
  });
  if (!result) return c.json({ error: "Video not found." }, 404);
  return c.json({
    job: publicJob(result.claimed ? await submit(result.job) : result.job),
  });
});
