/**
 * Runtime configuration read from environment variables.
 * Missing required values fail fast at startup instead of deep inside a request.
 */
export interface Config {
  port: number;
  elasticsearchUrl: string;
  elasticsearchApiKey: string;
  sessionsIndex: string;
  /** Image tag set at build time; "dev" when running from source. */
  appVersion: string;
  /** Present only when both Dash0 values are set, so local runs work without telemetry. */
  telemetry?: TelemetryConfig;
}

export interface TelemetryConfig {
  /** OTLP/HTTP base URL, without the /v1/<signal> path. */
  otlpEndpoint: string;
  authToken: string;
  /** Dash0 dataset; omitted means the organization's default dataset. */
  dataset?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function telemetryConfig(env: NodeJS.ProcessEnv): TelemetryConfig | undefined {
  const otlpEndpoint = env.DASH0_OTLP_ENDPOINT;
  const authToken = env.DASH0_AUTH_TOKEN;
  if (!otlpEndpoint || !authToken) {
    return undefined;
  }
  return { otlpEndpoint: otlpEndpoint.replace(/\/+$/, ""), authToken, dataset: env.DASH0_DATASET || undefined };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    elasticsearchUrl: required(env, "ELASTICSEARCH_URL"),
    elasticsearchApiKey: required(env, "ELASTICSEARCH_API_KEY"),
    sessionsIndex: env.SESSIONS_INDEX ?? "kubecon-sessions",
    appVersion: env.APP_VERSION ?? "dev",
    telemetry: telemetryConfig(env),
  };
}
