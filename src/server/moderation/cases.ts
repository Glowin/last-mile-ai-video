import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { database } from '../db';
import { jobs } from '../schema';
import { ModerationError } from './service';
export type CaseCategory='content'|'rights'|'privacy'|'billing'|'account'|'other';
function audit(actor:string,reason:string) {if(actor.trim().length<2 || reason.trim().length<10 || reason.length>2000) throw new ModerationError('OPERATOR_AND_SPECIFIC_REASON_REQUIRED');}
/** References are opaque support-mail IDs, not raw emails, allegations or attachments. */
export async function openCase(p:{sourceReference:string;category:CaseCategory;summary:string;actor:string;jobId?:string}) {
 audit(p.actor,p.summary);
 if(!/^[a-zA-Z0-9:_-]{3,200}$/.test(p.sourceReference) || !['content','rights','privacy','billing','account','other'].includes(p.category)) throw new ModerationError('INVALID_CASE');
 return database().transaction(async tx=>{
  if(p.jobId) {
   const [j]=await tx.select().from(jobs).where(eq(jobs.id,p.jobId)).for('update');
   if(!j) throw new ModerationError('JOB_NOT_FOUND');
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${p.sourceReference}, 8108))`);
  const [existing]=await tx.execute(sql`SELECT * FROM moderation_cases WHERE source_reference=${p.sourceReference}`);
  if(existing) {
   if(existing.job_id!==(p.jobId??null) || existing.category!==p.category || existing.summary!==p.summary) throw new ModerationError('CASE_REFERENCE_CONFLICT');
   return existing;
  }
  const id=randomUUID();
  const [row]=await tx.execute(sql`INSERT INTO moderation_cases(id,job_id,source_reference,category,summary,created_by) VALUES(${id}::uuid,${p.jobId??null}::uuid,${p.sourceReference},${p.category},${p.summary},${p.actor}) RETURNING *`);
  if(p.jobId && ['content','rights','privacy'].includes(p.category)) {
   // Pause new submissions/polling and remove our displayed link; this does not
   // retract copies already downloaded or delete a provider-hosted file.
   await tx.update(jobs).set({reviewRequired:true,resultUrl:null,status:'unknown',leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(jobs.id,p.jobId));
  }
  await tx.execute(sql`INSERT INTO moderation_case_events(id,case_id,actor,action,reason) VALUES(${randomUUID()}::uuid,${id}::uuid,${p.actor},'opened',${p.summary})`);
  return row;
 });
}
export async function resolveCase(id:string,actor:string,reason:string) {
 audit(actor,reason);
 return database().transaction(async tx=>{
  const [row]=await tx.execute(sql`SELECT * FROM moderation_cases WHERE id=${id}::uuid FOR UPDATE`);
  if(!row) throw new ModerationError('CASE_NOT_FOUND');
  if(row.status==='resolved') {
   if(row.resolved_by===actor && row.resolution===reason) return row;
   throw new ModerationError('CASE_ALREADY_RESOLVED');
  }
  const [updated]=await tx.execute(sql`UPDATE moderation_cases SET status='resolved',resolved_by=${actor},resolution=${reason},resolved_at=now() WHERE id=${id}::uuid RETURNING *`);
  await tx.execute(sql`INSERT INTO moderation_case_events(id,case_id,actor,action,reason) VALUES(${randomUUID()}::uuid,${id}::uuid,${actor},'resolved',${reason})`);
  // Resolving correspondence alone cannot approve content or restart a task.
  return updated;
 });
}
