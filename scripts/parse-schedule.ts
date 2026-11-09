import { parse, type HTMLElement } from "node-html-parser";
import type { Session, SessionLink } from "../src/sessions.js";

/** The official schedule page. Sessions are server-rendered, no API key needed. */
export const SCHEDULE_URL =
  "https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/";

/** KubeCon NA 2026 runs on Mountain Standard Time. */
export const EVENT_UTC_OFFSET = "-07:00";

const LEVELS = new Set(["Beginner", "Intermediate", "Advanced", "Any Level"]);

/** Cloudflare replaces obfuscated e-mails with this placeholder; it is noise for search. */
const EMAIL_PLACEHOLDER = /\[email\s*protected\]/gi;

/** Badges such as "↓ Slides" describe assets, not the session, so they are not tags. */
const ASSET_BADGE = /^↓/;

/**
 * Block-level boundaries become whitespace before parsing, otherwise the text of
 * neighbouring paragraphs runs together ("receptions.Info") and search loses both words.
 */
const BLOCK_BOUNDARY = /<\/?(p|li|ul|ol|div|h[1-6]|blockquote|tr|td|th)\b[^>]*>|<br\s*\/?>/gi;

function clean(text: string | undefined): string {
  return (text ?? "").replace(EMAIL_PLACEHOLDER, "").replace(/\s+/g, " ").trim();
}

/** Appends the event offset to a schedule timestamp such as `2026-11-10T09:00:00`. */
export function toEventIso(datetime: string): string {
  const trimmed = datetime.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${EVENT_UTC_OFFSET}`;
}

/** Splits the tag list into the primary track, an optional level and the rest. */
export function splitTags(tags: { text: string; primary: boolean }[]): {
  track: string;
  level: string | null;
  tags: string[];
} {
  let track = "";
  let level: string | null = null;
  const rest: string[] = [];
  for (const tag of tags) {
    const text = clean(tag.text);
    if (!text || ASSET_BADGE.test(text)) continue;
    if (tag.primary && !track) {
      track = text;
    } else if (LEVELS.has(text) && level === null) {
      level = text;
    } else {
      rest.push(text);
    }
  }
  return { track, level, tags: rest };
}

function parseCard(card: HTMLElement): Session | null {
  const link = card.querySelector("a.sess-link");
  const id = link?.getAttribute("data-session-id") ?? "";
  const title = clean(card.querySelector(".sess__title")?.text);
  if (!id || !title) {
    return null;
  }

  const times = card
    .querySelectorAll(".sess__seotime time")
    .map((t) => t.getAttribute("datetime") ?? "")
    .filter(Boolean);
  const start = times[0] ? toEventIso(times[0]) : "";
  const end = times[1] ? toEventIso(times[1]) : start;

  const room = clean(card.querySelector(".sess__room")?.text);
  const venue = room.split("|")[0]?.trim() ?? "";

  const { track, level, tags } = splitTags(
    card.querySelectorAll(".sess__tags .tag").map((t) => ({
      text: t.text,
      primary: t.classList.contains("tag--primary"),
    })),
  );

  const links: SessionLink[] = card
    .querySelectorAll(".sess__seolinks a")
    .map((a) => ({ label: clean(a.text), url: a.getAttribute("href") ?? "" }))
    .filter((l) => l.url);

  return {
    id,
    title,
    url: link?.getAttribute("href") ?? "",
    room,
    venue,
    start,
    end,
    day: start.slice(0, 10),
    track,
    level,
    tags,
    speakers: clean(card.querySelector(".sess__speakers")?.text),
    description: clean(card.querySelector(".sess__seodesc")?.text),
    links,
  };
}

/** Parses the schedule HTML into sessions, skipping cards without an id or title. */
export function parseSchedule(html: string): Session[] {
  const root = parse(html.replace(BLOCK_BOUNDARY, " $& "));
  const sessions: Session[] = [];
  for (const card of root.querySelectorAll(".sess-wrap")) {
    const session = parseCard(card);
    if (session) {
      sessions.push(session);
    }
  }
  return sessions;
}

/** Downloads the live schedule page. */
export async function fetchScheduleHtml(url: string = SCHEDULE_URL): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "kubecompass/0.1 (+https://github.com/cristiancc123/kubecompass)" },
  });
  if (!res.ok) {
    throw new Error(`Schedule download failed: HTTP ${res.status}`);
  }
  return res.text();
}
