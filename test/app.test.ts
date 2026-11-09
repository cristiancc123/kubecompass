import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("app", () => {
  it("answers the liveness probe", async () => {
    const app = createApp({ es: { ping: async () => true } });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports readiness when Elasticsearch answers", async () => {
    const app = createApp({ es: { ping: async () => true } });
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", elasticsearch: "reachable" });
  });

  it("reports degraded readiness when the ping resolves to false", async () => {
    const app = createApp({ es: { ping: async () => false } });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", elasticsearch: "unreachable" });
  });

  it("reports degraded readiness when Elasticsearch throws", async () => {
    const app = createApp({
      es: {
        ping: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", elasticsearch: "connection refused" });
  });

  it("serves the landing page", async () => {
    const app = createApp({ es: { ping: async () => true } });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("kubecompass");
  });
});
