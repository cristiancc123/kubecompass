import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createElasticsearchClient } from "./es.js";
import { createSearchBackend } from "./search.js";

const config = loadConfig();
const es = createElasticsearchClient(config);
const app = createApp({ search: createSearchBackend(es, config.sessionsIndex) });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`kubecompass listening on http://localhost:${info.port}`);
});
