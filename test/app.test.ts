import { describe, expect, it, vi } from "vitest";
import { createApp, parseSearchQuery } from "../src/app.js";
import type { SearchBackend, SearchQuery, SearchResult } from "../src/search.js";

const emptyFacets = { day: [], track: [], level: [], venue: [] };

function sampleResult(query: SearchQuery): SearchResult {
  return {
    mode: query.q ? "hybrid" : "browse",
    total: 1,
    took: 7,
    hits: [
      {
        id: "1",
        title: "Tracing at Scale <script>alert(1)</script>",
        url: "https://example.org/?id=1",
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
      },
    ],
    facets: {
      ...emptyFacets,
      day: [{ value: "2026-11-10", count: 1 }],
      track: [{ value: "Observability", count: 1 }],
    },
  };
}

function fakeBackend(overrides: Partial<SearchBackend> = {}): SearchBackend {
  return {
    ping: async () => true,
    searchSessions: async (query) => sampleResult(query),
    ...overrides,
  };
}

describe("probes", () => {
  it("answers the liveness probe", async () => {
    const res = await createApp({ search: fakeBackend() }).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports readiness when Elasticsearch answers", async () => {
    const res = await createApp({ search: fakeBackend() }).request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", elasticsearch: "reachable" });
  });

  it("reports degraded readiness when the ping resolves to false", async () => {
    const res = await createApp({ search: fakeBackend({ ping: async () => false }) }).request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", elasticsearch: "unreachable" });
  });

  it("reports degraded readiness when Elasticsearch throws", async () => {
    const backend = fakeBackend({
      ping: async () => {
        throw new Error("connection refused");
      },
    });
    const res = await createApp({ search: backend }).request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", elasticsearch: "connection refused" });
  });
});

describe("parseSearchQuery", () => {
  it("trims text and keeps only known filters", () => {
    const parsed = parseSearchQuery({ q: "  eBPF  ", day: "2026-11-10", bogus: "x", size: "5" });
    expect(parsed).toEqual({ ok: true, query: { q: "eBPF", day: "2026-11-10", size: 5 } });
  });

  it("rejects over-long text, over-long filters and bad sizes", () => {
    expect(parseSearchQuery({ q: "x".repeat(301) }).ok).toBe(false);
    expect(parseSearchQuery({ track: "x".repeat(101) }).ok).toBe(false);
    expect(parseSearchQuery({ size: "0" }).ok).toBe(false);
    expect(parseSearchQuery({ size: "abc" }).ok).toBe(false);
  });
});

describe("GET /api/search", () => {
  it("returns the backend result as JSON", async () => {
    const searchSessions = vi.fn(async (query: SearchQuery) => sampleResult(query));
    const res = await createApp({ search: fakeBackend({ searchSessions }) }).request(
      "/api/search?q=tracing&track=Observability",
    );
    expect(res.status).toBe(200);
    expect(searchSessions).toHaveBeenCalledWith({ q: "tracing", track: "Observability" });
    const body = (await res.json()) as SearchResult;
    expect(body.mode).toBe("hybrid");
    expect(body.hits[0].title).toContain("Tracing at Scale");
  });

  it("rejects invalid input with 400", async () => {
    const res = await createApp({ search: fakeBackend() }).request(`/api/search?q=${"x".repeat(301)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("300") });
  });

  it("maps backend failures to 502 without leaking details", async () => {
    const backend = fakeBackend({
      searchSessions: async () => {
        throw new Error("secret internal detail");
      },
    });
    const res = await createApp({ search: backend }).request("/api/search?q=x");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret internal detail");
  });
});

describe("GET /", () => {
  it("renders results with escaped HTML and Mountain Time slots", async () => {
    const res = await createApp({ search: fakeBackend() }).request("/?q=tracing&track=Observability");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Tue, Nov 10, 2:50 PM to 3:25 PM MST");
    expect(html).toContain("Felipe Araujo &amp; Kaynan Coelho, Nubank");
    expect(html).toContain('<option value="Observability" selected');
  }, 10_000);

  it("shows a short schedule on the landing page", async () => {
    const searchSessions = vi.fn(async (query: SearchQuery) => sampleResult(query));
    const res = await createApp({ search: fakeBackend({ searchSessions }) }).request("/");
    expect(res.status).toBe(200);
    expect(searchSessions).toHaveBeenCalledWith({ q: "", size: 10 });
  });

  it("renders an error banner when search is unavailable", async () => {
    const backend = fakeBackend({
      searchSessions: async () => {
        throw new Error("boom");
      },
    });
    const res = await createApp({ search: backend }).request("/?q=x");
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('role="alert"');
  });
});
