import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata={title:'Support | KakaReel',description:'Get help with account access, video tasks, credits, refunds and content reports.'};
export default function Support() {
 return <><SiteHeader/><main id="main" className="shell prose">
  <span className="eyebrow">SUPPORT & CONTENT REVIEW</span>
  <h1>Help with <em>KakaReel.</em></h1>
  <div className="prose-callout"><p>Email <a href="mailto:support@kakareel.com">support@kakareel.com</a>. KakaReel's founder handles support, billing questions and content review. You can contact us without signing in. We aim to give an initial response to general support requests within 3 business days; this is a target, not a guaranteed response time or 24/7 service.</p></div>
  <h2>A video is pending or under review</h2>
  <p>Send the task ID and the status shown in your account. Keep the original task; do not start repeated generations to recover it. A pending or unknown result is not a confirmed failure. A content review can hold an input before generation or a video before delivery.</p>
  <h2>Payments, credits and refunds</h2>
  <p>Include your KakaReel order ID and the problem you see. Never send a full payment-card number or account password. A pending payment or refund needs confirmation; paying again does not repair an existing order. See the <a href="/terms">unused-pack refund policy</a> for eligibility.</p>
  <h2>Report content or appeal a decision</h2>
  <p><a href="mailto:support@kakareel.com?subject=Content%20report">Send a content report</a> or <a href="mailto:support@kakareel.com?subject=Content%20appeal">appeal a content decision</a>. Include the task or case ID if known, what concerns you, and why you believe the content violates our <a href="/acceptable-use">acceptable-use policy</a> or should be reconsidered. An ID is helpful but not required. For a rights complaint, describe your rights and the material affected. Do not send illegal imagery; describe the issue instead.</p>
  <h2>Urgent reports and response targets</h2>
  <p>For child safety, non-consensual intimate imagery, terrorism or a credible threat, use the subject “Urgent safety report”. We aim for an initial human response and an initial protective decision within 24 hours of receipt. Other content reports receive an initial response and an interim-hold decision within 3 business days, with a decision or investigation update within 7 business days. Appeals receive a reviewed decision or substantive progress update within 7 business days. See <a href="/acceptable-use#response-times">the full response and handling policy</a>.</p>
  <p>Business days are Monday through Friday, excluding public holidays in China, using China Standard Time (UTC+8). These are operating targets, not guaranteed completion times. If more time is needed, we explain why and give the next expected update. This inbox is not an emergency service; contact local emergency services if someone is in immediate danger.</p>
  <h2>Account access, privacy and deletion</h2>
  <p>Tell us the account email and what you need changed. We may need to verify ownership before changing account data. Automatic deletion periods and self-service deletion are not currently implemented. Download your approved videos promptly: provider links can expire, and KakaReel is not a permanent archive.</p>
  <p>Use email for private issues. The public GitHub repository is for code issues only; do not post private prompts, images, result links or credentials there.</p>
 </main><SiteFooter/></>;
}
