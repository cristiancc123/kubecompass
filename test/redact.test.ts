import type { Client } from "@elastic/elasticsearch";
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createPeopleBackend, UNTRACED } from "../src/people.js";
import { redactIds, redactUrl } from "../src/redact.js";
import type { SearchBackend } from "../src/search.js";
import { fakePeople, SAMPLE_ID, sampleAttendee, alwaysReady } from "./fakes.js";

describe("redaction helpers", () => {
  it("replaces ids in text and drops query strings from URLs", () => {
    expect(redactIds(`failed for /kubecon-attendees/_doc/${SAMPLE_ID}`)).toBe("failed for /kubecon-attendees/_doc/:id");
    expect(redactUrl(`https://kubecompass.example/people/${SAMPLE_ID}/delete?created=1`)).toBe(
      "https://kubecompass.example/people/:id/delete",
    );
    expect(redactUrl("https://kubecompass.example/api/search?q=secret")).toBe("https://kubecompass.example/api/search");
  });
});

describe("profile ids in telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }));
  });

  afterEach(() => {
    trace.disable();
  });

  /** Every attribute, event and status message of every finished span, as one string. */
  function exported(): string {
    return JSON.stringify(
      exporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    );
  }

  it("never reach request spans", async () => {
    const search: SearchBackend = {
      ping: async () => true,
      searchSessions: async () => ({
        mode: "hybrid",
        total: 0,
        took: 1,
        hits: [],
        facets: { day: [], track: [], level: [], venue: [] },
      }),
    };
    const app = createApp({ search, people: fakePeople(), readiness: alwaysReady });
    await app.request(`http://localhost/people/${SAMPLE_ID}?created=1`);
    await app.request(`http://localhost/people/${SAMPLE_ID}/delete`, { method: "POST" });
    expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
    expect(exported()).toContain("/people/:id");
    expect(exported()).not.toContain(SAMPLE_ID);
  });

  it("never reach backend spans, and Elasticsearch's own spans are off for id lookups", async () => {
    const options: unknown[] = [];
    const notFound = Object.assign(new Error(`document ${SAMPLE_ID} missing`), { meta: { statusCode: 404 } });
    const es = {
      index: vi.fn(async (_params: unknown, opts: unknown) => options.push(opts)),
      get: vi.fn(async (_params: unknown, opts: unknown) => {
        options.push(opts);
        return { _source: sampleAttendee() };
      }),
      delete: vi.fn(async (_params: unknown, opts: unknown) => {
        options.push(opts);
        throw new Error(`delete of ${SAMPLE_ID} timed out`);
      }),
    } as unknown as Client;
    const people = createPeopleBackend(es, "attendees");

    const created = await people.createAttendee({ name: "Ana", interests: "eBPF and Cilium", contact: "" });
    await people.getAttendee(SAMPLE_ID);
    await expect(people.deleteAttendee(SAMPLE_ID)).rejects.toThrow("timed out");
    vi.mocked(es.get).mockRejectedValueOnce(notFound);
    expect(await people.getAttendee(SAMPLE_ID)).toBeNull();

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((opts) => opts === UNTRACED)).toBe(true);
    expect(exported()).toContain("delete attendee");
    expect(exported()).not.toContain(SAMPLE_ID);
    expect(exported()).not.toContain(created.id);
  });
});
