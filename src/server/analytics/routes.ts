import { Hono } from "hono";
import { z } from "zod";
import { database } from "../db";
import { identity } from "../account";
import { analyticsGaClients } from "./schema";
import { eq } from "drizzle-orm";
import { GA_CLIENT_ID } from "./measurement-protocol";

// Stores the signed-in user's GA browser ID only after the browser granted analytics
// consent, so a later server-side purchase event joins the same GA user. Guests: no-op.
export const analyticsRoutes = new Hono();
const input = z.object({ clientId: z.string().max(64).regex(GA_CLIENT_ID) }).strict();
analyticsRoutes.post("/ga-client", async (c) => {
  const parsed = input.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid analytics client." }, 400);
  if (!process.env.DATABASE_URL) return c.body(null, 204);
  const who = await identity(c).catch(() => null);
  if (!who?.user) return c.body(null, 204);
  await database().insert(analyticsGaClients).values({ userId: who.user.id, gaClientId: parsed.data.clientId })
    .onConflictDoUpdate({ target: analyticsGaClients.userId, set: { gaClientId: parsed.data.clientId, updatedAt: new Date() } });
  return c.body(null, 204);
});
analyticsRoutes.delete("/ga-client", async (c) => {
  if (!process.env.DATABASE_URL) return c.body(null, 204);
  const who = await identity(c).catch(() => null);
  if (who?.user) await database().delete(analyticsGaClients).where(eq(analyticsGaClients.userId, who.user.id));
  return c.body(null, 204);
});
