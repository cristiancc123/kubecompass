import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createElasticsearchClient } from "./es.js";
import { log } from "./log.js";
import { createSearchBackend } from "./search.js";
import { startTelemetry } from "./telemetry.js";

const config = loadConfig();
// Start telemetry before anything takes a tracer or meter from the global API.
const stopTelemetry = startTelemetry(config);
const es = createElasticsearchClient(config);
const app = createApp({ search: createSearchBackend(es, config.sessionsIndex), version: config.appVersion });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info(`kubecompass ${config.appVersion} listening on http://localhost:${info.port}`, {
    "telemetry.enabled": config.telemetry !== undefined,
  });
});

// Kubernetes sends SIGTERM before it kills the pod: stop taking requests,
// then flush the telemetry still buffered.
process.once("SIGTERM", () => {
  server.close(() => {
    stopTelemetry().finally(() => process.exit(0));
  });
});
