import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const env = {
    ELASTICSEARCH_URL: "https://example.es.cloud:443",
    ELASTICSEARCH_API_KEY: "test-key",
  };

  it("reads required values from the injected environment only", () => {
    const config = loadConfig(env);
    expect(config.elasticsearchUrl).toBe(env.ELASTICSEARCH_URL);
    expect(config.elasticsearchApiKey).toBe(env.ELASTICSEARCH_API_KEY);
    expect(config.port).toBe(3000);
    expect(config.sessionsIndex).toBe("kubecon-sessions");
  });

  it("honours optional overrides", () => {
    const config = loadConfig({ ...env, PORT: "8080", SESSIONS_INDEX: "sessions-test" });
    expect(config.port).toBe(8080);
    expect(config.sessionsIndex).toBe("sessions-test");
  });

  it("fails fast when a required value is missing", () => {
    expect(() => loadConfig({ ELASTICSEARCH_URL: env.ELASTICSEARCH_URL })).toThrow(
      "Missing required environment variable ELASTICSEARCH_API_KEY",
    );
  });
});
