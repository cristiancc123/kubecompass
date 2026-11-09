import {
  MAX_CONTACT_LENGTH,
  MAX_INTERESTS_LENGTH,
  MAX_NAME_LENGTH,
  type Attendee,
  type AttendeeInput,
  type AttendeeMatch,
} from "./people.js";
import { computeBadges, type Badge } from "./badges.js";
import type { SessionHit } from "./search.js";
import { escapeHtml, formatSlot, renderLayout, truncate } from "./ui.js";

const TAGLINE = "Meet the people who care about the same things you do. The hallway track is half of KubeCon.";
const FOOTER =
  "Profiles live in Elasticsearch and are matched with hybrid BM25 + semantic retrieval. Delete yours from your profile page at any time.";

export interface PeopleFormModel {
  values?: Partial<AttendeeInput>;
  error?: string;
}

/** The sign-up form. A plain POST, so it works without JavaScript. */
export function renderPeopleForm({ values = {}, error }: PeopleFormModel = {}): string {
  const errorBlock = error ? `<p class="error" role="alert" id="form-error">${escapeHtml(error)}</p>` : "";
  const described = error ? ' aria-describedby="form-error"' : "";
  const content = `<section id="people" tabindex="-1" aria-labelledby="people-title">
      <h2 class="section" id="people-title">Find your people</h2>
      <p class="notice">What you enter here is shown to the attendees you match with. Leave out anything private. You get a private link to your profile, where you can delete it.</p>
      ${errorBlock}
      <form method="post" action="/people"${described}>
        <label for="name">Name or nickname
          <input id="name" name="name" required maxlength="${MAX_NAME_LENGTH}" autocomplete="nickname" value="${escapeHtml(values.name ?? "")}" />
        </label>
        <label for="interests">What do you work on, and what do you want to talk about?
          <textarea id="interests" name="interests" required minlength="10" maxlength="${MAX_INTERESTS_LENGTH}" aria-describedby="interests-hint">${escapeHtml(values.interests ?? "")}</textarea>
        </label>
        <p class="hint" id="interests-hint">For example: "I run Kubernetes for a hospital, fighting GPU costs, curious about Kueue and multi-tenant clusters."</p>
        <label for="contact">How can people reach you? (optional)
          <input id="contact" name="contact" maxlength="${MAX_CONTACT_LENGTH}" aria-describedby="contact-hint" value="${escapeHtml(values.contact ?? "")}" />
        </label>
        <p class="hint" id="contact-hint">A Slack handle, a Bluesky account, or "red hat, booth S12". Shown as plain text.</p>
        <div><button type="submit">Find my people</button></div>
      </form>
    </section>`;
  return renderLayout({
    title: "Hallway track · kubecompass",
    description: "Match with KubeCon attendees who share your interests.",
    current: "people",
    tagline: TAGLINE,
    skipTarget: "people",
    content,
    footer: FOOTER,
  });
}

function renderMatch(match: AttendeeMatch, index: number): string {
  const contact = match.contact
    ? `<p class="meta">Reach them: <span class="contact">${escapeHtml(match.contact)}</span></p>`
    : `<p class="meta">No contact shared. Look for them in the sessions below.</p>`;
  const sample = match.sample ? `<ul class="tags" aria-label="Tags"><li>Sample profile</li></ul>` : "";
  return `<li class="card">
  <article aria-labelledby="m-${index}">
    <h3 id="m-${index}">${escapeHtml(match.name)}</h3>
    <p class="desc">${escapeHtml(truncate(match.interests, 300))}</p>
    ${contact}
    ${sample}
  </article>
</li>`;
}

function renderTalk(hit: SessionHit, attendee: Attendee, checkInEnabled: boolean): string {
  const attended = (attendee.attended ?? []).some((t) => t.id === hit.id);
  const action = attended
    ? `<p class="attended"><span aria-hidden="true">✅</span> Attended</p>`
    : checkInEnabled && !attendee.sample
      ? `<form method="post" action="/people/${escapeHtml(attendee.id)}/attend" class="inline-form">
    <input type="hidden" name="session" value="${escapeHtml(hit.id)}" />
    <button type="submit" class="checkin">I attended<span class="visually-hidden">: ${escapeHtml(hit.title)}</span></button>
  </form>`
      : "";
  return `<li class="card">
  <h3><a href="${escapeHtml(hit.url)}" rel="noopener" target="_blank">${escapeHtml(hit.title)}</a></h3>
  <p class="meta"><time datetime="${escapeHtml(hit.start)}">${escapeHtml(formatSlot(hit.start, hit.end))}</time> · ${escapeHtml(hit.room || "Room to be announced")}</p>
  <div class="card-actions">
    <a class="study-link" href="/talks/${escapeHtml(hit.id)}/study">Study this talk<span class="visually-hidden">: ${escapeHtml(hit.title)}</span></a>
    ${action}
  </div>
</li>`;
}

function renderBadge(badge: Badge): string {
  const state = badge.earned ? "earned" : "locked";
  return `<li class="badge ${state}">
  <span class="badge-emoji" aria-hidden="true">${badge.earned ? badge.emoji : "🔒"}</span>
  <span class="badge-name">${escapeHtml(badge.name)}</span>
  <span class="badge-desc">${escapeHtml(badge.description)}</span>
  <span class="badge-progress">${badge.earned ? "Collected" : escapeHtml(badge.progress)}</span>
</li>`;
}

/** The collection: earned badges first, then the ones still to chase. */
function renderBadges(attendee: Attendee, celebrate: Badge[]): string {
  if (attendee.sample) {
    return `<p class="notice">Sample profiles don't collect badges. <a href="/people">Create your profile</a> to start your collection.</p>`;
  }
  const badges = computeBadges(attendee.attended ?? []);
  const earned = badges.filter((b) => b.earned);
  const ordered = [...earned, ...badges.filter((b) => !b.earned)];
  const party =
    celebrate.length > 0
      ? `<p class="celebrate" role="status"><span aria-hidden="true">🎉</span> New badge${celebrate.length > 1 ? "s" : ""}: ${celebrate.map((b) => escapeHtml(b.name)).join(", ")}!</p>`
      : "";
  return `${party}
      <p class="meta">${earned.length} of ${badges.length} collected · ${(attendee.attended ?? []).length} ${(attendee.attended ?? []).length === 1 ? "talk" : "talks"} attended. Check in to talks below to earn more.</p>
      <ul class="badges">${ordered.map(renderBadge).join("\n")}</ul>`;
}

const sampleNote = `<p class="notice">This is a sample profile seeded for the demo. Create your own to get matched.</p>
    <p><a href="/people">Create my profile</a></p>`;

function deleteForm(id: string): string {
  return `<section aria-labelledby="delete-title">
      <h2 class="section" id="delete-title">Done networking?</h2>
      <form method="post" action="/people/${escapeHtml(id)}/delete">
        <div><button type="submit" class="secondary">Delete my profile</button></div>
      </form>
    </section>`;
}

export interface ProfileModel {
  attendee: Attendee;
  matches: AttendeeMatch[] | null;
  talks: SessionHit[] | null;
  /** True right after sign-up, to remind them to keep the link. */
  created?: boolean;
  /** True right after a check-in. */
  checkedIn?: boolean;
  /** Badges the last check-in earned. */
  celebrate?: Badge[];
  checkInEnabled?: boolean;
}

/** An attendee's private page: their matches, talks for them, and a delete button. */
export function renderProfile({
  attendee,
  matches,
  talks,
  created,
  checkedIn,
  celebrate = [],
  checkInEnabled = false,
}: ProfileModel): string {
  const welcome = created
    ? `<p class="notice" role="status">Your profile is live. Bookmark this page: its link is the only way back to it.</p>`
    : "";
  const matchList =
    matches === null
      ? `<p class="error" role="alert">Matches are temporarily unavailable. Reload in a moment.</p>`
      : matches.length === 0
        ? `<p class="empty">Nobody matches yet. Check back after a few more people sign up.</p>`
        : `<ol class="results">${matches.map(renderMatch).join("\n")}</ol>`;
  const talkList =
    talks === null
      ? `<p class="error" role="alert">Talk suggestions are temporarily unavailable.</p>`
      : talks.length === 0
        ? `<p class="empty">No talks found for these interests.</p>`
        : `<ol class="results">${talks.map((hit) => renderTalk(hit, attendee, checkInEnabled)).join("\n")}</ol>`;

  const content = `<section id="profile" tabindex="-1" aria-labelledby="profile-title">
      ${welcome}
      <h2 class="section" id="profile-title">Hi, ${escapeHtml(attendee.name)}</h2>
      <p class="desc">${escapeHtml(attendee.interests)}</p>
    </section>
    <section id="badges" aria-labelledby="badges-title">
      <h2 class="section" id="badges-title"><span aria-hidden="true">🏅</span> Your badges</h2>
      ${checkedIn && celebrate.length === 0 ? `<p class="notice" role="status">Checked in. Keep going!</p>` : ""}
      ${renderBadges(attendee, celebrate)}
    </section>
    <section aria-labelledby="matches-title">
      <h2 class="section" id="matches-title">People to meet</h2>
      ${matchList}
    </section>
    <section aria-labelledby="talks-title">
      <h2 class="section" id="talks-title">Talks where you'll find them</h2>
      ${talkList}
    </section>
    ${attendee.sample ? sampleNote : deleteForm(attendee.id)}`;
  return renderLayout({
    title: `${attendee.name} · Hallway track · kubecompass`,
    description: "Your hallway-track matches at KubeCon.",
    current: "people",
    tagline: TAGLINE,
    skipTarget: "profile",
    content,
    footer: FOOTER,
  });
}

/** Shown after a profile is deleted, or when a profile link no longer exists. */
export function renderPeopleMessage(message: string): string {
  return renderLayout({
    title: "Hallway track · kubecompass",
    description: "Match with KubeCon attendees who share your interests.",
    current: "people",
    tagline: TAGLINE,
    skipTarget: "message",
    content: `<section id="message" tabindex="-1"><p class="notice" role="status">${escapeHtml(message)}</p><p><a href="/people">Create a new profile</a></p></section>`,
    footer: FOOTER,
  });
}
