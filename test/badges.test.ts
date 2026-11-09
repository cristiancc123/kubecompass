import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { computeBadges, newlyEarned, type AttendedTalk } from "../src/badges.js";
import type { SearchBackend } from "../src/search.js";
import type { Session } from "../src/sessions.js";
import { alwaysReady, fakePeople, SAMPLE_ID, sampleAttendee } from "./fakes.js";

const talk = (id: string, track: string, day: string, venue: string): AttendedTalk => ({
  id,
  title: `Talk ${id}`,
  track,
  day,
  venue,
});

describe("computeBadges", () => {
  it("starts with every milestone locked and shows progress", () => {
    const badges = computeBadges([]);
    expect(badges.every((b) => !b.earned)).toBe(true);
    expect(badges.find((b) => b.id === "hat-trick")?.progress).toBe("0 of 3 talks");
  });

  it("earns milestones, explorer, marathon and track trainer badges", () => {
    const talks = [
      talk("1", "Security", "2026-11-10", "Salt Palace"),
      talk("2", "Security", "2026-11-11", "Hyatt Regency"),
      talk("3", "Observability", "2026-11-12", "Salt Palace"),
    ];
    const earned = computeBadges(talks)
      .filter((b) => b.earned)
      .map((b) => b.id);
    expect(earned).toEqual(["first-talk", "hat-trick", "explorer", "marathon", "trainer-security"]);
    const observability = computeBadges(talks).find((b) => b.id === "trainer-observability");
    expect(observability).toMatchObject({ earned: false, progress: "1 of 2 talks", name: "Observability trainer" });
  });

  it("reports only the badges the last check-in earned", () => {
    const before = [talk("1", "Security", "2026-11-10", "Salt Palace")];
    const after = [...before, talk("2", "Security", "2026-11-10", "Salt Palace")];
    expect(newlyEarned(before, after).map((b) => b.id)).toEqual(["trainer-security"]);
    expect(newlyEarned(after, after)).toEqual([]);
  });
});

const session: Session = {
  id: "1242966",
  title: "eBPF for everyone",
  url: "https://example.org/1242966",
  room: "Room 1",
  venue: "Salt Palace",
  start: "2026-11-11T13:20:00-07:00",
  end: "2026-11-11T14:20:00-07:00",
  day: "2026-11-11",
  track: "Security",
  level: null,
  tags: [],
  speakers: "",
  description: "",
  links: [],
};

const search: SearchBackend = {
  ping: async () => true,
  searchSessions: async () => ({
    mode: "hybrid",
    total: 1,
    took: 1,
    hits: [{ ...session, score: 1 }],
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

describe("badges on the profile", () => {
  const sessions = async (id: string) => (id === session.id ? session : null);

  it("checks in, then celebrates the badge earned", async () => {
    const checkIn = vi.fn(async () => "checked_in" as const);
    const app = createApp({ search, readiness: alwaysReady, sessions, people: fakePeople({ checkIn }) });
    const res = await app.request(`/people/${SAMPLE_ID}/attend`, form({ session: session.id }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/people/${SAMPLE_ID}?checked=1&earned=first-talk#badges`);
    expect(checkIn).toHaveBeenCalledWith(SAMPLE_ID, {
      id: session.id,
      title: session.title,
      track: "Security",
      day: "2026-11-11",
      venue: "Salt Palace",
    });
  });

  it("refuses unknown sessions, unknown profiles and sample profiles", async () => {
    const app = createApp({ search, readiness: alwaysReady, sessions, people: fakePeople() });
    expect((await app.request(`/people/${SAMPLE_ID}/attend`, form({ session: "42" }))).status).toBe(404);
    expect((await app.request("/people/nobody/attend", form({ session: session.id }))).status).toBe(404);
    const samples = fakePeople({ checkIn: async () => "sample" as const });
    const sampleApp = createApp({ search, readiness: alwaysReady, sessions, people: samples });
    expect((await sampleApp.request(`/people/${SAMPLE_ID}/attend`, form({ session: session.id }))).status).toBe(403);
  });

  it("shows the collection, check-in buttons, and celebrates only badges really earned", async () => {
    const attended = [talk(session.id, "Security", "2026-11-11", "Salt Palace")];
    const people = fakePeople({ getAttendee: async () => sampleAttendee({ attended }) });
    const app = createApp({ search, readiness: alwaysReady, sessions, people });
    const html = await (await app.request(`/people/${SAMPLE_ID}?checked=1&earned=first-talk,champion`)).text();
    expect(html).toContain("New badge: First steps!");
    expect(html).not.toContain("KubeCon champion!");
    expect(html).toContain("1 of 6 collected");
    expect(html).toContain("Attended");

    const fresh = createApp({ search, readiness: alwaysReady, sessions, people: fakePeople() });
    const freshHtml = await (await fresh.request(`/people/${SAMPLE_ID}`)).text();
    expect(freshHtml).toContain(`action="/people/${SAMPLE_ID}/attend"`);
    expect(freshHtml).toContain(`name="session" value="${session.id}"`);
  });
});
