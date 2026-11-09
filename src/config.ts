/**
 * Runtime configuration read from environment variables.
 * Missing required values fail fast at startup instead of deep inside a request.
 */
export interface Config {
  port: number;
  elasticsearchUrl: string;
  elasticsearchApiKey: string;
  sessionsIndex: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    elasticsearchUrl: required(env, "ELASTICSEARCH_URL"),
    elasticsearchApiKey: required(env, "ELASTICSEARCH_API_KEY"),
    sessionsIndex: env.SESSIONS_INDEX ?? "kubecon-sessions",
  };
}
