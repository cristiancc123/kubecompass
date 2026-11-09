import { logs, SeverityNumber, type Attributes } from "@opentelemetry/api";
import { SERVICE_NAME } from "./telemetry.js";

/**
 * Writes to the console and emits an OpenTelemetry log record. Records emitted
 * inside a request carry its trace and span ids, so Dash0 links them to the trace.
 */
function emit(severityNumber: SeverityNumber, severityText: string, message: string, attributes: Attributes) {
  logs.getLogger(SERVICE_NAME).emit({ severityNumber, severityText, body: message, attributes });
}

export const log = {
  info(message: string, attributes: Attributes = {}): void {
    console.log(message);
    emit(SeverityNumber.INFO, "INFO", message, attributes);
  },
  error(message: string, error: unknown, attributes: Attributes = {}): void {
    console.error(message, error);
    const details =
      error instanceof Error
        ? { "exception.type": error.name, "exception.message": error.message, "exception.stacktrace": error.stack ?? "" }
        : { "exception.message": String(error) };
    emit(SeverityNumber.ERROR, "ERROR", message, { ...attributes, ...details });
  },
};
