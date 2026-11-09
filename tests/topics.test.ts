import assert from "node:assert/strict";
import test from "node:test";
import { getFamily, ratios } from "../src/lib/models";
import { getTopic, topicStaticParams, topics } from "../src/lib/topics";
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

test("topic prompts use studio models, durations, and text aspect ratios", () => {
  const topic = getTopic("ai-chairman-spy-romance");
  assert.ok(topic);
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
        ratios(variant.modelSlug, "text").includes(variant.aspect),
        `${prompt.id} ${variant.aspect}`,
      );
      assert.ok(
        prompt.prompt.length <= family.maxPrompt,
        `${prompt.id} is ${prompt.prompt.length} chars`,
      );
    }
  }
});

test("fiction disclaimer and acceptable-use links stay on the topic", () => {
  const topic = getTopic("ai-chairman-spy-romance");
  assert.ok(topic);
  assert.match(topic.hero.disclaimer, /\/acceptable-use/);
  assert.match(topic.cta.footnote, /\/acceptable-use/);
  assert.match(topic.hero.disclaimer, /FableX: MLAT-AI/);
  assert.match(topic.hero.disclaimer, /Veil Consortium/);
  assert.match(topic.tickerNote, /not a real listing/);
  assert.match(topic.world, /Meridian Lattice AI/);
  assert.equal(topic.seo.keywords.some((keyword) => /[\u4e00-\u9fff]/.test(keyword)), false);
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
