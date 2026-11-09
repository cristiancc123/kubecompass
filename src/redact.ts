/**
 * Profile ids are random UUIDs and the only key to a hallway-track profile, so
 * anything sent to the telemetry backend goes through here first.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Replaces every UUID in free text, such as an error message or stack, with `:id`. */
export function redactIds(text: string): string {
  return text.replace(UUID, ":id");
}

/** The URL as telemetry may see it: no query string, and ids replaced by `:id`. */
export function redactUrl(raw: string): string {
  const url = new URL(raw);
  return `${url.origin}${redactIds(url.pathname)}`;
}
