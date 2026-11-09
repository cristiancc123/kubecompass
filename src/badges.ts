/** A talk an attendee checked in to, with what the badges need to know about it. */
export interface AttendedTalk {
  id: string;
  title: string;
  track: string;
  day: string;
  venue: string;
}

export interface Badge {
  /** Stable id, safe for URLs. */
  id: string;
  emoji: string;
  name: string;
  description: string;
  earned: boolean;
  /** "2 of 3 talks" for badges still to earn. */
  progress: string;
}

/** Talks in one track that make you its trainer, Pokémon style. */
export const TRACK_TRAINER_TALKS = 2;

interface Milestone {
  id: string;
  emoji: string;
  name: string;
  description: string;
  target: number;
  unit: string;
  count: (talks: AttendedTalk[]) => number;
}

const distinct = (values: string[]) => new Set(values.filter(Boolean)).size;

const MILESTONES: Milestone[] = [
  {
    id: "first-talk",
    emoji: "🎟️",
    name: "First steps",
    description: "Check in to your first talk.",
    target: 1,
    unit: "talk",
    count: (talks) => talks.length,
  },
  {
    id: "hat-trick",
    emoji: "🔥",
    name: "Hat trick",
    description: "Attend 3 talks.",
    target: 3,
    unit: "talks",
    count: (talks) => talks.length,
  },
  {
    id: "explorer",
    emoji: "🗺️",
    name: "Explorer",
    description: "Attend talks in both venues.",
    target: 2,
    unit: "venues",
    count: (talks) => distinct(talks.map((t) => t.venue)),
  },
  {
    id: "marathon",
    emoji: "🏃",
    name: "Marathon",
    description: "Attend talks on 3 different days.",
    target: 3,
    unit: "days",
    count: (talks) => distinct(talks.map((t) => t.day)),
  },
  {
    id: "champion",
    emoji: "🏆",
    name: "KubeCon champion",
    description: "Attend 10 talks.",
    target: 10,
    unit: "talks",
    count: (talks) => talks.length,
  },
];

function trackId(track: string): string {
  return `trainer-${track
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/**
 * Every badge with its state: milestones always show, earned or locked, so
 * the collection has something to chase; track trainer badges appear once
 * you have attended a talk in that track.
 */
export function computeBadges(talks: AttendedTalk[]): Badge[] {
  const milestones = MILESTONES.map((m) => {
    const have = Math.min(m.count(talks), m.target);
    return {
      id: m.id,
      emoji: m.emoji,
      name: m.name,
      description: m.description,
      earned: have >= m.target,
      progress: `${have} of ${m.target} ${m.unit}`,
    };
  });
  const byTrack = new Map<string, number>();
  for (const talk of talks) {
    if (talk.track) {
      byTrack.set(talk.track, (byTrack.get(talk.track) ?? 0) + 1);
    }
  }
  const trainers = [...byTrack.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([track, count]) => ({
      id: trackId(track),
      emoji: "🎖️",
      name: `${track} trainer`,
      description: `Attend ${TRACK_TRAINER_TALKS} ${track} talks.`,
      earned: count >= TRACK_TRAINER_TALKS,
      progress: `${Math.min(count, TRACK_TRAINER_TALKS)} of ${TRACK_TRAINER_TALKS} talks`,
    }));
  return [...milestones, ...trainers];
}

/** Badges earned by the latest check-in, to celebrate them. */
export function newlyEarned(before: AttendedTalk[], after: AttendedTalk[]): Badge[] {
  const had = new Set(
    computeBadges(before)
      .filter((b) => b.earned)
      .map((b) => b.id),
  );
  return computeBadges(after).filter((b) => b.earned && !had.has(b.id));
}
