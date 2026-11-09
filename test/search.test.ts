import { describe, expect, it } from "vitest";
import {
  buildFilters,
  buildSearchRequest,
  clampSize,
  DEFAULT_SIZE,
  facetAggregations,
  MAX_SIZE,
} from "../src/search.js";
import { escapeHtml, formatDay, formatSlot, truncate } from "../src/ui.js";

describe("clampSize", () => {
  it("defaults, floors and clamps", () => {
    expect(clampSize(undefined)).toBe(DEFAULT_SIZE);
    expect(clampSize(Number.NaN)).toBe(DEFAULT_SIZE);
    expect(clampSize(0)).toBe(1);
    expect(clampSize(7.9)).toBe(7);
    expect(clampSize(10_000)).toBe(MAX_SIZE);
  });
});

describe("buildFilters", () => {
  it("emits one term clause per non-empty filter", () => {
    expect(buildFilters({ day: "2026-11-10", track: " Security ", level: "", venue: undefined })).toEqual([
      { term: { day: "2026-11-10" } },
      { term: { track: "Security" } },
    ]);
  });
});

describe("facetAggregations", () => {
  it("counts each facet under the other filters but not its own", () => {
    const aggs = facetAggregations({ track: "Security", day: "2026-11-10" }).facets.aggs ?? {};
    expect(aggs.track.filter).toEqual({ bool: { filter: [{ term: { day: "2026-11-10" } }] } });
    expect(aggs.day.filter).toEqual({ bool: { filter: [{ term: { track: "Security" } }] } });
    expect(aggs.level.filter).toEqual({
      bool: { filter: [{ term: { day: "2026-11-10" } }, { term: { track: "Security" } }] },
    });
    expect(aggs.track.aggs?.values.terms?.field).toBe("track");
  });
});

describe("buildSearchRequest", () => {
  it("browses in schedule order when there is no text", () => {
    const request = buildSearchRequest("sessions", { q: "  ", day: "2026-11-10" });
    expect(request.index).toBe("sessions");
    expect(request.size).toBe(DEFAULT_SIZE);
    expect(request.query).toEqual({ bool: { filter: [{ term: { day: "2026-11-10" } }] } });
    expect(request.sort).toEqual([{ start: "asc" }]);
    expect(request.retriever).toBeUndefined();
    expect(request.aggs?.facets?.global).toEqual({});
    expect(request._source).not.toContain("content");
  });

  it("fuses lexical and semantic retrievers with RRF when there is text", () => {
    const request = buildSearchRequest("sessions", { q: "eBPF security", level: "Advanced", size: 5 });
    expect(request.size).toBe(5);
    expect(request.sort).toBeUndefined();
    const rrf = request.retriever?.rrf;
    expect(rrf?.retrievers).toHaveLength(2);
    const [lexical, semantic] = rrf?.retrievers ?? [];
    expect(JSON.stringify(lexical)).toContain('"multi_match"');
    expect(JSON.stringify(lexical)).toContain('"title^3"');
    expect(JSON.stringify(semantic)).toContain('"semantic":{"field":"content","query":"eBPF security"}');
    for (const retriever of [lexical, semantic]) {
      expect(JSON.stringify(retriever)).toContain('"filter":[{"term":{"level":"Advanced"}}]');
    }
  });
});

describe("ui helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });

  it("formats slots and days in Mountain Time", () => {
    expect(formatSlot("2026-11-10T14:50:00-07:00", "2026-11-10T15:25:00-07:00")).toBe(
      "Tue, Nov 10, 2:50 PM to 3:25 PM MST",
    );
    expect(formatSlot("", "")).toBe("Time to be announced");
    expect(formatDay("2026-11-09")).toBe("Mon, Nov 9");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const text = "alpha beta gamma delta epsilon";
    expect(truncate(text, 100)).toBe(text);
    expect(truncate(text, 12)).toBe("alpha beta…");
  });
});
