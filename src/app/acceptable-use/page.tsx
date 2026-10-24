import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata={title:'Acceptable use | KakaReel',description:'Content rules, human review and reporting for KakaReel video generation.'};
export default function AcceptableUse() {
 return <><SiteHeader/><main id="main" className="shell prose">
  <h1>Create responsibly.</h1>
  <p>Updated October 25, 2026. These rules cover prompts, uploaded images and generated videos.</p>
  <h2>Content we do not allow</h2>
  <ul>
   <li>Child sexual exploitation or sexual content involving anyone under 18, including synthetic depictions.</li>
   <li>Non-consensual intimate imagery, sexual deepfakes or threats to create or share them.</li>
   <li>Deceptive impersonation, fraud, or misleading claims that a real person said or did something.</li>
   <li>Illegal content, infringement of intellectual property or privacy rights, targeted harassment, or instructions to harm people.</li>
  </ul>
  <h2>Use material you have rights to</h2>
  <p>You must have the necessary rights and permissions for every upload, including permission to use an identifiable person's likeness. Do not submit confidential information. Model-provider restrictions also apply; generating a video does not guarantee commercial rights.</p>
  <h2>Review before delivery</h2>
  <p>Generation may be held for human review of the prompt, uploaded image and finished video. KakaReel's founder handles review and may decline or withhold content. We do not promise an instant review or automated approval.</p>
  <p>For paid generation, credits remain reserved during review. A rejected or expired pre-delivery review releases that reservation; it is not described as a model failure. An unresolved model outcome is a separate issue and may require investigation. Reviews and decisions are recorded for accountability.</p>
  <h2>Report a problem or request a review</h2>
  <p>Email <a href="mailto:support@kakareel.com">support@kakareel.com</a> with the task ID, a description of the concern and any relevant rights or consent information. You may also ask us to reconsider a decision. Do not attach illegal imagery, passwords, API keys or payment-card details.</p>
  <p>We can restrict access within KakaReel while investigating. We cannot retract copies already downloaded or guarantee removal from a model provider. Contact us for privacy or deletion requests. Automatic deletion schedules are not currently implemented.</p>
  <p><a href="/support">Support and billing help</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
 </main><SiteFooter/></>;
}
