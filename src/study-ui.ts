import type { Session } from "./sessions.js";
import { LANGUAGES, LEVELS, type Language, type Level, type StudyResult } from "./study.js";
import { escapeHtml, formatSlot, renderLayout } from "./ui.js";

const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Section headings follow the guide's language, so the page reads in one language. */
const HEADINGS: Record<Language, { ideas: string; review: string; show: string; challenge: string; done: string }> = {
  es: {
    ideas: "Ideas clave",
    review: "Repaso",
    show: "Ver respuesta",
    challenge: "Reto práctico",
    done: "Lo lograste cuando",
  },
  en: {
    ideas: "Key ideas",
    review: "Review",
    show: "Show answer",
    challenge: "Hands-on challenge",
    done: "You're done when",
  },
  pt: {
    ideas: "Ideias-chave",
    review: "Revisão",
    show: "Ver resposta",
    challenge: "Desafio prático",
    done: "Você conseguiu quando",
  },
  fr: {
    ideas: "Idées clés",
    review: "Révision",
    show: "Voir la réponse",
    challenge: "Défi pratique",
    done: "C'est réussi quand",
  },
};

export interface StudyPageModel {
  session: Session;
  level: Level;
  language: Language;
  result?: StudyResult | null;
  error?: string;
}

function options<T extends string>(values: readonly T[], selected: T, label: (value: T) => string): string {
  return values
    .map(
      (value) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label(value))}</option>`,
    )
    .join("");
}

function renderGuide(result: StudyResult, language: Language): string {
  if (result.refused) {
    return `<p class="notice" role="status">The assistant can't write a guide for this session. Try another one.</p>`;
  }
  const { guide } = result;
  const h = HEADINGS[language];
  const ideas = guide.keyIdeas.map((idea) => `<li>${escapeHtml(idea)}</li>`).join("");
  const review = guide.review
    .map(
      (card) =>
        `<li class="card"><p class="desc">${escapeHtml(card.question)}</p><details><summary>${h.show}</summary><p class="desc">${escapeHtml(card.answer)}</p></details></li>`,
    )
    .join("");
  const steps = guide.challenge.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  return `<section aria-labelledby="ideas-title">
      <h2 class="section" id="ideas-title">${h.ideas}</h2>
      <ol class="card ideas">${ideas}</ol>
    </section>
    <section aria-labelledby="review-title">
      <h2 class="section" id="review-title">${h.review}</h2>
      <ol class="results">${review}</ol>
    </section>
    <section aria-labelledby="challenge-title">
      <h2 class="section" id="challenge-title">${h.challenge}: ${escapeHtml(guide.challenge.title)}</h2>
      <div class="card">
        <ol class="steps">${steps}</ol>
        <p class="meta"><strong>${h.done}:</strong> ${escapeHtml(guide.challenge.doneWhen)}</p>
      </div>
    </section>`;
}

/**
 * One session turned into something to remember and practice: key ideas,
 * flashcards and a challenge at the learner's level, in their language.
 */
export function renderStudyPage({ session, level, language, result, error }: StudyPageModel): string {
  const body = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : result
      ? renderGuide(result, language)
      : "";
  const content = `<section id="study" tabindex="-1" aria-labelledby="study-title">
      <h2 class="section" id="study-title">Study: <a href="${escapeHtml(session.url)}" rel="noopener" target="_blank">${escapeHtml(session.title)}</a></h2>
      <p class="meta"><time datetime="${escapeHtml(session.start)}">${escapeHtml(formatSlot(session.start, session.end))}</time> · ${escapeHtml(session.room || "Room to be announced")}</p>
      <form method="get" action="/talks/${escapeHtml(session.id)}/study">
        <div class="filters">
          <label for="level">My level<select id="level" name="level">${options(LEVELS, level, (v) => LEVEL_LABELS[v])}</select></label>
          <label for="lang">Language<select id="lang" name="lang">${options(Object.keys(LANGUAGES) as Language[], language, (v) => LANGUAGES[v])}</select></label>
        </div>
        <div><button type="submit" name="go" value="1">Make my study guide</button></div>
      </form>
      <p class="hint">Written by Claude from the session's description, not from a recording. Use it to prepare before the talk and to review after it.</p>
      <div aria-live="polite">${body}</div>
    </section>`;
  return renderLayout({
    title: `Study ${session.title} · kubecompass`,
    description: "Key ideas, review questions and a hands-on challenge for one KubeCon session.",
    current: "talks",
    tagline: "Remember what matters and practice it at your level, in your language.",
    skipTarget: "study",
    content,
    footer: "Study guides by Claude from the official session descriptions. Check the talk itself for the details.",
  });
}

/** Own keys only: `in` would also accept inherited names such as "constructor". */
function isLanguage(value: string): value is Language {
  return Object.hasOwn(LANGUAGES, value);
}

/** Shown instead of a study page when the session or the assistant isn't there. */
export function renderStudyMessage(message: string): string {
  return renderLayout({
    title: "Study · kubecompass",
    description: "Key ideas, review questions and a hands-on challenge for KubeCon sessions.",
    current: "talks",
    tagline: "Remember what matters and practice it at your level, in your language.",
    skipTarget: "message",
    content: `<section id="message" tabindex="-1"><p class="notice" role="status">${escapeHtml(message)}</p><p><a href="/">Search the talks</a></p></section>`,
    footer: "Study guides by Claude from the official session descriptions. Check the talk itself for the details.",
  });
}

/** Picks the guide language from the query string, then the browser's Accept-Language. */
export function pickLanguage(queryLang: string | undefined, acceptLanguage: string | undefined): Language {
  if (queryLang && isLanguage(queryLang)) {
    return queryLang;
  }
  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.trim().slice(0, 2).toLowerCase())
    .find(isLanguage);
  return (preferred as Language | undefined) ?? "en";
}

export function pickLevel(queryLevel: string | undefined): Level {
  return LEVELS.includes(queryLevel as Level) ? (queryLevel as Level) : "beginner";
}
