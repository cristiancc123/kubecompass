/** A KubeCon session as indexed in Elasticsearch. */
export interface SessionLink {
  label: string;
  url: string;
}

export interface Session {
  /** Stable id from the official schedule (`data-session-id`). */
  id: string;
  title: string;
  /** Deep link into the official schedule. */
  url: string;
  /** Full room string, e.g. "Salt Palace | Level 1 | Grand Ballroom ACE". */
  room: string;
  /** First segment of the room, e.g. "Salt Palace" or "Hyatt Regency". */
  venue: string;
  /** ISO 8601 with the event offset (MST, UTC-7). */
  start: string;
  end: string;
  /** Calendar day in the event time zone, YYYY-MM-DD. */
  day: string;
  /** Primary tag, e.g. "Observability" or "Keynote Sessions". */
  track: string;
  /** Audience level when the schedule declares one. */
  level: string | null;
  /** Remaining tags: "End User Talk", "Sponsored", co-located event names, ... */
  tags: string[];
  /** Speakers exactly as listed, e.g. "Felipe Araujo & Kaynan Coelho, Nubank". */
  speakers: string;
  description: string;
  links: SessionLink[];
}

/** Name of the Elasticsearch index holding sessions unless overridden by SESSIONS_INDEX. */
export const DEFAULT_SESSIONS_INDEX = "kubecon-sessions";
