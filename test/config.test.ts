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
    expect(config.appVersion).toBe("dev");
    expect(config.telemetry).toBeUndefined();
  });

  it("enables telemetry only when both Dash0 values are set", () => {
    expect(loadConfig({ ...env, DASH0_OTLP_ENDPOINT: "https://ingress.example.com" }).telemetry).toBeUndefined();
    const config = loadConfig({
      ...env,
      APP_VERSION: "abc1234",
      DASH0_OTLP_ENDPOINT: "https://ingress.example.com/",
      DASH0_AUTH_TOKEN: "token",
    });
    expect(config.appVersion).toBe("abc1234");
    expect(config.telemetry).toEqual({
      otlpEndpoint: "https://ingress.example.com",
      authToken: "token",
      dataset: undefined,
    });
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

  it("enables the assistant with a key and validates its rate limit", () => {
    expect(loadConfig(env).ask).toBeUndefined();
    expect(loadConfig({ ...env, ANTHROPIC_API_KEY: "k" }).ask).toEqual({
      anthropicApiKey: "k",
      model: "claude-opus-5-5",
      limitPerMinute: 20,
    });
    expect(loadConfig({ ...env, ANTHROPIC_API_KEY: "k", ASK_LIMIT_PER_MINUTE: "5" }).ask?.limitPerMinute).toBe(5);
    for (const bad of ["abc", "0", "-1", "2.5"]) {
      expect(() => loadConfig({ ...env, ANTHROPIC_API_KEY: "k", ASK_LIMIT_PER_MINUTE: bad })).toThrow(
        "ASK_LIMIT_PER_MINUTE must be a positive integer",
      );
    }
  });

  it("trims pasted whitespace and rejects malformed URLs without echoing them", () => {
    const config = loadConfig({
      ELASTICSEARCH_URL: " https://example.es.cloud:443\n",
      ELASTICSEARCH_API_KEY: "key==\r\n",
    });
    expect(config.elasticsearchUrl).toBe("https://example.es.cloud:443");
    expect(config.elasticsearchApiKey).toBe("key==");
    expect(() => loadConfig({ ...env, ELASTICSEARCH_URL: "PEGA_AQUI" })).toThrow(
      "ELASTICSEARCH_URL is not a valid URL",
    );
    expect(() => loadConfig({ ...env, ELASTICSEARCH_URL: "ftp://example" })).toThrow("must be an http or https URL");
    expect(() => loadConfig({ ...env, DASH0_OTLP_ENDPOINT: "secret-token", DASH0_AUTH_TOKEN: "t" })).toThrow(
      /^DASH0_OTLP_ENDPOINT is not a valid URL$/,
    );
    expect(() => loadConfig({ ...env, ELASTICSEARCH_API_KEY: "  " })).toThrow("Missing required environment variable");
  });
});
