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
import { CreditError, lockWallet, reserveCredits } from "./credits/wallet";
import { createQuote, generationFingerprint, useQuote } from "./credits/quotes";
import { productionChargingPolicy, type ChargingPolicy } from "./credits/config";
import { generationPilotAllows, assertPilotCreation, recordPilotCreation } from "./credits/pilot";
import { processJob, pollJob, liveVideoProvider, type VideoProvider } from "./jobs/runner";
import { families } from "../lib/models";
import { publicModeration } from "./moderation/service";
import { GenerationCostError, lockGenerationCostBudget, reserveGenerationCost } from "./costs";

export function createApp(options: { charging?: ChargingPolicy; videoProvider?: VideoProvider } = {}) {
const charging = options.charging ?? productionChargingPolicy;
const videoProvider = options.videoProvider ?? liveVideoProvider;
// Test balances can never reach the real transport, even with an injected charging gate.
if (charging.environment === "test" && videoProvider.kind !== "fake") throw new Error("Test credits require a fake video provider.");
if (options.charging?.enabled && (charging.environment !== "test" || videoProvider.kind !== "fake")) throw new Error("Charging overrides are sandbox-only.");
const app = new Hono<{
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
  if (error instanceof GenerationCostError) return c.json({
    error: "Generation is temporarily unavailable while we confirm provider costs and capacity. Check your existing task before creating another request.",
    code: "GENERATION_COST_UNAVAILABLE",
  }, 503);
  if (error instanceof CreditError) return c.json({error:error.code,code:error.code},error.status);
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
  c.set("owner", who.owner);
  c.set("identity", who);
  if (c.req.method === "POST" && ["/api/jobs", "/api/jobs/quote"].includes(c.req.path) && !who.ageConfirmed)
    return c.json({ error: "Confirm that you are at least 18 before generating videos.", code: "AGE_REQUIRED" }, 428);
  await next();
};
app.use("/jobs", requireIdentity);
app.use("/jobs/*", requireIdentity);

async function publicJob(j: typeof jobs.$inferSelect) {
  return {
    id: j.id,
    family: j.family,
    mode: j.mode,
    prompt: j.prompt,
    duration: j.duration,
    resolution: j.resolution,
    status: j.status,
    resultUrl: j.status==='success' && !j.reviewRequired ? j.resultUrl : null,
    createdAt: j.createdAt.toISOString(),
    billingMode: j.billingMode, credits: j.credits, creditState: j.creditState,
    reviewRequired: j.reviewRequired,
    moderation: await publicModeration(j.id),
    deliveryVerifiedAt: j.deliveryVerifiedAt?.toISOString() ?? null,
    downloadNotice: j.status === "success" ? "Download your video promptly. Provider links may expire; permanent storage is not included." : null,
  };
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
  return c.json({ jobs: await Promise.all(rows.map(publicJob)) });
});
app.post("/jobs/quote", async c => {
  const who=c.get("identity");
  if(!who.user) return c.json({error:"Sign in with Google to view a credit quote."},401);
  const parsed=generationSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:parsed.error.issues[0]?.message??"Invalid generation settings."},400);
  return c.json(await createQuote(who.user.id,parsed.data,charging));
});
app.post("/jobs", async c => {
  const body=await c.req.json().catch(()=>null);
  if(!body || typeof body!=="object" || Array.isArray(body)) return c.json({error:"Invalid generation settings."},400);
  const {billingMode="preview",quoteId,...input}=body;
  if(!["preview","paid"].includes(billingMode)) return c.json({error:"Invalid billing mode."},400);
  const who=c.get("identity"), paid=billingMode==="paid";
  if(paid && !who.user) return c.json({error:"Sign in with Google to use credits."},401);
  if(paid && (typeof quoteId!=="string" || !uuidPattern.test(quoteId))) return c.json({error:"Request a fresh quote before generating."},400);
  if(!paid && !who.canGenerate) return c.json({error:"Redeem a preview code before generating videos."},403);
  if(videoProvider.kind!=="fake" && (paid ? !process.env.VIBETOKEN_API_KEY || !process.env.DATABASE_URL : !configured())) return c.json({error:"Generation is not configured yet."},503);
  const parsed=generationSchema.safeParse(input);
  if(!parsed.success) return c.json({error:parsed.error.issues[0]?.message??"Check the generation settings."},400);
  const x=parsed.data,payload=providerPayload(x);
  if(paid && !charging.enabled && !generationPilotAllows(who.user!.id,x,charging))
    return c.json({error:"Paid generation is not available for this request.",code:"GENERATION_CHARGING_DISABLED"},503);
  // Preserve preview fingerprints from before the wallet migration.
  const fingerprint=paid?generationFingerprint(x):createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const rawLimit=Number(process.env.GENERATION_DAILY_LIMIT??10);
  const limit=Number.isInteger(rawLimit)&&rawLimit>0?Math.min(rawLimit,1000):10;
  const reserved=await database().transaction(async tx=>{
    // This gate covers preview AND paid live traffic. Fake transports stay isolated.
    if(videoProvider.kind === "live") await lockGenerationCostBudget(tx);
    if(!who.user && !(await lockGuest(tx,who.owner))) return {error:"This guest session has ended. Sign in again.",status:401 as const};
    if(paid) await lockWallet(tx,who.user!.id,charging.environment);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7421911)`);
    const [prior]=await tx.select().from(jobs).where(eq(jobs.id,x.requestId)).limit(1);
    if(prior) return prior.owner===who.owner && prior.fingerprint===fingerprint && prior.billingMode===billingMode
      ? {job:prior,fresh:false} : {error:"This request ID is already in use.",status:409 as const};
    const pilot = paid && !charging.enabled ? await assertPilotCreation(tx, who.user!.id, x, charging) : null;
    if(!paid) {
      const count=await tx.execute(sql`SELECT count(*)::int AS n FROM video_jobs WHERE billing_mode='preview' AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
      if(Number(count[0]?.n)>=limit) return {error:"Today's preview generation limit has been reached. Please come back tomorrow.",status:429 as const};
    }
    if(videoProvider.kind === "live") await reserveGenerationCost(tx, {
      jobId:x.requestId, fingerprint:generationFingerprint(x),
      spec:{provider:"vibetoken",model:String(payload.model),mode:x.mode,duration:x.duration,
        resolution:x.resolution,audio:x.audio,ratio:x.ratio},
    });
    const [row]=await tx.insert(jobs).values({id:x.requestId,owner:who.owner,family:x.family,mode:x.mode,prompt:x.prompt,duration:x.duration,resolution:x.resolution,fingerprint,payload,status:"submitting",billingMode,creditEnvironment:paid?charging.environment:null}).returning();
    if(paid) {
      const credits=await useQuote(tx,who.user!.id,x,quoteId,charging);
      await reserveCredits(tx,{jobId:row.id,userId:who.user!.id,environment:charging.environment,credits});
      const [charged]=await tx.update(jobs).set({credits,creditState:"reserved"}).where(eq(jobs.id,row.id)).returning();
      if(pilot) await recordPilotCreation(tx, charged, pilot);
      return {job:charged,fresh:true};
    }
    return {job:row,fresh:true};
  });
  if("error" in reserved) return c.json({error:reserved.error},reserved.status);
  const row=reserved.fresh?await processJob(reserved.job.id,videoProvider):reserved.job;
  const result=row??reserved.job;
  if(result.reviewRequired && !result.submissionStartedAt && result.status==='unknown') return c.json({
    job:await publicJob(result), code:"GENERATION_NOT_STARTED",
    error:"This generation could not start. Reserved credits have been released. Please try a new request later or contact support.",
  },503);
  return c.json({job:await publicJob(result)},reserved.fresh?201:200);
});
app.get("/jobs/:id", async c => {
  let j=await owned(c.req.param("id"),c.get("owner"));
  if(!j) return c.json({error:"Video not found."},404);
  // Reads only poll. The worker owns first submission of already accepted queued jobs.
  if(!["success","failed"].includes(j.status) && !j.reviewRequired && j.nextPollAt<=new Date()) j=await pollJob(j.id,videoProvider)??j;
  return c.json({job:await publicJob(j)});
});
app.post("/jobs/:id/recover", async c => {
  const j=await owned(c.req.param("id"),c.get("owner"));
  if(!j) return c.json({error:"Video not found."},404);
  // No invite needed to poll an owned job. Recovery never initiates ANY generation POST.
  if(j.reviewRequired) return c.json({job:await publicJob(j)});
  return c.json({job:await publicJob(await pollJob(j.id,videoProvider,true)??j)});
});
return app;
}
export const app=createApp();
