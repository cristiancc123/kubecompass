import axe from "axe-core";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAskBackend } from "../src/ask.js";
import type { SearchBackend, SessionHit } from "../src/search.js";
import { alwaysReady, fakePeople, SAMPLE_ID } from "./fakes.js";

const hit: SessionHit = {
  id: "1",
  title: "Tracing at Scale",
  url: "https://example.org/1",
  room: "Salt Palace | Level 1 | Grand Ballroom ACE",
  venue: "Salt Palace",
  start: "2026-11-10T14:50:00-07:00",
  end: "2026-11-10T15:25:00-07:00",
  day: "2026-11-10",
  track: "Observability",
  level: "Any Level",
  tags: ["End User Talk"],
  speakers: "Felipe Araujo & Kaynan Coelho, Nubank",
  description: "How Nubank runs a 16 billion spans per hour pipeline.",
  links: [],
  score: 0.9,
};

const search: SearchBackend = {
  ping: async () => true,
  searchSessions: async (query) => ({
    mode: query.q ? "hybrid" : "browse",
    total: 1,
    took: 5,
    hits: [hit],
    facets: {
      day: [{ value: "2026-11-10", count: 1 }],
      track: [{ value: "Observability", count: 1 }],
      level: [{ value: "Any Level", count: 1 }],
      venue: [{ value: "Salt Palace", count: 1 }],
    },
  }),
};

const empty: SearchBackend = {
  ...search,
  searchSessions: async () => ({
    mode: "hybrid",
    total: 0,
    took: 1,
    hits: [],
    facets: { day: [], track: [], level: [], venue: [] },
  }),
};

const ask = createAskBackend(search, {
  generate: async () => ({ text: "Start with Tracing at Scale [1].", refused: false }),
});

/**
 * Every page state a visitor can reach, rendered by the real app. jsdom has no
 * layout, so color contrast is checked in a browser instead (see README).
 */
const pages: Array<[string, () => ReturnType<typeof createApp>, string, RequestInit?]> = [
  ["talks landing", () => createApp({ search, people: fakePeople(), readiness: alwaysReady }), "/"],
  [
    "talks results",
    () => createApp({ search, people: fakePeople(), readiness: alwaysReady }),
    "/?q=tracing&day=2026-11-10",
  ],
  ["talks no results", () => createApp({ search: empty, people: fakePeople(), readiness: alwaysReady }), "/?q=cooking"],
  ["talks error", () => createApp({ search, people: fakePeople(), readiness: alwaysReady }), `/?q=${"x".repeat(301)}`],
  ["ask form", () => createApp({ search, people: fakePeople(), readiness: alwaysReady, ask }), "/ask"],
  ["ask answer", () => createApp({ search, people: fakePeople(), readiness: alwaysReady, ask }), "/ask?q=tracing"],
  ["ask not configured", () => createApp({ search, people: fakePeople(), readiness: alwaysReady }), "/ask"],
  ["people form", () => createApp({ search, people: fakePeople(), readiness: alwaysReady }), "/people"],
  [
    "people form error",
    () => createApp({ search, people: fakePeople(), readiness: alwaysReady }),
    "/people",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Ana&interests=k8s",
    },
  ],
  [
    "profile",
    () => createApp({ search, people: fakePeople(), readiness: alwaysReady }),
    `/people/${SAMPLE_ID}?created=1`,
  ],
  ["profile not found", () => createApp({ search, people: fakePeople(), readiness: alwaysReady }), "/people/unknown"],
];

async function audit(html: string): Promise<axe.Result[]> {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(axe.source);
  const runner = (dom.window as unknown as { axe: typeof axe }).axe;
  const results = await runner.run(dom.window.document, {
    rules: { "color-contrast": { enabled: false } },
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
  });
  dom.window.close();
  return results.violations;
}

describe("accessibility (axe-core, WCAG 2.2 AA and best practices)", () => {
  it("catches a known violation, so a pass means something", async () => {
    const violations = await audit(
      '<!doctype html><html lang="en"><head><title>t</title></head><body><main><input></main></body></html>',
    );
    expect(violations.map((v) => v.id)).toContain("label");
  });

  for (const [name, makeApp, path, init] of pages) {
    it(`has no violations: ${name}`, async () => {
      const html = await (await makeApp().request(path, init)).text();
      const violations = await audit(html);
      expect(
        violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
      ).toEqual([]);
    });
  }
});
