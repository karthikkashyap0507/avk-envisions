import { MARKS_PER_QUESTION } from '@/lib/marking';
import { z } from 'zod';

import { cuidSchema } from './common';

/**
 * Admin write schemas.
 *
 * These guard the content-authoring path. The option rules are the important
 * part: a question saved with no correct option, or with two correct options on
 * a single-correct item, would silently mis-mark every student who answers it.
 * That is caught here rather than at scoring time.
 */

const optionSchema = z.object({
  id: cuidSchema.optional(),
  body: z.string().trim().min(1, 'Option text cannot be empty').max(2000),
  isCorrect: z.boolean().default(false),
  /** Set when the option is itself a diagram — a pictograph or a graph. */
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value === '' || value.startsWith('/') || /^https?:\/\//.test(value),
      'Enter a path beginning with / or a full http(s) URL',
    )
    .nullish(),
});

export const questionSchema = z
  .object({
    examId: cuidSchema,
    subjectId: cuidSchema,
    chapterId: cuidSchema.nullish(),
    topicId: cuidSchema.nullish(),

    type: z.enum(['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'TRUE_FALSE', 'NUMERICAL']),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    status: z.enum(['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),

    body: z.string().trim().min(5, 'Write the question').max(10_000),
    passage: z.string().trim().max(10_000).nullish(),
    /**
     * A figure lives under `/uploads/figures/...` on this host, so a bare
     * `.url()` — which demands a scheme — would reject every image the PDF
     * import produces. An absolute URL is still allowed for anything hosted
     * elsewhere.
     */
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => value === '' || value.startsWith('/') || /^https?:\/\//.test(value),
        'Enter a path beginning with / or a full http(s) URL',
      )
      .nullish(),

    marks: z.coerce.number().min(0.25).max(100).default(MARKS_PER_QUESTION),
    negativeMarks: z.coerce.number().min(0).max(100).default(0),

    numericalAnswer: z.coerce.number().finite().nullish(),
    numericalTolerance: z.coerce.number().min(0).max(1000).nullish(),

    explanation: z.string().trim().max(10_000).nullish(),
    detailedSolution: z.string().trim().max(50_000).nullish(),
    concept: z.string().trim().max(200).nullish(),
    source: z.string().trim().max(200).nullish(),
    examYear: z.coerce.number().int().min(1950).max(2100).nullish(),
    reviewNote: z.string().trim().max(2000).nullish(),

    /**
     * Attach the new question to this test as well as the bank.
     *
     * Creating a question from inside a paper put it in the bank and nowhere
     * else, so the paper's count never moved and the question appeared to
     * vanish. Optional: creating from the bank itself attaches nothing.
     */
    attachToTestId: cuidSchema.optional(),

    options: z.array(optionSchema).max(10).default([]),
  })
  .superRefine((input, ctx) => {
    const addIssue = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });

    if (input.type === 'NUMERICAL') {
      if (input.numericalAnswer === null || input.numericalAnswer === undefined) {
        addIssue('A numerical question needs an expected answer', 'numericalAnswer');
      }
      return;
    }

    // --- Option-based types ------------------------------------------------
    const correct = input.options.filter((o) => o.isCorrect).length;

    if (input.options.length < 2) {
      addIssue('Add at least two options', 'options');
      return;
    }
    if (correct === 0) {
      addIssue('Mark one option as correct — otherwise the question cannot be scored', 'options');
    }
    if (input.type !== 'MULTIPLE_CORRECT' && correct > 1) {
      addIssue('A single-correct question can only have one correct option', 'options');
    }
    if (input.type === 'TRUE_FALSE' && input.options.length !== 2) {
      addIssue('A true/false question needs exactly two options', 'options');
    }

    const texts = input.options.map((o) => o.body.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) {
      addIssue('Two options have the same text', 'options');
    }
  });

export type QuestionInput = z.infer<typeof questionSchema>;

export const testSchema = z.object({
  examId: cuidSchema,
  testSeriesId: cuidSchema.nullish(),

  title: z.string().trim().min(3, 'Give the test a title').max(200),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only'),
  description: z.string().trim().max(2000).nullish(),
  instructions: z.string().trim().max(10_000).nullish(),

  category: z
    .enum(['FULL_MOCK', 'SECTIONAL', 'CHAPTER', 'TOPIC', 'PRACTICE', 'PREVIOUS_YEAR', 'CUSTOM'])
    .default('FULL_MOCK'),
  /**
   * How the paper runs. Only PRACTICE reveals answers as a student goes.
   *
   * An unrecognised value is corrected to EXAM rather than refused. The column
   * is a plain string with no constraint, so a word from an earlier vocabulary
   * can be sitting in it — and the builder has no mode field, so it loads that
   * value, carries it invisibly and posts it back. Refusing it made saving a
   * KAS-50 day paper impossible with nothing on the form to fix: "Invalid enum
   * value. Expected 'EXAM' | 'PRACTICE', received 'TIMED'".
   *
   * EXAM is the safe correction. PRACTICE is what hands a student the answer
   * key mid-paper, so it is only ever set deliberately, never inferred from
   * something unrecognised.
   */
  mode: z
    .string()
    .transform((value) => (value === 'PRACTICE' ? 'PRACTICE' : 'EXAM'))
    .default('EXAM'),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  accessType: z.enum(['FREE', 'PAID', 'SUBSCRIPTION']).default('FREE'),

  durationMinutes: z.coerce.number().int().min(1).max(600).default(60),
  /** 0 means unlimited re-attempts. */
  // 0 = unlimited. Practice papers are for practising: capping retries
  // stopped a student re-sitting a paper they had just learned from.
  maxAttempts: z.coerce.number().int().min(0).max(50).default(0),
  passingMarks: z.coerce.number().min(0).max(10_000).default(0),

  negativeMarkingEnabled: z.boolean().default(true),
  defaultNegativeRatio: z.coerce.number().min(0).max(1).default(0.25),
  randomizeQuestions: z.boolean().default(false),
  randomizeOptions: z.boolean().default(false),
  showResultImmediately: z.boolean().default(true),

  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
});

export type TestInput = z.infer<typeof testSchema>;

/** Attach, detach or reorder the questions on a test. */
export const testQuestionsSchema = z.object({
  /**
   * `clear` empties the whole paper, which is what a re-import wants: the old
   * questions have to go before the new ones arrive, and removing a hundred
   * one at a time is not a workflow.
   */
  /**
   * `move` takes questions off this paper and puts them on another in one
   * step. Importing to the wrong destination happens, and undoing it by
   * detaching a hundred questions here and attaching them there loses their
   * order and takes an afternoon.
   */
  action: z.enum(['attach', 'detach', 'reorder', 'publish', 'clear', 'move']),
  questionIds: z.array(cuidSchema).max(500).default([]),
  /** For reorder: the full ordered list of testQuestion ids. */
  order: z.array(cuidSchema).max(500).default([]),
  /** For move: the paper the questions are going to. */
  destinationTestId: cuidSchema.optional(),
});

/**
 * Clearing every paper in a series at once.
 *
 * Typing the series name is required. This removes hundreds of questions
 * across a dozen papers and there is no undo beyond a database restore, so the
 * confirmation is a deliberate obstacle rather than a formality.
 */
export const clearSeriesQuestionsSchema = z.object({
  seriesId: cuidSchema,
  /** Must equal the series name exactly. */
  confirm: z.string().trim().min(1),
});

export const userActionSchema = z.object({
  userId: cuidSchema,
  action: z.enum(['suspend', 'activate', 'make_admin', 'make_student', 'revoke_sessions']),
});

export const ticketReplySchema = z.object({
  ticketId: cuidSchema,
  body: z.string().trim().min(1).max(5000),
  /** Internal notes are never shown to the student. */
  isInternalNote: z.boolean().default(false),
  status: z.enum(['OPEN', 'WAITING', 'RESOLVED', 'CLOSED']).optional(),
});

export const settingSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().max(5000),
});
