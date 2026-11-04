/** Host-only fixed-purpose acceptance administration. Never import into HTTP routes. */
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { readPrivateOperatorInput } from "./generation-cost-admin";
import { database, closeDatabase } from "../src/server/db";
import { issuePaidAcceptance, revokePaidAcceptance } from "../src/server/credits/acceptance";
import { CreditError } from "../src/server/credits/wallet";
import { GenerationCostError } from "../src/server/costs";
const text = z.string().trim().min(1).max(1000), uuid = z.uuid();
const common = { target:z.object({database:text,role:text}).strict(), userId:uuid, actor:text, evidenceRef:text };
const command = z.discriminatedUnion("action", [
  z.object({action:z.literal("issue"),...common,requestId:uuid,previousJobId:uuid,
    expectedRevision:z.number().int().nonnegative(),expiresAt:z.iso.datetime({offset:true}).transform(x=>new Date(x))}).strict(),
  z.object({action:z.literal("revoke"),...common,grantId:uuid}).strict(),
]);
export async function runPaidAcceptanceAdmin(path:string) {
  const input = command.parse(await readPrivateOperatorInput(path));
  return database().transaction(async tx => {
    const [target] = await tx.execute(sql`SELECT current_database() AS db,current_user AS role`);
    if (target.db !== input.target.database || target.role !== input.target.role) throw new Error("DATABASE_TARGET_MISMATCH");
    return input.action === "issue" ? issuePaidAcceptance(tx,input) : revokePaidAcceptance(tx,input);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("USAGE");
    console.log(JSON.stringify(await runPaidAcceptanceAdmin(process.argv[2])));
  } catch (error) {
    console.error(error instanceof CreditError || error instanceof GenerationCostError ? error.code :
      "Paid acceptance rejected. Check the private input, target identity and database access.");
    process.exitCode=1;
  } finally { await closeDatabase(); }
}
