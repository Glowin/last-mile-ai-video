import assert from "node:assert/strict";
import { test } from "node:test";
import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Terms from "../src/app/terms/page";
import Privacy from "../src/app/privacy/page";
import Support from "../src/app/support/page";
import AcceptableUse from "../src/app/acceptable-use/page";

// Render the real page content without mounting unrelated account/navigation
// components. No browser, provider transport or server configuration is needed.
function pageContent(Page: typeof Terms) {
  const main = Children.toArray(Page().props.children)
    .find((child) => isValidElement(child) && child.type === "main");
  assert.ok(isValidElement(main));
  const html = renderToStaticMarkup(main);
  return { html, text: html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ") };
}

for (const [name, Page] of [["Terms", Terms], ["Privacy", Privacy], ["Help", Support], ["Acceptable use", AcceptableUse]] as const) {
  test(`${name} discloses conditional rollout, text-only checks and unreviewed MVP media`, () => {
    const { text, html } = pageContent(Page);
    assert.match(text, /When the unattended MVP is enabled for a new task/);
    assert.match(text, /prompt.*Waffo Pancake.*automated text check/);
    assert.match(text, /[Rr]eference images and generated videos.*not individually human-reviewed or automatically moderated/);
    assert.match(text, /text check.*(does not approve|not approval of) an image or video/);
    assert.match(text, /[Tt]echnical delivery verification.*(not whether its content is safe|not a content safety check|not content safety)/);
    assert.match(text, /[Ee]xisting tasks keep their recorded process/);
    assert.match(html, /support@kakareel\.com|href="\/support"/);
    assert.doesNotMatch(text, /An automated prompt safety scanner is not currently in use|New requests under this policy go through human review/);
  });
}

test("terms and acceptable-use retain age, deepfake and other content restrictions", () => {
  const terms = pageContent(Terms).text;
  assert.match(terms, /at least 18 years old/);
  assert.match(terms, /including preview and guest access/);
  const { text, html } = pageContent(AcceptableUse);
  for (const restriction of [
    /Pornography, sexually explicit or NSFW/, /Violence or gore/, /Hate speech/,
    /Child sexual abuse material/, /Deepfakes or impersonation of real people/,
    /prohibited even with the person's consent/, /Copyright or trademark infringement/,
    /terrorism, violent extremism or mass harm/, /Other illegal content, fraud, privacy violations/,
    /Attempts to bypass content review/, /AI-generated content as authentic footage/,
    /necessary rights and permissions for every upload/, /Model-provider restrictions also apply/,
  ]) assert.match(text, restriction);
  assert.match(text, /All the restrictions above still apply to every input and output/);
  for (const anchor of ["enforcement", "report", "response-times", "appeal"]) assert.match(html, new RegExp(`id="${anchor}"`));
});

test("help distinguishes automated confirmation, technical delivery and historical human holds", () => {
  const { text } = pageContent(Support);
  for (const label of ["Safety check in progress", "Safety check pending confirmation", "Generating", "Confirming result", "Ready"])
    assert.ok(text.includes(label));
  assert.match(text, /does not mean an operator must approve/);
  assert.match(text, /fixed time limit and the check may expire/);
  assert.doesNotMatch(text, /will be checked again/);
  assert.match(text, /Refresh history or recover the existing task/);
  assert.match(text, /any reserved credits are released/);
  assert.match(text, /still shows reserved credits, refresh history or contact support/);
  assert.match(text, /legacy input or output review can still hold/);
  assert.doesNotMatch(text, /Download your approved videos/);
});

test("privacy retains full-prompt storage, legacy records and nonzero retention disclosures", () => {
  const { text } = pageContent(Privacy);
  assert.match(text, /store full prompts, settings, task status/);
  assert.match(text, /Clearing an operational payload does not delete the full prompt/);
  assert.match(text, /do not promise zero retention by KakaReel, Waffo Pancake or model providers/);
  assert.match(text, /reference image and generated video are not sent through this text check/);
  assert.match(text, /do not have an automatic deletion schedule/);
  assert.match(text, /We do not send your prompts, uploaded images.*to Analytics/);
});

test("policy rollout does not change the published offer or imply Waffo approved it", () => {
  const { text } = pageContent(Terms);
  assert.match(text, /Packs are not yet on sale/);
  assert.match(text, /US\$19 before applicable taxes and includes 150 credits/);
  assert.match(text, /one-time purchase: no subscription, automatic renewal, or expiry date/);
  assert.match(text, /wholly unused pack is eligible for a refund within 14 days/);
  assert.match(text, /partially used pack is not eligible/);
  assert.match(pageContent(AcceptableUse).text, /not a claim that Waffo has approved KakaReel's policy or this change/);
});
