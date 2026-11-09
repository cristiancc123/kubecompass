import { Client } from "@elastic/elasticsearch";
import type { Config } from "./config.js";

/** Builds the Elasticsearch client for the configured Serverless project. */
export function createElasticsearchClient(config: Config): Client {
  return new Client({
    node: config.elasticsearchUrl,
    auth: { apiKey: config.elasticsearchApiKey },
    serverMode: "serverless",
  });
}
