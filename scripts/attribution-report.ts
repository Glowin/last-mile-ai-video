/** Operator-only CLI: channel report from first-touch attribution. Read-only except `dispatch-purchases`. */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { database, closeDatabase } from '../src/server/db';
import { dispatchPaidPurchases } from '../src/server/analytics/purchases';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(`${s}T00:00:00Z`)),'date');
export const reportInput=z.object({
  from:day, to:day,
  tz:z.string().max(64).refine(tz=>{ try { new Intl.DateTimeFormat('en',{timeZone:tz}); return true; } catch { return false; } },'tz').default('Asia/Shanghai'),
  group:z.enum(['source','source_medium','campaign']).default('source_medium'),
  environment:z.enum(['live','test']).default('live'),
  json:z.boolean().default(false),
}).strict().refine(v=>v.from<=v.to,'range');
export type ReportInput=z.infer<typeof reportInput>;
export type ReportRow={source:string;medium:string;campaign:string;signups:number;generations:number;paid_generations:number;
  paid_orders:number;refunded_orders:number;revenue_minor:number;currency:string|null};

// Source: utm_source > ref > referring host > (direct). Users from before attribution existed: (unattributed).
const CHANNEL=sql`
  SELECT u.id AS user_id,
    CASE WHEN a.user_id IS NULL THEN '(unattributed)' ELSE coalesce(a.utm_source, a.ref, a.referrer_host, '(direct)') END AS source,
    CASE WHEN a.user_id IS NULL THEN '(unattributed)' ELSE coalesce(a.utm_medium, CASE WHEN a.utm_source IS NULL AND a.ref IS NOT NULL THEN 'ref'
      WHEN a.utm_source IS NULL AND a.referrer_host IS NOT NULL THEN 'referral' END, '(none)') END AS medium,
    coalesce(a.utm_campaign, '(not set)') AS campaign
  FROM users u LEFT JOIN user_attribution a ON a.user_id = u.id`;

export async function attributionReport(input:ReportInput):Promise<ReportRow[]> {
  const {from,to,tz,group,environment}=input;
  // Half-open [from 00:00, to+1 00:00) in the operator's time zone.
  const start=sql`(${from}::date)::timestamp AT TIME ZONE ${tz}`;
  const end=sql`((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}`;
  const medium=group==='source'?sql`''`:sql`c.medium`;
  const campaign=group==='campaign'?sql`c.campaign`:sql`''`;
  return database().transaction(async tx=>{
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const rows=await tx.execute(sql`
      WITH c AS (${CHANNEL}),
      s AS (SELECT c.source, ${medium} AS medium, ${campaign} AS campaign, count(*)::int AS signups
        FROM c JOIN users u ON u.id=c.user_id WHERE u.created_at >= ${start} AND u.created_at < ${end} GROUP BY 1,2,3),
      g AS (SELECT c.source, ${medium} AS medium, ${campaign} AS campaign, count(*)::int AS generations,
          (count(*) FILTER (WHERE j.billing_mode='paid' AND (j.credit_environment IS NULL OR j.credit_environment=${environment})))::int AS paid_generations
        FROM video_jobs j JOIN c ON c.user_id=j.owner WHERE j.created_at >= ${start} AND j.created_at < ${end} GROUP BY 1,2,3),
      o AS (SELECT c.source, ${medium} AS medium, ${campaign} AS campaign,
          (count(*) FILTER (WHERE b.status='paid'))::int AS paid_orders,
          (count(*) FILTER (WHERE b.status='refunded'))::int AS refunded_orders,
          (coalesce(sum(b.subtotal_minor) FILTER (WHERE b.status='paid'),0))::int AS revenue_minor,
          CASE WHEN count(DISTINCT b.currency)=1 THEN min(b.currency) ELSE 'MIXED' END AS currency
        FROM billing_orders b JOIN c ON c.user_id=b.user_id
        WHERE b.environment=${environment} AND b.status IN ('paid','refunded') AND b.paid_at >= ${start} AND b.paid_at < ${end}
        GROUP BY 1,2,3),
      k AS (SELECT source,medium,campaign FROM s UNION SELECT source,medium,campaign FROM g UNION SELECT source,medium,campaign FROM o)
      SELECT k.source, k.medium, k.campaign, coalesce(s.signups,0) AS signups, coalesce(g.generations,0) AS generations,
        coalesce(g.paid_generations,0) AS paid_generations, coalesce(o.paid_orders,0) AS paid_orders,
        coalesce(o.refunded_orders,0) AS refunded_orders, coalesce(o.revenue_minor,0) AS revenue_minor, o.currency
      FROM k LEFT JOIN s USING (source,medium,campaign) LEFT JOIN g USING (source,medium,campaign) LEFT JOIN o USING (source,medium,campaign)
      ORDER BY revenue_minor DESC, signups DESC, source, medium, campaign`);
    return [...rows] as unknown as ReportRow[];
  });
}

export function formatReport(rows:ReportRow[], input:ReportInput) {
  const head=['source','medium','campaign','signups','generations','paid_gen','paid_orders','refunded','revenue'];
  const body=rows.map(r=>[r.source,r.medium||'-',r.campaign||'-',r.signups,r.generations,r.paid_generations,r.paid_orders,r.refunded_orders,
    `${(r.revenue_minor/100).toFixed(2)}${r.currency?` ${r.currency}`:''}`].map(String));
  const width=head.map((h,i)=>Math.max(h.length,...body.map(r=>r[i].length)));
  const line=(r:string[])=>r.map((v,i)=>v.padEnd(width[i])).join('  ');
  return [`First-touch channels ${input.from}..${input.to} (${input.tz}), ${input.environment} orders, revenue = subtotal of paid orders`,
    line(head),...body.map(line),...(rows.length?[]:['(no data)'])].join('\n');
}

const USAGE=`Usage:
  pnpm analytics:report report --from YYYY-MM-DD --to YYYY-MM-DD [--tz Asia/Shanghai] [--group source|source_medium|campaign] [--environment live|test] [--json]
  pnpm analytics:report dispatch-purchases   # send pending GA4 purchase events (needs GA_MEASUREMENT_ID and GA_API_SECRET)`;

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [command,...rest]=process.argv.slice(2);
    if(command==='report') {
      const {values}=parseArgs({args:rest,strict:true,options:{from:{type:'string'},to:{type:'string'},tz:{type:'string'},
        group:{type:'string'},environment:{type:'string'},json:{type:'boolean'}}});
      const input=reportInput.parse(values);
      const rows=await attributionReport(input);
      console.log(input.json?JSON.stringify({...input,rows},null,2):formatReport(rows,input));
    } else if(command==='dispatch-purchases' && rest.length===0) {
      console.log(JSON.stringify(await dispatchPaidPurchases({limit:50})));
    } else { console.error(USAGE); process.exitCode=2; }
  } catch(error) {
    // No connection strings, SQL or raw values in the output.
    console.error(error instanceof z.ZodError || (error as {code?:string})?.code?.startsWith?.('ERR_PARSE_ARGS')
      ? `Invalid arguments.\n${USAGE}` : 'Attribution report failed. Check DATABASE_URL access and that migrations are applied.');
    process.exitCode=1;
  } finally { await closeDatabase(); }
}
