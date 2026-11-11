import assert from "node:assert/strict";
import test from "node:test";
import { getFamily, ratios } from "../src/lib/models";
import { getTopic, topicStaticParams, topicStudioHref, topics } from "../src/lib/topics";
import sitemap from "../src/app/sitemap";

test("the chairman spy romance topic is registered once", () => {
  assert.deepEqual(
    topics.map((topic) => topic.slug),
    ["ai-chairman-spy-romance"],
  );
  assert.equal(getTopic("ai-chairman-spy-romance")?.slug, "ai-chairman-spy-romance");
  assert.equal(getTopic("missing"), undefined);
  assert.deepEqual(topicStaticParams(), [{ slug: "ai-chairman-spy-romance" }]);
});

test("topic prompts use studio models, durations, and mode-specific aspect ratios", () => {
  const topic = getTopic("ai-chairman-spy-romance");
  assert.ok(topic);
  assert.equal(topic.featuredPromptId, "ep03-image");
  assert.ok(topic.prompts.some((prompt) => prompt.id === topic.featuredPromptId));
  for (const prompt of topic.prompts) {
    assert.ok(prompt.prompt.length > 40);
    for (const variant of prompt.variants) {
      const family = getFamily(variant.modelSlug);
      assert.ok(family, variant.modelSlug);
      assert.ok(
        (family.durations as readonly number[]).includes(variant.durationSeconds),
        `${prompt.id} ${variant.durationSeconds}s`,
      );
      assert.ok(
        ratios(variant.modelSlug, prompt.mode).includes(variant.aspect),
        `${prompt.id} (${prompt.mode}) ${variant.aspect}`,
      );
      assert.ok(
        prompt.prompt.length <= family.maxPrompt,
        `${prompt.id} is ${prompt.prompt.length} chars`,
      );
    }
  }
});

test("topic SEO metadata, riverfront restaurant photo details, and acceptable-use links are present", () => {
  const topic = getTopic("ai-chairman-spy-romance");
  assert.ok(topic);
  assert.match(topic.seo.title, /Jensen Huang/);
  assert.match(topic.seo.title, /Alice Huang/);
  assert.match(topic.seo.title, /黄仁勋/);
  assert.match(topic.seo.title, /黄乐/);
  assert.match(topic.seo.description, /Huang Le/);
  assert.ok(topic.seo.keywords.includes("Jensen Huang Alice Huang"));
  assert.ok(topic.seo.keywords.includes("黄仁勋 黄乐"));
  assert.match(topic.scene.place, /upside-down red '福' diamond/);
  assert.match(topic.scene.positioning, /across-the-table candid POV/i);
  assert.match(topic.hero.disclaimer, /\/acceptable-use/);
  assert.match(topic.cta.footnote, /\/acceptable-use/);
  assert.match(topic.hero.disclaimer, /FableX: MLAT-AI/);
  assert.match(topic.hero.disclaimer, /Veil Consortium/);
  assert.match(topic.tickerNote, /not a real listing/);
  assert.match(topic.world, /Meridian Lattice AI/);
});

test("topicStudioHref pre-fills studio model, image mode, and prompt", () => {
  assert.equal(
    topicStudioHref("minimax", "image", "Animate riverfront toast"),
    "/create?model=minimax&mode=image&prompt=Animate+riverfront+toast",
  );
  assert.equal(
    topicStudioHref("seedance", "text"),
    "/create?model=seedance",
  );
});

test("sitemap includes the topic path when APP_URL is set", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://kakareel.com";
  try {
    const urls = sitemap().map((entry) => entry.url);
    assert.ok(urls.includes("https://kakareel.com/topics/ai-chairman-spy-romance"));
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
