import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { Config } from "./config.js";

export const SERVICE_NAME = "kubecompass";

/**
 * Starts the OpenTelemetry SDK and exports traces, metrics and logs to Dash0
 * over OTLP/HTTP. Spans come from the Hono middleware and from the
 * Elasticsearch client, which traces its own requests through the global API.
 * Without Dash0 settings this is a no-op and the API stays on its no-op default.
 * The returned function flushes and stop the exporters on shutdown.
 */
export function startTelemetry(config: Config): () => Promise<void> {
  const telemetry = config.telemetry;
  if (!telemetry) {
    return async () => {};
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${telemetry.authToken}` };
  if (telemetry.dataset) {
    headers["Dash0-Dataset"] = telemetry.dataset;
  }
  const url = (signal: string) => `${telemetry.otlpEndpoint}/v1/${signal}`;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: config.appVersion,
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: url("traces"), headers }) })],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: url("metrics"), headers }),
        exportIntervalMillis: 15_000,
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: url("logs"), headers }) })],
    instrumentations: [],
  });
  sdk.start();
  return () => sdk.shutdown();
}
