import { randomUUID } from "node:crypto";
import type { Client, estypes } from "@elastic/elasticsearch";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { AttendedTalk } from "./badges.js";
import { redactIds } from "./redact.js";

export const MAX_NAME_LENGTH = 60;
export const MIN_INTERESTS_LENGTH = 10;
export const MAX_INTERESTS_LENGTH = 500;
export const MAX_CONTACT_LENGTH = 100;
export const MATCH_COUNT = 5;

/** What an attendee types into the hallway-track form. */
export interface AttendeeInput {
  name: string;
  /** Free text: what they work on and want to talk about. */
  interests: string;
  /** How to reach them, shown as plain text to people they match with. */
  contact: string;
}

export interface Attendee extends AttendeeInput {
  /** Random UUID. The profile URL is the only way to see or delete a profile. */
  id: string;
  created: string;
  /** Demo profiles seeded for the hackathon, labelled as such in the UI. */
  sample: boolean;
  /** Talks checked in to, which earn badges. Missing on profiles created before badges. */
  attended?: AttendedTalk[];
}

/** Another attendee as shown in someone's matches: no id, so nobody can open or delete it. */
export type AttendeeMatch = Omit<Attendee, "id" | "created" | "attended">;

export type CheckInResult = "checked_in" | "already" | "not_found" | "sample";

export interface PeopleBackend {
  createAttendee(input: AttendeeInput): Promise<Attendee>;
  getAttendee(id: string): Promise<Attendee | null>;
  deleteAttendee(id: string): Promise<boolean>;
  /** Adds a talk to the attendee's check-ins. Sample profiles can't check in. */
  checkIn(id: string, talk: AttendedTalk): Promise<CheckInResult>;
  findMatches(attendee: Attendee): Promise<AttendeeMatch[]>;
}

export const ATTENDEE_MAPPINGS: estypes.MappingTypeMapping = {
  properties: {
    id: { type: "keyword" },
    name: { type: "text" },
    interests: { type: "text" },
    contact: { type: "keyword", index: false },
    created: { type: "date" },
    sample: { type: "boolean" },
    profile: { type: "semantic_text" },
  },
};

export type ParsedAttendee = { ok: true; input: AttendeeInput } | { ok: false; error: string };

/** Validates the form fields. Lengths are checked here, never trusted from the browser. */
export function parseAttendeeInput(form: Record<string, unknown>): ParsedAttendee {
  const text = (key: string) => (typeof form[key] === "string" ? (form[key] as string).trim() : "");
  const input = { name: text("name"), interests: text("interests"), contact: text("contact") };
  if (!input.name) {
    return { ok: false, error: "Add a name so people know who to look for." };
  }
  if (input.name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (input.interests.length < MIN_INTERESTS_LENGTH) {
    return { ok: false, error: `Describe your interests in at least ${MIN_INTERESTS_LENGTH} characters.` };
  }
  if (input.interests.length > MAX_INTERESTS_LENGTH) {
    return { ok: false, error: `Interests must be at most ${MAX_INTERESTS_LENGTH} characters.` };
  }
  if (input.contact.length > MAX_CONTACT_LENGTH) {
    return { ok: false, error: `Contact must be at most ${MAX_CONTACT_LENGTH} characters.` };
  }
  return { ok: true, input };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAttendeeId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * People who share the attendee's interests: a lexical match on the interests
 * text and a semantic match on the profile, fused with RRF like talk search.
 * The attendee never matches themselves.
 */
export function buildMatchRequest(index: string, attendee: Attendee): estypes.SearchRequest {
  const notSelf: estypes.QueryDslQueryContainer[] = [{ term: { id: attendee.id } }];
  return {
    index,
    size: MATCH_COUNT,
    _source: ["name", "interests", "contact", "sample"],
    retriever: {
      rrf: {
        retrievers: [
          {
            standard: {
              query: {
                bool: {
                  must: [{ match: { interests: { query: attendee.interests, fuzziness: "AUTO" } } }],
                  must_not: notSelf,
                },
              },
            },
          },
          {
            standard: {
              query: {
                bool: { must: [{ semantic: { field: "profile", query: attendee.interests } }], must_not: notSelf },
              },
            },
          },
        ],
        rank_window_size: 50,
        rank_constant: 60,
      },
    },
  };
}

/**
 * Requests that address a profile by id skip the Elasticsearch client's own
 * span, which would record the id as db.operation.parameter.id. The id is the
 * only key to a profile, so it must not reach the telemetry backend. Our own
 * spans around these calls carry no id.
 */
export const UNTRACED = { openTelemetry: { enabled: false } } as const;

function isNotFound(error: unknown): boolean {
  return (error as { meta?: { statusCode?: number } } | null)?.meta?.statusCode === 404;
}

/** Wraps the attendees index behind the PeopleBackend interface. */
export function createPeopleBackend(es: Client, index: string): PeopleBackend {
  const tracer = trace.getTracer("kubecompass.people");

  /** Runs `work` in a span. Exceptions are recorded with profile ids scrubbed. */
  function traced<T>(name: string, work: (span: Span) => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
      try {
        return await work(span);
      } catch (error) {
        const message = redactIds(error instanceof Error ? error.message : String(error));
        span.recordException({ name: error instanceof Error ? error.name : "Error", message });
        span.setStatus({ code: SpanStatusCode.ERROR, message: `${name} failed` });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  return {
    createAttendee(input) {
      return traced("create attendee", async () => {
        const attendee: Attendee = { ...input, id: randomUUID(), created: new Date().toISOString(), sample: false };
        await es.index({ index, id: attendee.id, document: { ...attendee, profile: attendee.interests } }, UNTRACED);
        return attendee;
      });
    },

    // Get and delete by document id are real time, so a profile is readable
    // right after the redirect that follows its creation.
    async getAttendee(id) {
      if (!isAttendeeId(id)) {
        return null;
      }
      return traced("get attendee", async (span) => {
        try {
          const response = await es.get<Attendee & { profile?: string }>({ index, id }, UNTRACED);
          if (!response._source) {
            return null;
          }
          const { profile: _embedded, ...attendee } = response._source;
          span.setAttribute("kubecompass.people.sample", attendee.sample);
          return attendee;
        } catch (error) {
          if (isNotFound(error)) {
            span.setAttribute("kubecompass.people.found", false);
            return null;
          }
          throw error;
        }
      });
    },

    async deleteAttendee(id) {
      if (!isAttendeeId(id)) {
        return false;
      }
      return traced("delete attendee", async () => {
        try {
          // Sample ids are predictable, so nobody gets to delete the demo profiles.
          const existing = await es.get<Attendee>({ index, id, _source_includes: ["sample"] }, UNTRACED);
          if (existing._source?.sample) {
            return false;
          }
          await es.delete({ index, id }, UNTRACED);
          return true;
        } catch (error) {
          if (isNotFound(error)) {
            return false;
          }
          throw error;
        }
      });
    },

    async checkIn(id, talk) {
      if (!isAttendeeId(id)) {
        return "not_found";
      }
      return traced("check in", async () => {
        try {
          const existing = await es.get<Attendee>({ index, id, _source_includes: ["sample", "attended"] }, UNTRACED);
          if (existing._source?.sample) {
            return "sample";
          }
          if ((existing._source?.attended ?? []).some((t) => t.id === talk.id)) {
            return "already";
          }
          await es.update(
            {
              index,
              id,
              script: {
                source:
                  "if (ctx._source.attended == null) { ctx._source.attended = []; } ctx._source.attended.add(params.talk)",
                params: { talk },
              },
            },
            UNTRACED,
          );
          return "checked_in";
        } catch (error) {
          if ((error as { meta?: { statusCode?: number } } | null)?.meta?.statusCode === 404) {
            return "not_found";
          }
          throw error;
        }
      });
    },

    findMatches(attendee) {
      return traced("find matches", async (span) => {
        const response = await es.search<AttendeeMatch>(buildMatchRequest(index, attendee));
        const matches = response.hits.hits.flatMap((hit) => (hit._source ? [hit._source] : []));
        span.setAttribute("kubecompass.people.matches", matches.length);
        return matches;
      });
    },
  };
}
