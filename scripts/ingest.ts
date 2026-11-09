import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createElasticsearchClient } from "../src/es.js";
import type { Session } from "../src/sessions.js";
import { fetchScheduleHtml, parseSchedule } from "./parse-schedule.js";

/**
 * Builds the Elasticsearch index for sessions.
 *
 * Usage:
 *   npm run ingest                      # download the live schedule and index it
 *   npm run ingest -- --from file.html  # parse a saved copy instead of downloading
 *   npm run ingest -- --recreate        # drop and recreate the index first
 */

const SESSIONS_JSON = "data/sessions.json";

/** Mapping for the sessions index. `content` is the semantic field used for hybrid search. */
const MAPPINGS = {
  properties: {
    id: { type: "keyword" },
    title: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 512 } } },
    url: { type: "keyword", index: false },
    room: { type: "keyword" },
    venue: { type: "keyword" },
    start: { type: "date" },
    end: { type: "date" },
    day: { type: "keyword" },
    track: { type: "keyword" },
    level: { type: "keyword" },
    tags: { type: "keyword" },
    speakers: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 512 } } },
    description: { type: "text" },
    content: { type: "semantic_text" },
  },
} as const;

/** Text that gets embedded: title first, then who and what, so short queries still match. */
export function buildContent(session: Session): string {
  return [session.title, session.track, session.speakers, session.description]
    .filter(Boolean)
    .join(". ");
}

async function loadHtml(from: string | undefined): Promise<string> {
  if (from) {
    console.log(`Reading schedule from ${from}`);
    return readFile(from, "utf8");
  }
  console.log("Downloading the live schedule");
  return fetchScheduleHtml();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      recreate: { type: "boolean", default: false },
    },
  });

  const config = loadConfig();
  const es = createElasticsearchClient(config);
  const index = config.sessionsIndex;

  const sessions = parseSchedule(await loadHtml(values.from));
  console.log(`Parsed ${sessions.length} sessions`);
  await mkdir("data", { recursive: true });
  await writeFile(SESSIONS_JSON, JSON.stringify(sessions, null, 2));
  console.log(`Wrote ${SESSIONS_JSON}`);

  const exists = await es.indices.exists({ index });
  if (exists && values.recreate) {
    console.log(`Deleting index ${index}`);
    await es.indices.delete({ index });
  }
  if (!exists || values.recreate) {
    console.log(`Creating index ${index}`);
    await es.indices.create({ index, mappings: MAPPINGS });
  }

  const result = await es.helpers.bulk<Session>({
    datasource: sessions,
    onDocument: (doc) => [{ index: { _index: index, _id: doc.id } }, { ...doc, content: buildContent(doc) }],
    onDrop: (drop) => console.error("Dropped document", drop.document.id, drop.error),
    refreshOnCompletion: index,
  });
  console.log(
    `Indexed ${result.successful} sessions into ${index} (${result.failed} failed, ${result.time} ms)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
