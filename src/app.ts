import { httpInstrumentationMiddleware } from "@hono/otel";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { renderAskPage } from "./ask-ui.js";
import { MAX_QUESTION_LENGTH, type AskBackend } from "./ask.js";
import { log } from "./log.js";
import { renderPeopleForm, renderPeopleMessage, renderProfile } from "./people-ui.js";
import type { Readiness } from "./readiness.js";
import { redactUrl } from "./redact.js";
import { pickLanguage, pickLevel, renderStudyPage } from "./study-ui.js";
import type { StudyBackend } from "./study.js";
import { parseAttendeeInput, type PeopleBackend } from "./people.js";
import { MAX_QUERY_LENGTH, type SearchBackend, type SearchQuery } from "./search.js";
import { SERVICE_NAME } from "./telemetry.js";
import { renderPage } from "./ui.js";

export interface AppDependencies {
  search: SearchBackend;
  people: PeopleBackend;
  readiness: Readiness;
  /** Absent when no model is configured; /ask then explains that. */
  ask?: AskBackend;
  /** Shared budget for /ask and study guides. Each one costs a model call. */
  askLimiter?: { tryAcquire(): boolean };
  /** Absent when no model is configured; the study page then says so. */
  study?: StudyBackend;
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
  // what people searched for and profile ids grant access, so neither leaves.
  app.use(
    httpInstrumentationMiddleware({
      serviceName: SERVICE_NAME,
      serviceVersion: deps.version,
      getUrlFull: (c) => redactUrl(c.req.url),
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok", version: deps.version ?? "dev" }));

  // Answers from the background check in src/readiness.ts: no remote call
  // per probe, so a slow Elasticsearch round trip can't time the probe out.
  app.get("/readyz", (c) =>
    deps.readiness.isReady()
      ? c.json({ status: "ok", elasticsearch: "reachable" })
      : c.json({ status: "degraded", elasticsearch: "unreachable" }, 503),
  );

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

  app.get("/ask", async (c) => {
    const question = (c.req.query("q") ?? "").trim();
    const available = deps.ask !== undefined;
    if (!available || !question) {
      if (!available) {
        // Says why in the trace, so a 503 here isn't mistaken for an outage.
        trace.getActiveSpan()?.setAttribute("kubecompass.ask.refused_reason", "not_configured");
      }
      return c.html(renderAskPage({ question, available }), available ? 200 : 503);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      const error = `Questions must be at most ${MAX_QUESTION_LENGTH} characters.`;
      return c.html(renderAskPage({ question: question.slice(0, MAX_QUESTION_LENGTH), error, available }), 400);
    }
    if (deps.askLimiter && !deps.askLimiter.tryAcquire()) {
      trace.getActiveSpan()?.setAttribute("kubecompass.ask.refused_reason", "rate_limited");
      const error = "Lots of questions right now. Try again in a minute, or search the talks directly.";
      return c.html(renderAskPage({ question, error, available }), 429);
    }
    try {
      const result = await deps.ask!.ask(question);
      return c.html(renderAskPage({ question, result, available }));
    } catch (error) {
      log.error("ask failed", error);
      const message = "The assistant is temporarily unavailable. Try again in a moment, or search the talks directly.";
      return c.html(renderAskPage({ question, error: message, available }), 502);
    }
  });

  app.get("/talks/:id/study", async (c) => {
    if (!deps.study) {
      trace.getActiveSpan()?.setAttribute("kubecompass.study.refused_reason", "not_configured");
      return c.html(renderPeopleMessage("The study assistant is not configured on this deployment."), 503);
    }
    let session;
    try {
      session = await deps.study.getSession(c.req.param("id"));
    } catch (error) {
      log.error("get session failed", error);
      return c.html(renderPeopleMessage("Sessions are temporarily unavailable. Try again in a moment."), 502);
    }
    if (!session) {
      return c.html(renderPeopleMessage("This session doesn't exist. Search the talks to find it."), 404);
    }
    const level = pickLevel(c.req.query("level"));
    const language = pickLanguage(c.req.query("lang"), c.req.header("accept-language"));
    const page = { session, level, language, available: true };
    // Generating costs a model call, so it only happens when the form is submitted.
    if (c.req.query("go") !== "1") {
      return c.html(renderStudyPage(page));
    }
    if (deps.askLimiter && !deps.askLimiter.tryAcquire()) {
      trace.getActiveSpan()?.setAttribute("kubecompass.study.refused_reason", "rate_limited");
      return c.html(renderStudyPage({ ...page, error: "Lots of requests right now. Try again in a minute." }), 429);
    }
    try {
      const result = await deps.study.study(session, level, language);
      return c.html(renderStudyPage({ ...page, result }));
    } catch (error) {
      log.error("study failed", error);
      return c.html(
        renderStudyPage({ ...page, error: "The study assistant is temporarily unavailable. Try again in a moment." }),
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
