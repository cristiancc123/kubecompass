/**
 * Runtime configuration read from environment variables.
 * Missing required values fail fast at startup instead of deep inside a request.
 */
export interface Config {
  port: number;
  elasticsearchUrl: string;
  elasticsearchApiKey: string;
  sessionsIndex: string;
  attendeesIndex: string;
  /** Image tag set at build time; "dev" when running from source. */
  appVersion: string;
  /** Present only when an Anthropic API key is set; without it /ask is disabled. */
  ask?: AskConfig;
  /** Present only when both Dash0 values are set, so local runs work without telemetry. */
  telemetry?: TelemetryConfig;
}

export interface AskConfig {
  anthropicApiKey: string;
  model: string;
  /** Questions per minute per pod. Each one is a paid model call. */
  limitPerMinute: number;
}

export interface TelemetryConfig {
  /** OTLP/HTTP base URL, without the /v1/<signal> path. */
  otlpEndpoint: string;
  authToken: string;
  /** Dash0 dataset; omitted means the organization's default dataset. */
  dataset?: string;
}

/** A positive integer, or the fallback when unset. Anything else fails at startup. */
function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Values pasted into a Secret often carry a trailing newline or spaces, which
 * break URLs and API keys in ways that only show up as failed requests later.
 */
function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = read(env, name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Fails at startup with the variable's name, never its value, which may hold credentials. */
function httpUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http or https URL`);
  }
  return value;
}

function telemetryConfig(env: NodeJS.ProcessEnv): TelemetryConfig | undefined {
  const otlpEndpoint = read(env, "DASH0_OTLP_ENDPOINT");
  const authToken = read(env, "DASH0_AUTH_TOKEN");
  if (!otlpEndpoint || !authToken) {
    return undefined;
  }
  return {
    otlpEndpoint: httpUrl("DASH0_OTLP_ENDPOINT", otlpEndpoint).replace(/\/+$/, ""),
    authToken,
    dataset: read(env, "DASH0_DATASET"),
  };
}

function askConfig(env: NodeJS.ProcessEnv): AskConfig | undefined {
  const anthropicApiKey = read(env, "ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    return undefined;
  }
  return {
    anthropicApiKey,
    model: read(env, "ASK_MODEL") ?? "claude-opus-5-5",
    limitPerMinute: positiveInt(env, "ASK_LIMIT_PER_MINUTE", 20),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    elasticsearchUrl: httpUrl("ELASTICSEARCH_URL", required(env, "ELASTICSEARCH_URL")),
    elasticsearchApiKey: required(env, "ELASTICSEARCH_API_KEY"),
    sessionsIndex: env.SESSIONS_INDEX ?? "kubecon-sessions",
    attendeesIndex: env.ATTENDEES_INDEX ?? "kubecon-attendees",
    appVersion: env.APP_VERSION ?? "dev",
    telemetry: telemetryConfig(env),
    ask: askConfig(env),
  };
}
