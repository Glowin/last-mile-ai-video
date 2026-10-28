/** Host-only, READ ONLY diagnosis. Uses the existing runtime DATABASE_URL.
 * No content, user IDs, signed URLs or credentials are selected or printed. */
import postgres from 'postgres';
import { z } from 'zod';

let client: ReturnType<typeof postgres> | undefined;
try {
  const [id, ...extra] = process.argv.slice(2);
  if (extra.length || id && !z.uuid().safeParse(id).success || !process.env.DATABASE_URL)
    throw new Error('Invalid configuration or task ID');
  client = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 10, onnotice: () => {} });
  const result = await client.begin('read only', async tx => {
    await tx`SET LOCAL statement_timeout='5s'`;
    if (!id) return {
      summary: await tx`SELECT a.policy_version,a.status,j.status AS job_status,j.credit_state,count(*)::int AS count
        FROM generation_automation a JOIN video_jobs j ON j.id=a.job_id
        GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`,
    };
    const jobs = await tx`SELECT j.id,j.status,j.upstream_id,j.credit_state,j.credits,j.submission_started_at,j.delivery_verified_at,
      a.policy_version,a.status AS safety_status,a.reason,a.attempts,a.created_at,a.deadline_at,a.next_attempt_at,
      a.image_review,a.output_review,a.output_verified_at,a.output_content_sha256
      FROM video_jobs j LEFT JOIN generation_automation a ON a.job_id=j.id WHERE j.id=${id}::uuid`;
    if (!jobs.length) return { found: false };
    return { found: true, job: jobs[0],
      attempts: await tx`SELECT attempt,started_at,finished_at,action,request_id,reason_code,semantic_status,retryable,retry_after_ms,http_status
        FROM generation_automation_attempts WHERE job_id=${id}::uuid ORDER BY attempt`,
      credits: await tx`SELECT action,created_at FROM credit_audit WHERE job_id=${id}::uuid ORDER BY created_at`,
      cost: await tx`SELECT state,outcome,reserved_minor,exposure_minor,actual_minor,submitted_at
        FROM generation_cost_reservations WHERE job_id=${id}::uuid`,
    };
  });
  console.log(JSON.stringify(result));
} catch {
  console.error('generation_safety_status_failed');
  process.exitCode = 1;
} finally { if (client) await client.end(); }
