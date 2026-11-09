import { MAX_QUESTION_LENGTH, type AskResult } from "./ask.js";
import type { SessionHit } from "./search.js";
import { escapeHtml, formatSlot, renderLayout } from "./ui.js";

/** Shown when nothing is cited, so a weak answer still leads somewhere. */
const RELATED_COUNT = 3;

export interface AskPageModel {
  question: string;
  result?: AskResult | null;
  error?: string;
  /** False when no model is configured: the form is shown but disabled. */
  available: boolean;
}

function renderSource(hit: SessionHit, n: number): string {
  return `<li class="card" id="src-${n}">
  <h3><span class="ref">[${n}]</span> <a href="${escapeHtml(hit.url)}" rel="noopener" target="_blank">${escapeHtml(hit.title)}</a></h3>
  <p class="meta"><time datetime="${escapeHtml(hit.start)}">${escapeHtml(formatSlot(hit.start, hit.end))}</time> · ${escapeHtml(hit.room || "Room to be announced")}</p>
  ${hit.speakers ? `<p class="speakers">${escapeHtml(hit.speakers)}</p>` : ""}
</li>`;
}

/** The model's text is escaped like any other input; only citations become links. */
function renderAnswer(result: AskResult): string {
  if (result.refused) {
    return `<p class="notice" role="status">The assistant can't answer that one. Try asking about sessions, topics or speakers.</p>`;
  }
  if (result.sources.length === 0) {
    return `<p class="empty" role="status">No sessions match that question. Try other words, like "service mesh" or "GPU scheduling".</p>`;
  }
  const answer = result.parts
    .map((part) =>
      part.kind === "text"
        ? escapeHtml(part.text)
        : `<a class="ref" href="#src-${part.source}" aria-label="Source ${part.source}">[${part.source}]</a>`,
    )
    .join("");
  const listed = result.cited.length > 0 ? result.cited : result.sources.slice(0, RELATED_COUNT).map((_, i) => i + 1);
  const heading = result.cited.length > 0 ? "Sources" : "Related sessions";
  return `<div class="card answer" role="status"><p class="desc">${answer.replace(/\n+/g, "<br />")}</p></div>
    <h2 class="section" id="sources-title">${heading}</h2>
    <ol class="results" aria-labelledby="sources-title">${listed.map((n) => renderSource(result.sources[n - 1], n)).join("\n")}</ol>`;
}

/** Ask a question in plain words; the answer cites the sessions it comes from. */
export function renderAskPage({ question, result, error, available }: AskPageModel): string {
  const body = !available
    ? `<p class="notice" role="status">The assistant is not configured on this deployment. <a href="/">Search the talks</a> instead.</p>`
    : error
      ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
      : result
        ? renderAnswer(result)
        : "";
  const disabled = available ? "" : " disabled";
  const content = `<form method="get" action="/ask" role="search">
      <div class="row">
        <label for="q">Ask about the schedule
          <input id="q" name="q" type="search" maxlength="${MAX_QUESTION_LENGTH}" placeholder="I'm new to platform engineering, what should I see on Tuesday?" value="${escapeHtml(question)}"${disabled} autofocus />
        </label>
        <button type="submit"${disabled}>Ask</button>
      </div>
      <p class="hint">Answers come from Claude, grounded in the sessions found by hybrid search. Check the linked sessions before you plan your day.</p>
    </form>
    <section id="answer" aria-live="polite">${body}</section>`;
  return renderLayout({
    title: "Ask · kubecompass",
    description: "Ask questions about the KubeCon schedule and get answers that cite the sessions.",
    current: "ask",
    tagline: "Ask in plain words. Every answer cites the sessions it comes from.",
    skipTarget: "answer",
    content,
    footer: "Retrieval by Elasticsearch hybrid search, answers by Claude. Times in Mountain Standard Time.",
  });
}
