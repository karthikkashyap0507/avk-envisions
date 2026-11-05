import { HEARD_ABOUT_OTHER_MAX, HeardAbout } from '@/lib/enums';

/**
 * "How did you hear about us?" — how an answer is stored, and read back.
 *
 * Kept apart from both the form and the admin pages so the two cannot
 * disagree about what an answer means: the form writes through `toStored`,
 * every admin screen reads through `fromStored`.
 */

/** An answer as the admin pages show it. */
export interface HeardAboutAnswer {
  /** False for accounts that were never asked: older ones, and free-test leads. */
  asked: boolean;
  /** What was ticked, in the form's order. Empty when they skipped it. */
  codes: HeardAbout[];
  /** Their own words for "Other", when they gave any. */
  other: string | null;
}

/** The two columns written at registration. */
export function toStored(
  codes: readonly HeardAbout[],
  other?: string | null,
): { heardAboutJson: string; heardAboutOther: string | null } {
  const ordered = HeardAbout.values.filter((code) => codes.includes(code));
  // The text belongs to "Other": typed and then unticked, it is not an answer.
  const words = ordered.includes('OTHER') ? (other ?? '').trim().slice(0, HEARD_ABOUT_OTHER_MAX) : '';
  return { heardAboutJson: JSON.stringify(ordered), heardAboutOther: words || null };
}

/**
 * Reads the stored columns back.
 *
 * Defensive on purpose: anything that is not a JSON array of known codes —
 * a hand edit, an option since retired — is dropped rather than shown as a
 * code nobody can read, and never throws on a page listing every user.
 */
export function fromStored(json: string | null | undefined, other: string | null | undefined): HeardAboutAnswer {
  if (json === null || json === undefined) return { asked: false, codes: [], other: null };

  let parsed: unknown = [];
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = [];
  }
  const raw = Array.isArray(parsed) ? parsed : [];
  const codes = HeardAbout.values.filter((code) => raw.includes(code));

  return { asked: true, codes, other: codes.includes('OTHER') && other?.trim() ? other.trim() : null };
}

/** Per-option counts among students who were asked, for the admin summary. */
export interface HeardAboutSummary {
  /** Students who saw the question. */
  asked: number;
  /** Of those, how many ticked at least one option. */
  answered: number;
  /** How many ticked each option. One student can count towards several. */
  byCode: Record<HeardAbout, number>;
}

export function summarise(answers: readonly HeardAboutAnswer[]): HeardAboutSummary {
  const byCode = Object.fromEntries(HeardAbout.values.map((code) => [code, 0])) as Record<HeardAbout, number>;
  let asked = 0;
  let answered = 0;

  for (const answer of answers) {
    if (!answer.asked) continue;
    asked += 1;
    if (answer.codes.length > 0) answered += 1;
    for (const code of answer.codes) byCode[code] += 1;
  }

  return { asked, answered, byCode };
}
