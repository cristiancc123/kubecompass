import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSchedule, splitTags, toEventIso } from "../scripts/parse-schedule.js";

const fixture = readFileSync(new URL("./fixtures/schedule-sample.html", import.meta.url), "utf8");

describe("parseSchedule", () => {
  const sessions = parseSchedule(fixture);

  it("parses every session card", () => {
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.title)).toEqual([
      "Registration + Badge Pick-Up",
      "Atlantis: What's New in IaC Orchestration",
      "Saturated by Design – Maximizing Cluster Allocation in On-Premises Kubernetes",
    ]);
  });

  it("extracts ids, venue, times and the event offset", () => {
    const atlantis = sessions[1];
    expect(atlantis.id).toMatch(/^\d+$/);
    expect(atlantis.url).toContain(`?id=${atlantis.id}`);
    expect(atlantis.venue).toBe("Hyatt Regency");
    expect(atlantis.room).toBe("Hyatt Regency | Level 4 | Regency Ballroom B-D");
    expect(atlantis.start).toBe("2026-11-09T15:17:00-07:00");
    expect(atlantis.end).toBe("2026-11-09T15:22:00-07:00");
    expect(atlantis.day).toBe("2026-11-09");
  });

  it("splits track, level and remaining tags", () => {
    const saturated = sessions[2];
    expect(saturated.track).toBe("Operations + Performance");
    expect(saturated.level).toBe("Advanced");
    expect(saturated.tags).toContain("End User Talk");
    expect(saturated.speakers).toBe("Dakota Sullivan, Isaac Wilson");
  });

  it("keeps descriptions and links, without e-mail placeholders", () => {
    for (const session of sessions.slice(1)) {
      expect(session.description.length).toBeGreaterThan(50);
      expect(session.description).not.toMatch(/email.?protected/i);
      expect(session.links.length).toBeGreaterThan(0);
      expect(session.links[0].url).toMatch(/^https?:\/\//);
    }
  });
});

describe("toEventIso", () => {
  it("appends the MST offset to naive timestamps", () => {
    expect(toEventIso("2026-11-10T09:00:00")).toBe("2026-11-10T09:00:00-07:00");
  });

  it("leaves timestamps that already carry an offset untouched", () => {
    expect(toEventIso("2026-11-10T16:00:00Z")).toBe("2026-11-10T16:00:00Z");
    expect(toEventIso("2026-11-10T09:00:00+02:00")).toBe("2026-11-10T09:00:00+02:00");
  });
});

describe("splitTags", () => {
  it("uses the first primary tag as track and recognises audience levels", () => {
    const result = splitTags([
      { text: "Observability", primary: true },
      { text: "Any Level", primary: false },
      { text: "Sponsored", primary: false },
      { text: "Advanced", primary: false },
    ]);
    expect(result).toEqual({ track: "Observability", level: "Any Level", tags: ["Sponsored", "Advanced"] });
  });

  it("returns an empty track when no primary tag exists", () => {
    expect(splitTags([{ text: "BoF", primary: false }])).toEqual({ track: "", level: null, tags: ["BoF"] });
  });
});
