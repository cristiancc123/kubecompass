import { Hono } from "hono";
import { MAX_QUERY_LENGTH, type SearchBackend, type SearchQuery } from "./search.js";
import { renderPage } from "./ui.js";

export interface AppDependencies {
  search: SearchBackend;
}

const MAX_FILTER_LENGTH = 100;
const FILTER_PARAMS = ["day", "track", "level", "venue"] as const;
const LANDING_PAGE_SIZE = 10;

export type ParsedQuery = { ok: true; query: SearchQuery } | { ok: false; error: string };

/** Validates the search parameters from the URL. Never trusts lengths from the client. */
export function parseSearchQuery(params: Record<string, string | undefined>): ParsedQuery {
  const q = (params.q ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Query must be at most ${MAX_QUERY_LENGTH} characters` };
  }
  const query: SearchQuery = { q };
  for (const name of FILTER_PARAMS) {
    const value = params[name]?.trim();
    if (!value) continue;
    if (value.length > MAX_FILTER_LENGTH) {
      return { ok: false, error: `Filter ${name} is too long` };
    }
    query[name] = value;
  }
  if (params.size !== undefined && params.size !== "") {
    const size = Number(params.size);
    if (!Number.isInteger(size) || size < 1) {
      return { ok: false, error: "size must be a positive integer" };
    }
    query.size = size;
  }
  return { ok: true, query };
}

/**
 * Creates the HTTP application. Dependencies are injected so tests can run
 * the app without a live Elasticsearch connection.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    try {
      const reachable = await deps.search.ping();
      if (!reachable) {
        return c.json({ status: "degraded", elasticsearch: "unreachable" }, 503);
      }
      return c.json({ status: "ok", elasticsearch: "reachable" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ status: "degraded", elasticsearch: message }, 503);
    }
  });

  app.get("/api/search", async (c) => {
    const parsed = parseSearchQuery(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    try {
      return c.json(await deps.search.searchSessions(parsed.query));
    } catch (error) {
      console.error("search failed", error);
      return c.json({ error: "Search is temporarily unavailable" }, 502);
    }
  });

  app.get("/", async (c) => {
    const params = c.req.query();
    const parsed = parseSearchQuery(params);
    if (!parsed.ok) {
      return c.html(renderPage({ query: { q: "" }, result: null, error: parsed.error }), 400);
    }
    if (!("q" in params) && parsed.query.size === undefined) {
      // First visit: show the schedule in order with a short list, so the facets are populated.
      parsed.query.size = LANDING_PAGE_SIZE;
    }
    try {
      const result = await deps.search.searchSessions(parsed.query);
      return c.html(renderPage({ query: parsed.query, result }));
    } catch (error) {
      console.error("search failed", error);
      return c.html(
        renderPage({
          query: parsed.query,
          result: null,
          error: "Search is temporarily unavailable. Try again in a moment.",
        }),
        502,
      );
    }
  });

  return app;
}
