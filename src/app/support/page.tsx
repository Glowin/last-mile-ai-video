import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata={title:'Support | KakaReel',description:'Get help with account access, video tasks, credits, refunds and content reports.'};
export default function Support() {
 return <><SiteHeader/><main id="main" className="shell prose">
  <h1>Help with KakaReel.</h1>
  <p>Email <a href="mailto:support@kakareel.com">support@kakareel.com</a>. KakaReel's founder handles support, billing questions and content review. We do not offer a guaranteed response time.</p>
  <h2>A video is pending or under review</h2>
  <p>Send the task ID and the status shown in your account. Keep the original task; do not start repeated generations to recover it. A pending or unknown result is not a confirmed failure. A content review can hold an input before generation or a video before delivery.</p>
  <h2>Payments, credits and refunds</h2>
  <p>Include your KakaReel order ID and the problem you see. Never send a full payment-card number or account password. A pending payment or refund needs confirmation; paying again does not repair an existing order. See the <a href="/terms">unused-pack refund policy</a> for eligibility.</p>
  <h2>Report content or appeal a decision</h2>
  <p>Include the task ID, what concerns you, and why you believe the content violates our <a href="/acceptable-use">acceptable-use policy</a> or should be reconsidered. For a rights complaint, describe your rights and the material affected. Do not send illegal imagery; describe the issue instead.</p>
  <h2>Account access, privacy and deletion</h2>
  <p>Tell us the account email and what you need changed. We may need to verify ownership before changing account data. Automatic deletion periods and self-service deletion are not currently implemented. Download your approved videos promptly: provider links can expire, and KakaReel is not a permanent archive.</p>
  <p>Use email for private issues. The public GitHub repository is for code issues only; do not post private prompts, images, result links or credentials there.</p>
 </main><SiteFooter/></>;
}
