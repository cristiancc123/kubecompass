import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildMatchRequest, isAttendeeId, parseAttendeeInput } from "../src/people.js";
import type { SearchBackend } from "../src/search.js";
import { fakePeople, SAMPLE_ID, sampleAttendee } from "./fakes.js";

const search: SearchBackend = {
  ping: async () => true,
  searchSessions: async () => ({
    mode: "hybrid",
    total: 1,
    took: 3,
    hits: [
      {
        id: "s1",
        title: "Kueue in production",
        url: "https://example.org/s1",
        room: "Salt Palace | Room 1",
        venue: "Salt Palace",
        start: "2026-11-10T14:50:00-07:00",
        end: "2026-11-10T15:25:00-07:00",
        day: "2026-11-10",
        track: "AI + ML",
        level: null,
        tags: [],
        speakers: "",
        description: "",
        links: [],
        score: 1,
      },
    ],
    facets: { day: [], track: [], level: [], venue: [] },
  }),
};

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

describe("parseAttendeeInput", () => {
  it("trims and accepts a valid profile", () => {
    expect(parseAttendeeInput({ name: " Ana ", interests: " eBPF and Cilium networking ", contact: "" })).toEqual({
      ok: true,
      input: { name: "Ana", interests: "eBPF and Cilium networking", contact: "" },
    });
  });

  it("rejects missing names, short interests and oversized fields", () => {
    expect(parseAttendeeInput({ name: "", interests: "eBPF and Cilium" }).ok).toBe(false);
    expect(parseAttendeeInput({ name: "Ana", interests: "k8s" }).ok).toBe(false);
    expect(parseAttendeeInput({ name: "A".repeat(61), interests: "eBPF and Cilium" }).ok).toBe(false);
    expect(parseAttendeeInput({ name: "Ana", interests: "x".repeat(501) }).ok).toBe(false);
    expect(parseAttendeeInput({ name: "Ana", interests: "eBPF and Cilium", contact: "c".repeat(101) }).ok).toBe(false);
  });
});

describe("buildMatchRequest", () => {
  it("fuses lexical and semantic matches, bounded, and never matches the attendee", () => {
    const request = buildMatchRequest("attendees", sampleAttendee());
    expect(request.size).toBe(5);
    expect(request._source).not.toContain("id");
    const retrievers = request.retriever?.rrf?.retrievers ?? [];
    expect(retrievers).toHaveLength(2);
    for (const retriever of retrievers) {
      expect(JSON.stringify(retriever)).toContain(`"must_not":[{"term":{"id":"${SAMPLE_ID}"}}]`);
    }
    expect(JSON.stringify(retrievers[1])).toContain('"semantic":{"field":"profile"');
  });
});

describe("isAttendeeId", () => {
  it("accepts UUIDs only", () => {
    expect(isAttendeeId(SAMPLE_ID)).toBe(true);
    expect(isAttendeeId("../_search")).toBe(false);
  });
});

describe("hallway track routes", () => {
  it("renders the sign-up form with labelled fields", async () => {
    const res = await createApp({ search, people: fakePeople() }).request("/people");
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const id of ["name", "interests", "contact"]) {
      expect(html).toContain(`<label for="${id}"`);
    }
    expect(html).toContain('aria-current="page"');
  });

  it("creates a profile and redirects to it", async () => {
    const createAttendee = vi.fn(async () => sampleAttendee());
    const app = createApp({ search, people: fakePeople({ createAttendee }) });
    const res = await app.request(
      "/people",
      form({ name: "Ana", interests: "GPU scheduling with Kueue", contact: "@ana" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/people/${SAMPLE_ID}?created=1`);
    expect(createAttendee).toHaveBeenCalledWith({
      name: "Ana",
      interests: "GPU scheduling with Kueue",
      contact: "@ana",
    });
  });

  it("re-renders the form with the error and the typed values, escaped", async () => {
    const app = createApp({ search, people: fakePeople() });
    const res = await app.request("/people", form({ name: "<i>Ana</i>", interests: "k8s" }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('role="alert"');
    expect(html).toContain("&lt;i&gt;Ana&lt;/i&gt;");
    expect(html).not.toContain("<i>Ana</i>");
  });

  it("rejects oversized form bodies", async () => {
    const app = createApp({ search, people: fakePeople() });
    const res = await app.request("/people", form({ name: "Ana", interests: "x".repeat(10_000) }));
    expect(res.status).toBe(413);
  });

  it("shows matches and talks with every value escaped and contacts as plain text", async () => {
    const res = await createApp({ search, people: fakePeople() }).request(`/people/${SAMPLE_ID}?created=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hi, Ana &lt;b&gt;");
    expect(html).toContain("Bookmark this page");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("Sample profile");
    expect(html).toContain("Kueue in production");
  });

  it("still shows talks when matching fails", async () => {
    const people = fakePeople({ findMatches: async () => Promise.reject(new Error("es down")) });
    const res = await createApp({ search, people }).request(`/people/${SAMPLE_ID}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Matches are temporarily unavailable");
    expect(html).toContain("Kueue in production");
  });

  it("offers deletion on real profiles only", async () => {
    const own = await createApp({ search, people: fakePeople() }).request(`/people/${SAMPLE_ID}`);
    expect(await own.text()).toContain("Delete my profile");
    const people = fakePeople({ getAttendee: async () => sampleAttendee({ sample: true }) });
    const sample = await createApp({ search, people }).request(`/people/${SAMPLE_ID}`);
    const html = await sample.text();
    expect(html).not.toContain("Delete my profile");
    expect(html).toContain("sample profile seeded for the demo");
  });

  it("answers 404 for unknown profiles", async () => {
    const res = await createApp({ search, people: fakePeople() }).request("/people/not-a-profile");
    expect(res.status).toBe(404);
  });

  it("deletes a profile", async () => {
    const app = createApp({ search, people: fakePeople() });
    expect((await app.request(`/people/${SAMPLE_ID}/delete`, { method: "POST" })).status).toBe(200);
    expect((await app.request("/people/unknown/delete", { method: "POST" })).status).toBe(404);
  });
});
