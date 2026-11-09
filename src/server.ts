import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAnthropicGenerator, createAskBackend, createRateLimiter } from "./ask.js";
import { loadConfig } from "./config.js";
import { createElasticsearchClient } from "./es.js";
import { log } from "./log.js";
import { createPeopleBackend } from "./people.js";
import { createReadinessMonitor } from "./readiness.js";
import { createSearchBackend } from "./search.js";
import { createAnthropicStudyGenerator, createStudyBackend } from "./study.js";
import { startTelemetry } from "./telemetry.js";

const config = loadConfig();
// Start telemetry before anything takes a tracer or meter from the global API.
const stopTelemetry = startTelemetry(config);
const es = createElasticsearchClient(config);
const search = createSearchBackend(es, config.sessionsIndex);
const anthropic = config.ask ? new Anthropic({ apiKey: config.ask.anthropicApiKey, timeout: 60_000 }) : undefined;
const ask =
  config.ask && anthropic ? createAskBackend(search, createAnthropicGenerator(anthropic, config.ask.model)) : undefined;
const study =
  config.ask && anthropic
    ? createStudyBackend(es, config.sessionsIndex, createAnthropicStudyGenerator(anthropic, config.ask.model))
    : undefined;
const readiness = createReadinessMonitor(() => search.ping());
const stopReadiness = readiness.start();
const app = createApp({
  search,
  readiness,
  ask,
  study,
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
  stopReadiness();
  server.close(() => {
    stopTelemetry().finally(() => process.exit(0));
  });
});
