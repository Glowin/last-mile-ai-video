/** Operator-only CLI. Never imported by an HTTP route; no prices or budget defaults. */
import { readFile, realpath, lstat, stat, access } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { database, closeDatabase } from '../src/server/db';
import { GenerationCostError, configureGenerationBudget, confirmGenerationRate,
  observeSupplierPrice, recordActualGenerationCost } from '../src/server/costs';

const text=z.string().trim().min(1).max(1000);
const money=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date=z.string().datetime({offset:true}).transform(s=>new Date(s));
const target=z.object({database:text,role:text}).strict();
const spec=z.object({provider:text,model:text,mode:z.enum(['text','image']),duration:z.number().int().positive(),
  resolution:text,audio:z.boolean(),ratio:text}).strict();
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('budget'),target,expectedRevision:z.number().int().nonnegative(),enabled:z.boolean(),capMinor:money,
    validFrom:date,expiresAt:date,actor:text,evidenceRef:text}).strict(),
  z.object({action:z.literal('rate'),target,spec,expectedRateId:z.string().uuid().nullable(),maximumMinor:money.positive(),
    sourceRef:text,observedAt:date,validFrom:date,expiresAt:date,actor:text}).strict(),
  z.object({action:z.literal('observe'),target,spec,amountMinor:money,observedAt:date,sourceRef:text,actor:text}).strict(),
  z.object({action:z.literal('actual'),target,jobId:z.string().uuid(),amountMinor:money,evidenceRef:text,actor:text}).strict(),
]);

/** Refuse repo-contained, symlinked, shared-readable or oversized operator input. */
export async function readCostAdminInput(path:string) {
  if(!isAbsolute(path)) throw new Error('INPUT_PATH');
  const info=await lstat(path);
  if(!info.isFile() || info.isSymbolicLink() || info.size>65_536 || (info.mode&0o777)!==0o600) throw new Error('INPUT_FILE');
  const canonical=await realpath(path);
  const checkout=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const rel=relative(checkout,canonical);
  if(!rel || rel!== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('INPUT_IN_CHECKOUT');
  if(((await stat(dirname(canonical))).mode&0o777)!==0o700) throw new Error('INPUT_DIRECTORY');
  // Other worktrees / repositories are not a configuration store either.
  for(let dir=dirname(canonical);;dir=dirname(dir)) {
    const inRepo=await access(resolve(dir,'.git')).then(()=>true,()=>false);
    if(inRepo) throw new Error('INPUT_IN_REPOSITORY');
    if(dirname(dir)===dir) break;
  }
  return command.parse(JSON.parse(await readFile(canonical,'utf8')));
}
export async function runCostAdmin(path:string) {
  const input=await readCostAdminInput(path);
  return database().transaction(async tx=>{
    const [target]=await tx.execute(sql`SELECT current_database() AS db,current_user AS role`);
    if(target.db!==input.target.database || target.role!==input.target.role) throw new Error('DATABASE_TARGET_MISMATCH');
    switch(input.action) {
      case 'budget': return configureGenerationBudget(tx,input);
      case 'rate': return confirmGenerationRate(tx,input);
      // blocked / priceIncreased are successful recorded facts. COMMIT them.
      case 'observe': return observeSupplierPrice(tx,input);
      case 'actual': return recordActualGenerationCost(tx,input);
    }
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==3) throw new Error('USAGE');
    console.log(JSON.stringify(await runCostAdmin(process.argv[2])));
  } catch(error) {
    // No raw JSON, validation values, connection errors or secret-bearing paths.
    console.error(error instanceof GenerationCostError ? error.code : 'Cost administration rejected. Check the private input, target identity and database access.');
    process.exitCode=1;
  } finally { await closeDatabase(); }
}
