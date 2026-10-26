import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata={title:'Acceptable use | KakaReel',description:'Content rules, human review and reporting for KakaReel video generation.'};
export default function AcceptableUse() {
 return <><SiteHeader/><main id="main" className="shell prose">
  <span className="eyebrow">SAFETY & CONTENT POLICY</span>
  <h1>Create <em>responsibly.</em></h1>
  <p className="lead">Updated October 26, 2026. These rules cover prompts, uploaded images and generated videos, including any audio in a generated video.</p>
  <nav className="prose-nav" aria-label="Policy sections">
   <a href="#enforcement">Enforcement</a>
   <a href="#report">Report content</a>
   <a href="#response-times">Response targets</a>
   <a href="#appeal">Appeals</a>
  </nav>
  <h2>Content we do not allow</h2>
  <ul>
   <li>Pornography, sexually explicit or NSFW content, including adult sexual content and non-consensual intimate imagery.</li>
   <li>Violence or gore, including graphic injury, mutilation or cruelty.</li>
   <li>Hate speech, including content attacking people based on protected characteristics or inciting hatred or genocide.</li>
   <li>Child sexual abuse material (CSAM), child sexual exploitation or any sexual content involving anyone under 18, including synthetic depictions.</li>
   <li>Deepfakes or impersonation of real people: face swaps, nudification, fabricated kissing, hugging or other intimate interactions, or fabricated speech or actions attributed to a real person. These are prohibited even with the person's consent.</li>
   <li>Copyright or trademark infringement, including unauthorized use of protected works, characters, logos or brands.</li>
   <li>Promotion or assistance of terrorism, violent extremism or mass harm, and instructions to make or use dangerous weapons, including weapons of mass destruction.</li>
   <li>Other illegal content, fraud, privacy violations, targeted harassment, instructions to harm people, or threats to create or share prohibited intimate imagery.</li>
   <li>Attempts to bypass content review, including jailbreak prompts, and presenting AI-generated content as authentic footage or human-created work to deceive others.</li>
  </ul>
  <h2>Use material you have rights to</h2>
  <p>You must have the necessary rights and permissions for every upload. Photos of identifiable people must be your own likeness or used with their explicit permission; do not upload another person's photo without their consent. Ordinary lawful material depicting people is allowed when it meets these rules, but permission does not exempt any deepfake or impersonation described above. Do not submit confidential information. Model-provider restrictions also apply; generating a video does not guarantee commercial rights.</p>
  <h2>Review before delivery</h2>
  <p>New requests under this policy go through human review of the full prompt, model settings and every uploaded image before submission to the model provider, then the complete generated video before delivery. Tasks created before this review process was introduced keep their earlier delivery process, including tasks still in progress; we do not label them as reviewed under this policy. KakaReel's founder handles review and may decline a request or withhold a result that violates these rules. We do not promise an instant review or automated approval.</p>
  <p>This is a manual review process. An automated prompt safety scanner is not currently in use. Model-provider safeguards do not replace our own input and output review.</p>
  <p>For paid generation, credits remain reserved during review. An operator-recorded rejection or expiry of a pre-delivery review releases that reservation; reaching a review deadline alone does not release credits automatically. This is not described as a model failure. An unresolved model outcome is a separate issue and may require investigation. Reviews and decisions are recorded for accountability.</p>
  <h2 id="enforcement">How we handle violations</h2>
  <ul>
   <li><strong>Warning and correction:</strong> for a minor or unclear issue, we may explain the concern by email and ask for clarification or a compliant new request. The task stays held until it can be reviewed.</li>
   <li><strong>Hold and investigation:</strong> a content, rights or privacy report linked to a task pauses further processing and hides its result in KakaReel while we investigate. A report alone is not proof of a violation.</li>
   <li><strong>Rejection or withheld delivery:</strong> confirmed prohibited inputs are rejected before generation; prohibited outputs are withheld. Severe issues such as child sexual exploitation, non-consensual intimate imagery, terrorism or credible threats receive priority. We may report suspected unlawful activity through appropriate provider or authority channels when required or appropriate.</li>
   <li><strong>Repeated or serious misuse:</strong> the founder can decline further requests during manual review after checking prior cases. This is not an automatic account ban or deletion.</li>
  </ul>
  <p>Rejection before delivery releases any credits still reserved for that task, including when the provider has already incurred a cost. That provider cost is KakaReel's responsibility. We do not automatically confiscate unused purchased credits as a penalty. Hiding an already delivered video does not automatically reverse its charge; billing concerns are investigated under our <a href="/terms">refund and credit rules</a>.</p>
  <p>We cannot retract copies already downloaded or guarantee removal from a model provider. We explain the decision and the route to appeal where we can contact the affected user, subject to privacy and legal restrictions. Automatic deletion schedules are not currently implemented; use support for a privacy or deletion request.</p>
  <h2 id="report">Report content or a rights concern</h2>
  <p>Email <a href="mailto:support@kakareel.com?subject=Content%20report">support@kakareel.com</a> with “Content report” in the subject, the task ID or affected page if available, a description of the concern, and relevant rights or consent information. You do not need an account or a task ID to report a concern. For child safety, intimate-image abuse, terrorism or a credible threat, start the subject with “Urgent safety report”. Do not attach illegal imagery, passwords, API keys or payment-card details. For immediate danger, contact the appropriate local emergency service; this inbox is not an emergency service.</p>
  <p>The founder records the report, assesses its urgency, investigates the available evidence and records the action and reply. We limit access to reporter information to people handling the matter, subject to necessary legal disclosures and our <a href="/privacy">privacy policy</a>. Deliberately false or abusive reports may themselves be investigated; a good-faith report is welcome even if no violation is found.</p>
  <h2 id="response-times">Response and handling targets</h2>
  <ul>
   <li><strong>Urgent safety reports:</strong> we aim to provide an initial human response and make an initial hold or withholding decision within 24 hours of receipt. Confirmed severe violations are acted on as soon as they are identified.</li>
   <li><strong>Other content or rights reports:</strong> we aim to respond and decide any interim hold within 3 business days, and provide a decision or an investigation update within 7 business days of receipt.</li>
   <li><strong>Appeals:</strong> we aim to provide a reviewed decision or a substantive progress update within 7 business days of receipt.</li>
  </ul>
  <p>These are operating targets, not guaranteed completion times or a promise of 24/7 staffing. Business days are Monday through Friday, excluding public holidays in China; we use China Standard Time (UTC+8). If we need more time or information, we explain the reason and the next expected update by email. A necessary content hold stays in place while the issue is unresolved. These support targets do not extend a generation review's validity or trigger an automatic credit release.</p>
  <h2 id="appeal">Appeal a decision</h2>
  <p>Email <a href="mailto:support@kakareel.com?subject=Content%20appeal">support@kakareel.com</a> with “Content appeal” in the subject, the case or task ID if known, the decision you disagree with and any new evidence. Please appeal within 30 days of the notice where possible; this does not limit statutory rights. The founder re-examines the evidence and records a reasoned response. We do not currently have a separate independent appeals reviewer.</p>
  <p>Closing a report does not automatically restore a result. A withheld output needs a fresh review before release. A rejected or expired input needs a new compliant task, with its own quote and review; we do not automatically retry or charge for it. Credits already released are not charged again merely because an appeal succeeds.</p>
  <p><a href="/support">Support and billing help</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
 </main><SiteFooter/></>;
}
