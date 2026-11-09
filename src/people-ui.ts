import {
  MAX_CONTACT_LENGTH,
  MAX_INTERESTS_LENGTH,
  MAX_NAME_LENGTH,
  type Attendee,
  type AttendeeInput,
  type AttendeeMatch,
} from "./people.js";
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
  const content = `<section id="people" aria-labelledby="people-title">
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

function renderTalk(hit: SessionHit): string {
  return `<li class="card">
  <h3><a href="${escapeHtml(hit.url)}" rel="noopener" target="_blank">${escapeHtml(hit.title)}</a></h3>
  <p class="meta"><time datetime="${escapeHtml(hit.start)}">${escapeHtml(formatSlot(hit.start, hit.end))}</time> · ${escapeHtml(hit.room || "Room to be announced")}</p>
</li>`;
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
}

/** An attendee's private page: their matches, talks for them, and a delete button. */
export function renderProfile({ attendee, matches, talks, created }: ProfileModel): string {
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
        : `<ol class="results">${talks.map(renderTalk).join("\n")}</ol>`;

  const content = `<section id="profile" aria-labelledby="profile-title">
      ${welcome}
      <h2 class="section" id="profile-title">Hi, ${escapeHtml(attendee.name)}</h2>
      <p class="desc">${escapeHtml(attendee.interests)}</p>
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
    content: `<section id="message"><p class="notice" role="status">${escapeHtml(message)}</p><p><a href="/people">Create a new profile</a></p></section>`,
    footer: FOOTER,
  });
}
