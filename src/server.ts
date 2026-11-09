import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAnthropicGenerator, createAskBackend, createRateLimiter } from "./ask.js";
import { loadConfig } from "./config.js";
import { createElasticsearchClient } from "./es.js";
import { log } from "./log.js";
import { createPeopleBackend } from "./people.js";
import { createSearchBackend } from "./search.js";
import { startTelemetry } from "./telemetry.js";

const config = loadConfig();
// Start telemetry before anything takes a tracer or meter from the global API.
const stopTelemetry = startTelemetry(config);
const es = createElasticsearchClient(config);
const search = createSearchBackend(es, config.sessionsIndex);
const ask = config.ask
  ? createAskBackend(
      search,
      createAnthropicGenerator(
        new Anthropic({ apiKey: config.ask.anthropicApiKey, timeout: 60_000 }),
        config.ask.model,
      ),
    )
  : undefined;
const app = createApp({
  search,
  ask,
  askLimiter: config.ask ? createRateLimiter(config.ask.limitPerMinute, 60_000) : undefined,
  people: createPeopleBackend(es, config.attendeesIndex),
  version: config.appVersion,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info(`kubecompass ${config.appVersion} listening on http://localhost:${info.port}`, {
    "telemetry.enabled": config.telemetry !== undefined,
    "ask.enabled": config.ask !== undefined,
  });
});

// Kubernetes sends SIGTERM before it kills the pod: stop taking requests,
// then flush the telemetry still buffered.
process.once("SIGTERM", () => {
  server.close(() => {
    stopTelemetry().finally(() => process.exit(0));
  });
});
