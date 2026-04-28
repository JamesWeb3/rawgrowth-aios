import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScrapeSources } from "../../src/lib/scrape/sources";

function intake(social: Record<string, unknown>, competitors: Record<string, unknown> = {}) {
  return {
    social_presence: social,
    competitors,
  };
}

test("empty intake -> empty list", () => {
  assert.deepEqual(buildScrapeSources({}), []);
});

test("instagram handle with @ normalized", () => {
  const out = buildScrapeSources(intake({ instagram: "@rawgrowth" }));
  const ig = out.find((s) => s.url.includes("instagram.com"));
  assert.ok(ig);
  assert.equal(ig!.url, "https://www.instagram.com/rawgrowth/");
});

test("instagram full URL preserved", () => {
  const out = buildScrapeSources(intake({ instagram: "https://www.instagram.com/rawgrowth/" }));
  const ig = out.find((s) => s.url.includes("instagram.com"));
  assert.equal(ig!.url, "https://www.instagram.com/rawgrowth/");
});

test("linkedin company routes to /about", () => {
  const out = buildScrapeSources(intake({ linkedin: "company/rawgrowth" }));
  const li = out.find((s) => s.url.includes("linkedin.com"));
  assert.ok(li!.url.endsWith("/about/"));
});

test("youtube channel id -> RSS", () => {
  const out = buildScrapeSources(intake({ youtube: "channel/UC12345" }));
  const yt = out.find((s) => s.url.includes("youtube.com"));
  assert.match(yt!.url, /feeds\/videos\.xml\?channel_id=UC12345/);
});

test("youtube @handle -> videos page", () => {
  const out = buildScrapeSources(intake({ youtube: "@rawgrowth" }));
  const yt = out.find((s) => s.url.includes("youtube.com"));
  assert.match(yt!.url, /\/@rawgrowth\/videos/);
});

test("website bare domain gets https prefix", () => {
  const out = buildScrapeSources(intake({ website: "rawgrowth.ai" }));
  const site = out.find((s) => s.kind === "site");
  assert.equal(site!.url, "https://rawgrowth.ai");
});

test("competitors list clipped to 3", () => {
  const out = buildScrapeSources(
    intake(
      {},
      { competitor_list: ["a.com", "b.com", "c.com", "d.com", "e.com"] },
    ),
  );
  const competitors = out.filter((s) => s.kind === "competitor");
  assert.equal(competitors.length, 3);
});

test("competitors as comma string parsed", () => {
  const out = buildScrapeSources(
    intake({}, { competitor_list: "a.com, b.com\nc.com" }),
  );
  const competitors = out.filter((s) => s.kind === "competitor");
  assert.equal(competitors.length, 3);
});

test("empty strings filtered out", () => {
  const out = buildScrapeSources(
    intake({}, { competitor_list: ["", "  ", "a.com"] }),
  );
  const competitors = out.filter((s) => s.kind === "competitor");
  assert.equal(competitors.length, 1);
  assert.equal(competitors[0].url, "https://a.com");
});
