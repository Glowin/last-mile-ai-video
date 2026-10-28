import { parseFirstTouch } from "../../lib/attribution";
import type { Transaction } from "../account";
import { userAttribution } from "./schema";

/**
 * Attach the browser's first-touch cookie to a newly created account. Runs inside
 * the sign-up transaction; a missing or invalid cookie still records "(direct)/unknown"
 * so the report can tell pre-release users (no row) from untagged new users.
 */
export async function recordFirstTouch(tx: Transaction, userId: string, raw: string | undefined, now = Date.now()) {
  const t = parseFirstTouch(raw, now);
  await tx.insert(userAttribution).values({
    userId,
    utmSource: t?.utm_source ?? null, utmMedium: t?.utm_medium ?? null, utmCampaign: t?.utm_campaign ?? null,
    utmContent: t?.utm_content ?? null, utmTerm: t?.utm_term ?? null, ref: t?.ref ?? null,
    referrerHost: t?.referrer_host ?? null, landingPath: t?.landing_path ?? "/",
    clickIdType: t?.click_id ?? null, firstSeenAt: t ? new Date(t.ts * 1000) : null,
  }).onConflictDoNothing();
}
