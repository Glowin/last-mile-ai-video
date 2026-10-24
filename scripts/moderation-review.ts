/** No HTTP admin surface. Run only as an authorized operator on a trusted host.
 * Config and exported evidence MUST be private files outside the repository. */
import { readFile, lstat, realpath, open } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { database, closeDatabase } from '../src/server/db';
import { currentReview, decideReview, listReviews, reopenOutputReview, ModerationError, type Decision } from '../src/server/moderation/service';
import { openCase, resolveCase, type CaseCategory } from '../src/server/moderation/cases';
const repo=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
async function privatePath(path:string,exists=true) {
 if(!isAbsolute(path)) throw new Error('Absolute private file path required.');
 const actual=exists?await realpath(path):resolve(await realpath(dirname(path)),path.split('/').at(-1)!);
 const rel=relative(repo,actual);
 if(!rel.startsWith('..'+ '/') && rel!=='..') throw new Error('Private files must be outside the checkout.');
 const parent=await lstat(dirname(actual));
 if(parent.uid!==process.getuid?.() || (parent.mode&0o077)!==0) throw new Error('Private parent directory must be owned by this operator and mode 0700.');
 if(exists) {
  const s=await lstat(path);
  if(!s.isFile() || s.isSymbolicLink() || s.uid!==process.getuid?.() || (s.mode&0o077)!==0) throw new Error('Private file must be owned by this operator and mode 0600.');
 }
 return actual;
}
async function json(path:string) {return JSON.parse(await readFile(await privatePath(path),'utf8'));}
async function writeEvidence(path:string,data:unknown) {
 const f=await open(await privatePath(path,false),'wx',0o600);
 try {await f.writeFile(JSON.stringify(data,null,2)+'\n');} finally {await f.close();}
}
const [configPath,command,...args]=process.argv.slice(2);
try {
 if(!configPath) throw new Error('Usage: tsx scripts/moderation-review.ts /private/config.json COMMAND ...');
 const config=await json(configPath);
 if(typeof config.operator!=='string' || config.operator.trim().length<2 || typeof config.databaseUrl!=='string') throw new Error('Config requires databaseUrl and operator.');
 const u=new URL(config.databaseUrl);
 if(!['postgres:','postgresql:'].includes(u.protocol)) throw new Error('PostgreSQL configuration required.');
 // Only the explicit private operator configuration selects a database.
 process.env.DATABASE_URL=config.databaseUrl;
 if(command==='queue') console.log(JSON.stringify(await listReviews()));
 else if(command==='export') {
  const [id,phase,path]=args;
  if(!['input','output'].includes(phase) || !path) throw new Error('export JOB_UUID input|output /private/review.json');
  const review=await database().transaction(tx=>currentReview(tx,id,phase as 'input'|'output'));
  if(!review) throw new Error('Review not found.');
  await writeEvidence(path,review);
  console.log('Review exported to private file; inspect all inputs or the full output before deciding.');
 } else if(command==='decide') {
  const [path,decision,reason,videoPath,attestation]=args;
  if(!['approved','rejected','expired'].includes(decision) || !reason) throw new Error('decide /private/review.json approved|rejected|expired REASON [/private/video.mp4 I_VIEWED_THIS_VIDEO]');
  const r=await json(path);
  let viewedContentSha256:string|undefined;
  if(r.phase==='output' && decision==='approved') {
   if(!videoPath || attestation!=='I_VIEWED_THIS_VIDEO') throw new Error('Download and view the full candidate video; provide private file and I_VIEWED_THIS_VIDEO.');
   const bytes=await readFile(await privatePath(videoPath));
   viewedContentSha256=createHash('sha256').update(bytes).digest('hex');
  }
  const d:Decision={jobId:r.job_id,phase:r.phase,version:r.version,inputHash:r.input_hash,outputHash:r.output_hash,decision:decision as Decision['decision'],actor:config.operator,reason,viewedContentSha256};
  const result=await decideReview(d);
  console.log(JSON.stringify({jobId:result.job_id,phase:result.phase,version:result.version,state:result.state}));
 } else if(command==='reopen-output') {
  const [id,reason]=args;const r=await reopenOutputReview(id,config.operator,reason);console.log(JSON.stringify({jobId:r.job_id,version:r.version,state:r.state}));
 } else if(command==='cases') {
  console.log(JSON.stringify(await database().execute(sql`SELECT id,job_id,source_reference,category,status,created_at FROM moderation_cases WHERE status='open' ORDER BY created_at LIMIT 100`)));
 } else if(command==='case-open') {
  const [reference,category,summary,jobId]=args;
  const r=await openCase({sourceReference:reference,category:category as CaseCategory,summary,actor:config.operator,jobId});
  console.log(JSON.stringify({id:r.id,status:r.status}));
 } else if(command==='case-resolve') {
  const [id,reason]=args;const r=await resolveCase(id,config.operator,reason);console.log(JSON.stringify({id:r.id,status:r.status}));
 } else throw new Error('Commands: queue | export | decide | cases | case-open | case-resolve');
} catch(e) {
 // SQL/network failures may contain credentials/content: emit only safe known errors.
 console.error(e instanceof ModerationError?e.code:'Moderation CLI failed. Check private configuration, arguments, evidence permissions and database availability.');
 process.exitCode=1;
} finally {await closeDatabase();}
