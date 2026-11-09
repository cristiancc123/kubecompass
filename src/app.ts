import { httpInstrumentationMiddleware } from "@hono/otel";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { log } from "./log.js";
import { renderPeopleForm, renderPeopleMessage, renderProfile } from "./people-ui.js";
import { parseAttendeeInput, type PeopleBackend } from "./people.js";
import { MAX_QUERY_LENGTH, type SearchBackend, type SearchQuery } from "./search.js";
import { SERVICE_NAME } from "./telemetry.js";
import { renderPage } from "./ui.js";

export interface AppDependencies {
  search: SearchBackend;
  people: PeopleBackend;
  /** Reported by /healthz so a deploy can be matched to its image tag. */
  version?: string;
}

const MAX_FILTER_LENGTH = 100;
const FILTER_PARAMS = ["day", "track", "level", "venue"] as const;
const LANDING_PAGE_SIZE = 10;
const TALKS_PER_PROFILE = 5;
/** The sign-up form is three short fields; anything bigger is not from it. */
const MAX_FORM_BYTES = 4 * 1024;

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

  // Spans and HTTP server metrics for every request. The query string holds
  // what people searched for, so traces keep the path only.
  app.use(
    httpInstrumentationMiddleware({
      serviceName: SERVICE_NAME,
      serviceVersion: deps.version,
      getUrlFull: (c) => {
        const url = new URL(c.req.url);
        return `${url.origin}${url.pathname}`;
      },
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok", version: deps.version ?? "dev" }));

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
      log.error("search failed", error);
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
      log.error("search failed", error);
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

  app.get("/people", (c) => c.html(renderPeopleForm()));

  app.post(
    "/people",
    bodyLimit({
      maxSize: MAX_FORM_BYTES,
      onError: (c) => c.html(renderPeopleForm({ error: "That form is too large." }), 413),
    }),
    async (c) => {
      const form = await c.req.parseBody();
      const parsed = parseAttendeeInput(form);
      if (!parsed.ok) {
        const values = {
          name: String(form.name ?? ""),
          interests: String(form.interests ?? ""),
          contact: String(form.contact ?? ""),
        };
        return c.html(renderPeopleForm({ values, error: parsed.error }), 400);
      }
      try {
        const attendee = await deps.people.createAttendee(parsed.input);
        // Post/redirect/get, so a reload doesn't create the profile twice.
        return c.redirect(`/people/${attendee.id}?created=1`, 303);
      } catch (error) {
        log.error("create attendee failed", error);
        return c.html(
          renderPeopleForm({ values: parsed.input, error: "Saving your profile failed. Try again in a moment." }),
          502,
        );
      }
    },
  );

  app.get("/people/:id", async (c) => {
    let attendee;
    try {
      attendee = await deps.people.getAttendee(c.req.param("id"));
    } catch (error) {
      log.error("get attendee failed", error);
      return c.html(renderPeopleMessage("Profiles are temporarily unavailable. Try again in a moment."), 502);
    }
    if (!attendee) {
      return c.html(renderPeopleMessage("This profile doesn't exist, or it was deleted."), 404);
    }
    // Matches and talks are independent: one failing still shows the other.
    const [matches, talks] = await Promise.all([
      deps.people.findMatches(attendee).catch((error: unknown) => {
        log.error("find matches failed", error);
        return null;
      }),
      deps.search
        .searchSessions({ q: attendee.interests, size: TALKS_PER_PROFILE })
        .then((result) => result.hits)
        .catch((error: unknown) => {
          log.error("talk suggestions failed", error);
          return null;
        }),
    ]);
    return c.html(renderProfile({ attendee, matches, talks, created: c.req.query("created") === "1" }));
  });

  app.post("/people/:id/delete", async (c) => {
    try {
      const deleted = await deps.people.deleteAttendee(c.req.param("id"));
      const message = deleted
        ? "Your profile is deleted. Thanks for joining the hallway track."
        : "This profile doesn't exist, or it was already deleted.";
      return c.html(renderPeopleMessage(message), deleted ? 200 : 404);
    } catch (error) {
      log.error("delete attendee failed", error);
      return c.html(renderPeopleMessage("Deleting failed. Try again in a moment."), 502);
    }
  });

  return app;
}
