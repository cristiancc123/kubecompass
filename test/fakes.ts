import type { Attendee, AttendeeMatch, PeopleBackend } from "../src/people.js";

export const SAMPLE_ID = "0b6f3c1e-2a4d-4c8e-9f10-1234567890ab";

export function sampleAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: SAMPLE_ID,
    name: "Ana <b>",
    interests: "Platform engineering, GPU scheduling with Kueue, multi-tenant clusters",
    contact: "@ana on CNCF Slack",
    created: "2026-11-09T18:00:00.000Z",
    sample: false,
    ...overrides,
  };
}

export const sampleMatch: AttendeeMatch = {
  name: "Platform engineer at a fintech",
  interests: "Running Kueue for batch and ML jobs <script>alert(1)</script>",
  contact: "javascript:alert(1)",
  sample: true,
};

/** People backend with no Elasticsearch behind it. Unknown ids resolve to null. */
export function fakePeople(overrides: Partial<PeopleBackend> = {}): PeopleBackend {
  return {
    createAttendee: async (input) => sampleAttendee({ ...input }),
    getAttendee: async (id) => (id === SAMPLE_ID ? sampleAttendee() : null),
    deleteAttendee: async (id) => id === SAMPLE_ID,
    findMatches: async () => [sampleMatch],
    ...overrides,
  };
}
