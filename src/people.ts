import { randomUUID } from "node:crypto";
import type { Client, estypes } from "@elastic/elasticsearch";
import { SpanStatusCode, trace } from "@opentelemetry/api";

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
}

/** Another attendee as shown in someone's matches: no id, so nobody can open or delete it. */
export type AttendeeMatch = Omit<Attendee, "id" | "created">;

export interface PeopleBackend {
  createAttendee(input: AttendeeInput): Promise<Attendee>;
  getAttendee(id: string): Promise<Attendee | null>;
  deleteAttendee(id: string): Promise<boolean>;
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

function isNotFound(error: unknown): boolean {
  return (error as { meta?: { statusCode?: number } } | null)?.meta?.statusCode === 404;
}

/** Wraps the attendees index behind the PeopleBackend interface. */
export function createPeopleBackend(es: Client, index: string): PeopleBackend {
  const tracer = trace.getTracer("kubecompass.people");

  return {
    async createAttendee(input) {
      const attendee: Attendee = { ...input, id: randomUUID(), created: new Date().toISOString(), sample: false };
      await es.index({ index, id: attendee.id, document: { ...attendee, profile: attendee.interests } });
      return attendee;
    },

    // Get and delete by document id are real time, so a profile is readable
    // right after the redirect that follows its creation.
    async getAttendee(id) {
      if (!isAttendeeId(id)) {
        return null;
      }
      try {
        const response = await es.get<Attendee & { profile?: string }>({ index, id });
        if (!response._source) {
          return null;
        }
        const { profile: _embedded, ...attendee } = response._source;
        return attendee;
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async deleteAttendee(id) {
      if (!isAttendeeId(id)) {
        return false;
      }
      try {
        // Sample ids are predictable, so nobody gets to delete the demo profiles.
        const existing = await es.get<Attendee>({ index, id, _source_includes: ["sample"] });
        if (existing._source?.sample) {
          return false;
        }
        await es.delete({ index, id });
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw error;
      }
    },

    findMatches(attendee) {
      return tracer.startActiveSpan("find matches", async (span) => {
        try {
          const response = await es.search<AttendeeMatch>(buildMatchRequest(index, attendee));
          const matches = response.hits.hits.flatMap((hit) => (hit._source ? [hit._source] : []));
          span.setAttribute("kubecompass.people.matches", matches.length);
          return matches;
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({ code: SpanStatusCode.ERROR, message: "match search failed" });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}
