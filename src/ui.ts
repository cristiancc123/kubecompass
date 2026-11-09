import type { FacetBucket, SearchQuery, SearchResult, SessionHit } from "./search.js";

const EVENT_TIME_ZONE = "America/Denver";
const DESCRIPTION_LIMIT = 220;

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for safe interpolation into HTML content or attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** "Tue, Nov 10, 2:50 PM to 3:25 PM MST" from ISO timestamps. */
export function formatSlot(start: string, end: string): string {
  if (!start) {
    return "Time to be announced";
  }
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  const range = endDate
    ? `${timeFormatter.format(startDate)} to ${timeFormatter.format(endDate)}`
    : timeFormatter.format(startDate);
  return `${dayFormatter.format(startDate)}, ${range} MST`;
}

/** "Tue, Nov 10" from a YYYY-MM-DD event day. */
export function formatDay(day: string): string {
  return dayFormatter.format(new Date(`${day}T12:00:00-07:00`));
}

export function truncate(text: string, limit: number = DESCRIPTION_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > limit / 2 ? lastSpace : limit).trimEnd()}…`;
}

function renderOptions(buckets: FacetBucket[], selected: string | undefined, label: (value: string) => string): string {
  const options = buckets.map((bucket) => {
    const isSelected = bucket.value === selected ? " selected" : "";
    return `<option value="${escapeHtml(bucket.value)}"${isSelected}>${escapeHtml(label(bucket.value))} (${bucket.count})</option>`;
  });
  if (selected && !buckets.some((bucket) => bucket.value === selected)) {
    options.unshift(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(label(selected))}</option>`);
  }
  return options.join("");
}

function renderHit(hit: SessionHit): string {
  const tags = [hit.track, hit.level, ...hit.tags].filter((tag): tag is string => Boolean(tag));
  const description = hit.description ? `<p class="desc">${escapeHtml(truncate(hit.description))}</p>` : "";
  const speakers = hit.speakers ? `<p class="speakers">${escapeHtml(hit.speakers)}</p>` : "";
  return `<li class="card">
  <article aria-labelledby="t-${escapeHtml(hit.id)}">
    <h2 id="t-${escapeHtml(hit.id)}"><a href="${escapeHtml(hit.url)}" rel="noopener" target="_blank">${escapeHtml(hit.title)}</a></h2>
    <p class="meta"><time datetime="${escapeHtml(hit.start)}">${escapeHtml(formatSlot(hit.start, hit.end))}</time> · ${escapeHtml(hit.room || "Room to be announced")}</p>
    ${speakers}
    ${description}
    <ul class="tags" aria-label="Tags">${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>
  </article>
</li>`;
}

function renderResults(query: SearchQuery, result: SearchResult): string {
  if (result.hits.length === 0) {
    return `<p class="empty" role="status">No sessions match. Try fewer filters or a broader phrase like "service mesh" or "GPU scheduling".</p>`;
  }
  const what = query.q.trim()
    ? `Best matches for <strong>${escapeHtml(query.q.trim())}</strong>`
    : "Sessions in schedule order";
  return `<p class="summary" role="status">${what} · ${result.total} session${result.total === 1 ? "" : "s"} · ${result.took} ms</p>
<ol class="results">${result.hits.map(renderHit).join("\n")}</ol>`;
}

export interface PageModel {
  query: SearchQuery;
  result: SearchResult | null;
  error?: string;
}

/** Renders the whole search page. Works without JavaScript: the form is a plain GET. */
export function renderPage({ query, result, error }: PageModel): string {
  const facets = result?.facets ?? { day: [], track: [], level: [], venue: [] };
  const body = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : result
      ? renderResults(query, result)
      : "";

  const content = `<form method="get" action="/" role="search">
      <div class="row">
        <label for="q">What are you looking for?
          <input id="q" name="q" type="search" maxlength="300" placeholder="something on eBPF and security after lunch" value="${escapeHtml(query.q)}" autofocus />
        </label>
        <button type="submit">Search</button>
      </div>
      <div class="filters">
        <label for="day">Day<select id="day" name="day"><option value="">Any day</option>${renderOptions(facets.day, query.day, formatDay)}</select></label>
        <label for="track">Track<select id="track" name="track"><option value="">Any track</option>${renderOptions(facets.track, query.track, (v) => v)}</select></label>
        <label for="level">Level<select id="level" name="level"><option value="">Any level</option>${renderOptions(facets.level, query.level, (v) => v)}</select></label>
        <label for="venue">Venue<select id="venue" name="venue"><option value="">Any venue</option>${renderOptions(facets.venue, query.venue, (v) => v)}</select></label>
      </div>
    </form>
    <section id="results" aria-live="polite">${body}</section>`;

  return renderLayout({
    title: "kubecompass · find the right talk at KubeCon",
    description: "Hybrid keyword and semantic search over the KubeCon + CloudNativeCon North America 2026 schedule.",
    current: "talks",
    tagline: "Find the right talk at KubeCon + CloudNativeCon North America 2026, Salt Lake City. Ask in plain words.",
    skipTarget: "results",
    content,
    footer:
      "Schedule data from the official KubeCon program. Times in Mountain Standard Time. Search by Elasticsearch, hybrid BM25 + semantic retrieval.",
  });
}

export interface LayoutModel {
  /** Text for the <title> element. */
  title: string;
  description: string;
  /** Which navigation link is the current page. */
  current: "talks" | "people";
  tagline: string;
  /** Id of the main region the skip link jumps to. */
  skipTarget: string;
  /** Trusted HTML: every value inside must already be escaped. */
  content: string;
  footer: string;
}

/** Shared page shell: theme, navigation, skip link and footer. */
export function renderLayout(page: LayoutModel): string {
  const navLink = (key: LayoutModel["current"], href: string, label: string) =>
    `<a href="${href}"${page.current === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <style>
    :root { --bg: #0b1020; --panel: #121a2f; --text: #e8ecf5; --muted: #a9b3c9; --accent: #5ad1ff; --accent-2: #a78bfa; --on-accent: #041018; --error: #fca5a5; --border: #27324d; }
    @media (prefers-color-scheme: light) { :root { --bg: #f7f8fb; --panel: #ffffff; --text: #111827; --muted: #4b5563; --accent: #0369a1; --accent-2: #6d28d9; --on-accent: #ffffff; --error: #b91c1c; --border: #d7dce6; } }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
    a { color: var(--accent); }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
    .skip { position: absolute; left: -999px; } .skip:focus { left: 16px; top: 8px; background: var(--panel); padding: 8px; }
    header, main { max-width: 960px; margin: 0 auto; padding: 0 16px; }
    header { padding-top: 32px; }
    h1 { margin: 0; font-size: 2rem; } h1 span { color: var(--accent); }
    .tagline { margin: 4px 0 24px; color: var(--muted); }
    form { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
    .row { display: grid; gap: 12px; grid-template-columns: 1fr auto; align-items: end; }
    .filters { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    label { display: grid; gap: 4px; font-size: 0.9rem; color: var(--muted); }
    input, select, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
    button { background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 600; cursor: pointer; }
    .summary, .empty, .error { margin: 24px 0 12px; color: var(--muted); }
    .error { color: var(--error); }
    .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .card h2 { margin: 0 0 6px; font-size: 1.15rem; }
    .meta, .speakers { margin: 0 0 6px; color: var(--muted); font-size: 0.95rem; }
    .desc { margin: 8px 0; }
    .tags { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .tags li { font-size: 0.8rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
    footer { max-width: 960px; margin: 40px auto; padding: 0 16px; color: var(--muted); font-size: 0.85rem; }
    nav { display: flex; gap: 16px; margin: 8px 0 0; }
    nav a { font-weight: 600; text-decoration: none; padding: 2px 0; }
    nav a[aria-current="page"] { text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 2px; }
    textarea { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); min-height: 7rem; resize: vertical; }
    textarea:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
    .hint { font-size: 0.85rem; color: var(--muted); margin: 0; }
    .notice { background: var(--panel); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin: 0 0 16px; }
    h2.section { font-size: 1.25rem; margin: 32px 0 12px; }
    .contact { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
    button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
  </style>
</head>
<body>
  <a class="skip" href="#${escapeHtml(page.skipTarget)}">Skip to main content</a>
  <header>
    <h1>kube<span>compass</span></h1>
    <nav aria-label="Main">${navLink("talks", "/", "Talks")}${navLink("people", "/people", "Hallway track")}</nav>
    <p class="tagline">${escapeHtml(page.tagline)}</p>
  </header>
  <main>
    ${page.content}
  </main>
  <footer>${escapeHtml(page.footer)}</footer>
</body>
</html>`;
}
