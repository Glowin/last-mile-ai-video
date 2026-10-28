/** Run with tsx. Configuration supplied by host; never loads local credential files. */
import { workerTick, releaseForReview, pollJob } from '../src/server/jobs/runner';
import { database, closeDatabase } from '../src/server/db';
import { sql } from 'drizzle-orm';
const [command='once',id,actor,reason]=process.argv.slice(2);
let stopped=false;
process.on('SIGTERM',()=>{stopped=true;});
process.on('SIGINT',()=>{stopped=true;});
try {
  if(command==='review') {
    const rows=await database().execute(sql`SELECT id,status,credit_environment,credits,credit_state,created_at FROM video_jobs WHERE review_required ORDER BY created_at`);
    console.log(JSON.stringify(rows));
  } else if(command==='release') {
    if(!id || !actor || !reason) throw new Error('Usage: credit-worker.ts release JOB_UUID OPERATOR "specific reason"');
    const j=await releaseForReview(id,actor,reason);
    console.log(JSON.stringify({id:j.id,status:j.status,creditState:j.creditState}));
  } else if(command==='poll') {
    if(!id) throw new Error('Usage: credit-worker.ts poll JOB_UUID');
    const j=await pollJob(id,undefined,true);
    console.log(JSON.stringify(j?{id:j.id,status:j.status,creditState:j.creditState}:null));
  } else if(command==='once' || command==='run') {
    do {
      await workerTick();
      if(command==='run'&&!stopped) await new Promise(r=>setTimeout(r,5_000));
    } while(command==='run'&&!stopped);
  } else throw new Error('Commands: once | run | review | poll JOB_UUID | release JOB_UUID OPERATOR REASON');
} catch {
  // Driver/SDK messages can embed SQL parameters, prompts or credentials.
  // Inspect the bounded safety/cost audit through host-only tools instead.
  console.error('credit_worker_failed');process.exitCode=1;
} finally {await closeDatabase();}
