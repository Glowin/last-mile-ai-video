import { SiteHeader, SiteFooter } from '@/components/site-header';
export const metadata={title:'Acceptable use | KakaReel',description:'Content rules, human review and reporting for KakaReel video generation.'};
export default function AcceptableUse() {
 return <><SiteHeader/><main id="main" className="shell prose">
  <h1>Create responsibly.</h1>
  <p>Updated October 25, 2026. These rules cover prompts, uploaded images and generated videos.</p>
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
  </ul>
  <h2>Use material you have rights to</h2>
  <p>You must have the necessary rights and permissions for every upload. Photos of identifiable people must be your own likeness or used with their explicit permission; do not upload another person's photo without their consent. Ordinary lawful material depicting people is allowed when it meets these rules, but permission does not exempt any deepfake or impersonation described above. Do not submit confidential information. Model-provider restrictions also apply; generating a video does not guarantee commercial rights.</p>
  <h2>Review before delivery</h2>
  <p>New requests under this policy go through human review of the full prompt, model settings and every uploaded image before submission to the model provider, then the complete generated video before delivery. Tasks created before this review process was introduced keep their earlier delivery process, including tasks still in progress; we do not label them as reviewed under this policy. KakaReel's founder handles review and may decline a request or withhold a result that violates these rules. We do not promise an instant review or automated approval.</p>
  <p>For paid generation, credits remain reserved during review. An operator-recorded rejection or expiry of a pre-delivery review releases that reservation; reaching a review deadline alone does not release credits automatically. This is not described as a model failure. An unresolved model outcome is a separate issue and may require investigation. Reviews and decisions are recorded for accountability.</p>
  <h2>Report a problem or request a review</h2>
  <p>Email <a href="mailto:support@kakareel.com">support@kakareel.com</a> with the task ID if available, a description of the concern and any relevant rights or consent information. The founder records and investigates reports; you may use the same address to ask for reconsideration and provide additional evidence. Resolving a report does not automatically restore a result: a withheld result needs another review before release. Do not attach illegal imagery, passwords, API keys or payment-card details.</p>
  <p>We can pause processing of a reported task and hide its result within KakaReel while investigating. We cannot retract copies already downloaded or guarantee removal from a model provider. Contact us for privacy or deletion requests. Automatic deletion schedules are not currently implemented.</p>
  <p><a href="/support">Support and billing help</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
 </main><SiteFooter/></>;
}
