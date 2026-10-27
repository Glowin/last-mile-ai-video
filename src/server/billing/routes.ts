import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { identity, hasAccountCookies, type Account } from "../account";
import { billingProviderIds } from "../../lib/billing";
import { BillingError, BillingService, type BillingOptions } from "./service";

const checkoutInput = z.object({ productId: z.string().min(1).max(100),
  provider: z.enum(billingProviderIds), requestId: z.uuid() }).strict();
const webhookPaths = new Set(billingProviderIds.map((id) => `/api/billing/webhooks/${id}`));
// Parent Origin middleware must use this exact method AND path predicate, not a prefix.
export function isBillingWebhookRequest(method: string, path: string) {
  return method === "POST" && webhookPaths.has(path);
}
function handleError(error: Error) {
  return error instanceof BillingError
    ? { body: { error: error.message, code: error.code }, status: error.status }
    : { body: { error: "Billing is temporarily unavailable. Please try again.", code: "BILLING_UNAVAILABLE" }, status: 503 as const };
}
export function createBillingModule(options?: BillingOptions) {
  const service = new BillingService(options);
  const routes = new Hono<{ Variables: { billingUser: Account; billingPreview: boolean } }>();
  routes.onError((error, c) => { const r = handleError(error); return c.json(r.body, r.status); });
  routes.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  // Defense in depth: mounting billing elsewhere must not lose checkout CSRF.
  routes.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      let expected: string | undefined;
      try { expected = new URL(process.env.APP_URL ?? "").origin; } catch { /* Fail closed. */ }
      if (!expected || c.req.header("origin") !== expected || c.req.header("sec-fetch-site") === "cross-site")
        throw new BillingError(403, "ORIGIN_REJECTED", "Open billing on the configured website.");
    }
    await next();
  });
  routes.get("/catalog", (c) => c.json(service.catalog()));
  routes.use("*", async (c, next) => {
    const who = await identity(c);
    if (!who) throw new BillingError(401, hasAccountCookies(c) ? "SESSION_EXPIRED" : "GOOGLE_SIGN_IN_REQUIRED", "Sign in with Google to view billing.");
    if (!who.user) throw new BillingError(403, "GOOGLE_ACCOUNT_REQUIRED", "Checkout requires a Google account, not a guest session.");
    const expectedOwner = c.req.header("X-KakaReel-Owner");
    if ((c.req.method !== "GET" || expectedOwner !== undefined) && expectedOwner !== who.user.id)
      throw new BillingError(409, "ACCOUNT_CHANGED", "Your account changed. Reload billing before purchasing.");
    c.set("billingUser", who.user);
    c.set("billingPreview", who.canGenerate);
    await next();
  });
  routes.get("/", async (c) => c.json(await service.summary(c.get("billingUser").id, c.get("billingPreview"))));
  routes.get("/pilot", async (c) => c.json(await service.pilot(c.get("billingUser").id)));
  routes.get("/orders", async (c) => c.json(await service.list(c.get("billingUser").id)));
  routes.get("/orders/:id", async (c) => c.json(await service.get(c.get("billingUser").id, c.req.param("id"))));
  routes.post("/orders/:id/refund", bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "Refund request is too large.", code: "BODY_TOO_LARGE" }, 413) }), async (c) => {
    const input = z.object({}).strict().safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new BillingError(400, "INVALID_REFUND_REQUEST", "Send an empty object; refund amount and ownership are determined by the server.");
    return c.json(await service.requestRefund(c.get("billingUser").id, c.req.param("id")));
  });
  routes.post("/checkout", bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "Checkout request is too large.", code: "BODY_TOO_LARGE" }, 413) }), async (c) => {
    const input = checkoutInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new BillingError(400, "INVALID_CHECKOUT", "Choose a product and provider with a valid request ID; no pricing or account fields are accepted.");
    return c.json(await service.checkout(c.get("billingUser"), input.data));
  });
  const webhookRoutes = new Hono();
  webhookRoutes.onError((error, c) => { const r = handleError(error); return c.json(r.body, r.status); });
  webhookRoutes.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  webhookRoutes.use("*", bodyLimit({ maxSize: 262144, onError: (c) => c.json({ error: "Webhook is too large.", code: "BODY_TOO_LARGE" }, 413) }));
  webhookRoutes.post("/:provider", async (c) => {
    const provider = z.enum(billingProviderIds).safeParse(c.req.param("provider"));
    if (!provider.success) throw new BillingError(404, "PROVIDER_NOT_FOUND", "Provider not found.");
    return c.json(await service.webhook(provider.data, new Uint8Array(await c.req.arrayBuffer()), c.req.raw.headers));
  });
  return { routes, webhookRoutes };
}
const defaults = createBillingModule();
export const billingRoutes = defaults.routes;
export const billingWebhookRoutes = defaults.webhookRoutes;
