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
    <p class="study-link"><a href="/talks/${escapeHtml(hit.id)}/study">Study this talk<span class="visually-hidden">: ${escapeHtml(hit.title)}</span></a></p>
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
          <input id="q" name="q" type="search" maxlength="300" placeholder="something on eBPF and security after lunch" value="${escapeHtml(query.q)}" />
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
    <section id="results" tabindex="-1" aria-live="polite">${body}</section>`;

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
  current: "talks" | "ask" | "people";
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
    :root { --bg: #0b1020; --panel: #121a2f; --text: #e8ecf5; --muted: #a9b3c9; --accent: #5ad1ff; --accent-2: #a78bfa; --on-accent: #041018; --error: #fca5a5; --border: #27324d; --control-border: #6b7a99; }
    @media (prefers-color-scheme: light) { :root { --bg: #f7f8fb; --panel: #ffffff; --text: #111827; --muted: #4b5563; --accent: #0369a1; --accent-2: #6d28d9; --on-accent: #ffffff; --error: #b91c1c; --border: #d7dce6; --control-border: #7c8698; } }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
    a { color: var(--accent); }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
    /* Skip-link targets take focus so screen readers continue from there; no ring on a whole region. */
    [tabindex="-1"]:focus { outline: none; }
    .skip { position: absolute; left: -999px; } .skip:focus { left: 16px; top: 8px; background: var(--panel); padding: 8px; }
    header, main { max-width: 960px; margin: 0 auto; padding: 0 16px; }
    header { padding-top: 32px; }
    h1 { margin: 0; font-size: 2rem; } h1 span { color: var(--accent); }
    .tagline { margin: 4px 0 24px; color: var(--muted); }
    form { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
    .row { display: grid; gap: 12px; grid-template-columns: 1fr auto; align-items: end; }
    .filters { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    label { display: grid; gap: 4px; font-size: 0.9rem; color: var(--muted); }
    input, select, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--control-border); background: var(--bg); color: var(--text); }
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
    textarea { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--control-border); background: var(--bg); color: var(--text); min-height: 7rem; resize: vertical; }
    textarea:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
    .hint { font-size: 0.85rem; color: var(--muted); margin: 0; }
    .notice { background: var(--panel); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin: 0 0 16px; }
    h2.section { font-size: 1.25rem; margin: 32px 0 12px; }
    .contact { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
    .answer { margin: 24px 0 0; } .answer .desc { margin: 0; font-size: 1.05rem; }
    .ref { font-weight: 600; text-decoration: none; }
    button:disabled, input:disabled { opacity: 0.6; cursor: not-allowed; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .study-link { margin: 8px 0 0; font-size: 0.95rem; }
    .ideas { margin: 0; padding: 16px 16px 16px 36px; display: grid; gap: 8px; }
    .steps { margin: 0; padding: 0 0 0 20px; display: grid; gap: 8px; }
    details summary { cursor: pointer; color: var(--accent); font-weight: 600; }
    /* ---- Visual layer: depth, color and friendlier controls. Contrast checked in both schemes. ---- */
    body { background: radial-gradient(1200px 600px at 10% -10%, color-mix(in srgb, var(--accent-2) 18%, transparent), transparent 60%), radial-gradient(900px 500px at 100% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%), var(--bg); background-attachment: fixed; min-height: 100vh; }
    header { padding-top: 40px; padding-bottom: 8px; }
    h1 { font-size: clamp(2rem, 5vw, 2.8rem); letter-spacing: -0.02em; }
    h1 span:not(.logo) { background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    h1 .logo { font-size: 0.85em; }
    .tagline { font-size: 1.05rem; }
    nav { gap: 8px; margin: 16px 0 0; flex-wrap: wrap; }
    nav a { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel); color: var(--text); transition: border-color .15s, background .15s; }
    nav a:hover { border-color: var(--accent); }
    nav a[aria-current="page"] { background: linear-gradient(90deg, var(--accent), var(--accent-2)); color: var(--on-accent); border-color: transparent; text-decoration: none; }
    form, .card, .notice { box-shadow: 0 1px 2px rgb(0 0 0 / 12%), 0 8px 24px rgb(0 0 0 / 10%); }
    form { border-radius: 16px; padding: 20px; }
    .card { border-radius: 16px; padding: 18px 20px; transition: transform .15s ease, border-color .15s ease; }
    .results > .card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .card h2, .card h3 { font-size: 1.2rem; line-height: 1.3; }
    .card h2 a, .card h3 a { text-decoration: none; }
    .card h2 a:hover, .card h3 a:hover { text-decoration: underline; }
    button { background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 10px; padding: 10px 18px; box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 30%, transparent); }
    button:hover { filter: brightness(1.06); }
    input, select, textarea { border-radius: 10px; }
    select { width: 100%; min-width: 0; }
    .tags li { background: color-mix(in srgb, var(--accent) 10%, var(--panel)); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); color: var(--text); }
    .tags li:first-child { background: color-mix(in srgb, var(--accent-2) 16%, var(--panel)); border-color: color-mix(in srgb, var(--accent-2) 45%, var(--border)); }
    .summary { font-size: 0.95rem; }
    .card-actions, .study-link { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .study-link a, a.study-link { font-weight: 600; text-decoration: none; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--control-border); }
    .study-link a::before, a.study-link::before { content: "📚 "; }
    .inline-form { background: none; border: 0; padding: 0; box-shadow: none; display: inline; }
    button.checkin { padding: 6px 14px; border-radius: 999px; font-size: 0.95rem; }
    .attended { margin: 0; font-weight: 600; }
    .badges { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .badge { display: grid; gap: 4px; justify-items: center; text-align: center; padding: 16px 12px; border-radius: 16px; border: 1px solid var(--border); background: var(--panel); }
    .badge.earned { border-color: var(--accent-2); background: linear-gradient(160deg, color-mix(in srgb, var(--accent-2) 22%, var(--panel)), var(--panel)); box-shadow: 0 6px 20px color-mix(in srgb, var(--accent-2) 25%, transparent); }
    .badge.locked .badge-emoji { filter: grayscale(1); opacity: .7; }
    .badge-emoji { font-size: 2.2rem; line-height: 1; }
    .badge-name { font-weight: 700; }
    .badge-desc, .badge-progress { font-size: 0.85rem; color: var(--muted); }
    .badge.earned .badge-progress { color: var(--text); font-weight: 600; }
    .celebrate { font-size: 1.15rem; font-weight: 700; padding: 12px 16px; border-radius: 12px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 20%, var(--panel)), color-mix(in srgb, var(--accent-2) 20%, var(--panel))); border: 1px solid var(--accent-2); }
    .ideas li::marker { color: var(--accent-2); font-weight: 700; }
    @media (prefers-reduced-motion: reduce) { .card, nav a { transition: none; } .results > .card:hover { transform: none; } }
    button.secondary { background: transparent; color: var(--text); border: 1px solid var(--control-border); }
  </style>
</head>
<body>
  <a class="skip" href="#${escapeHtml(page.skipTarget)}">Skip to main content</a>
  <header>
    <h1><span class="logo" aria-hidden="true">🧭</span> kube<span>compass</span></h1>
    <nav aria-label="Main">${navLink("talks", "/", "Talks")}${navLink("ask", "/ask", "Ask")}${navLink("people", "/people", "Hallway track")}</nav>
    <p class="tagline">${escapeHtml(page.tagline)}</p>
  </header>
  <main>
    ${page.content}
  </main>
  <footer>${escapeHtml(page.footer)}</footer>
</body>
</html>`;
}
