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
  });

  it("reports degraded readiness when Elasticsearch fails", async () => {
    const app = createApp({
      es: {
        ping: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded" });
  });

  it("serves the landing page", async () => {
    const app = createApp({ es: { ping: async () => true } });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("kubecompass");
  });
});
