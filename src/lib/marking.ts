/**
 * The KPSC KAS Prelims marking scheme.
 *
 * Two marks for a correct answer, one quarter of that deducted for a wrong one,
 * nothing for a blank. A hundred-question paper is therefore out of 200.
 *
 * These live in one place because they were previously written out at each
 * call site — the seeds, the admin validators, the importer and the instruction
 * text all carried their own copy of "1 mark, 0.25 negative". When the real
 * scheme turned out to be 2 and 0.5, every one of those was wrong
 * independently, and a paper scored out of 100 instead of 200.
 *
 * Scoring reads absolute values, not the ratio: `NEGATIVE_MARKS_PER_QUESTION`
 * is what is actually subtracted. The ratio is kept for display and for tests
 * that assert the two stay consistent.
 *
 * KAS is the default. An exam marked differently — KEA FDA / SDA — declares
 * its own scheme at the bottom of this file, and `markingSchemeFor` is how a
 * caller that knows the exam gets the right one.
 */
import { FDA_SDA_EXAM_SLUG } from './enums';

/** Awarded for a correct answer. */
export const MARKS_PER_QUESTION = 2;

/** Fraction of the question's marks lost for a wrong answer. */
export const NEGATIVE_RATIO = 0.25;

/** Deducted for a wrong answer — the ratio applied to the marks. */
export const NEGATIVE_MARKS_PER_QUESTION = MARKS_PER_QUESTION * NEGATIVE_RATIO;

/** Total for a paper of `count` questions. */
export function totalMarksFor(count: number): number {
  return count * MARKS_PER_QUESTION;
}

/** One-line description of the scheme, for instructions and FAQs. */
export const MARKING_SCHEME_TEXT =
  `Each question carries ${MARKS_PER_QUESTION} marks. ` +
  `${NEGATIVE_MARKS_PER_QUESTION} marks are deducted for an incorrect answer. ` +
  'Unanswered questions carry no penalty.';

/** Short form, e.g. for a stat chip: "2 marks, −0.5 negative". */
export const MARKING_SCHEME_SHORT = `${MARKS_PER_QUESTION} marks, −${NEGATIVE_MARKS_PER_QUESTION} negative`;

// ---------------------------------------------------------------------------
// Other exams
// ---------------------------------------------------------------------------

/** What a correct answer earns and a wrong one costs, for one exam. */
export interface MarkingScheme {
  marks: number;
  negativeMarks: number;
}

/** The KAS scheme above, as a value. Every exam without its own uses it. */
export const KAS_MARKING: MarkingScheme = {
  marks: MARKS_PER_QUESTION,
  negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
};

/**
 * KEA FDA / SDA: one mark a question, a quarter of a mark off for a wrong
 * answer, nothing for a blank. A hundred-question paper is out of 100.
 */
export const FDA_SDA_MARKING: MarkingScheme = { marks: 1, negativeMarks: 0.25 };

/**
 * Exams marked differently from KAS, by exam slug.
 *
 * Keyed by exam because that is what a question belongs to: the importer and
 * the question editor both pick an exam before anything else, so the marks can
 * follow that choice rather than an admin remembering to retype them. Getting
 * this wrong is silent — a FDA paper keyed at KAS marks scores out of 200.
 */
const SCHEMES_BY_EXAM: Record<string, MarkingScheme> = {
  [FDA_SDA_EXAM_SLUG]: FDA_SDA_MARKING,
};

/** The scheme for an exam, by its slug. KAS unless the exam has its own. */
export function markingSchemeFor(examSlug: string | null | undefined): MarkingScheme {
  return (examSlug && SCHEMES_BY_EXAM[examSlug]) || KAS_MARKING;
}

/** "Each question carries 1 mark. 0.25 marks are deducted ..." for any scheme. */
export function markingSchemeText(scheme: MarkingScheme): string {
  return (
    `Each question carries ${scheme.marks} mark${scheme.marks === 1 ? '' : 's'}. ` +
    `${scheme.negativeMarks} marks are deducted for an incorrect answer. ` +
    'Unanswered questions carry no penalty.'
  );
}
