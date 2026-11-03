import { describe, expect, it } from 'vitest';

import {
  FDA_SDA_MARKING,
  KAS_MARKING,
  MARKING_SCHEME_SHORT,
  MARKS_PER_QUESTION,
  NEGATIVE_MARKS_PER_QUESTION,
  NEGATIVE_RATIO,
  markingSchemeFor,
  markingSchemeText,
  totalMarksFor,
} from './marking';

/**
 * The scheme was wrong in production — 1 mark and 0.25 negative, so a
 * hundred-question paper scored out of 100 instead of 200. These lock the
 * published values down.
 */
describe('KAS marking scheme', () => {
  it('awards 2 marks a question', () => {
    expect(MARKS_PER_QUESTION).toBe(2);
  });

  it('deducts one quarter of the marks for a wrong answer', () => {
    expect(NEGATIVE_RATIO).toBe(0.25);
    expect(NEGATIVE_MARKS_PER_QUESTION).toBe(0.5);
    expect(NEGATIVE_MARKS_PER_QUESTION).toBe(MARKS_PER_QUESTION * NEGATIVE_RATIO);
  });

  it('puts a hundred-question paper out of 200', () => {
    expect(totalMarksFor(100)).toBe(200);
    expect(totalMarksFor(20)).toBe(40);
    expect(totalMarksFor(0)).toBe(0);
  });

  it('leaves a blind guess slightly positive, as one-quarter marking does', () => {
    // Four options, one correct. A quarter of the marks gained against three
    // quarters of the penalty comes to +marks/16 — small, but above zero.
    //
    // Worth stating precisely because the seeded blog post originally claimed
    // this was exactly zero. It never was: zero would require the penalty to
    // be a THIRD of the marks, not a quarter.
    const expected = 0.25 * MARKS_PER_QUESTION - 0.75 * NEGATIVE_MARKS_PER_QUESTION;
    expect(expected).toBeCloseTo(MARKS_PER_QUESTION / 16, 10);
    expect(expected).toBeGreaterThan(0);

    const breakEvenPenalty = (0.25 * MARKS_PER_QUESTION) / 0.75;
    expect(breakEvenPenalty).toBeCloseTo(MARKS_PER_QUESTION / 3, 10);
  });

  it('describes itself with the same numbers it enforces', () => {
    expect(MARKING_SCHEME_SHORT).toBe('2 marks, −0.5 negative');
  });
});

/**
 * KEA FDA / SDA is marked differently, and the marks are chosen by exam — so a
 * FDA paper must never fall back to the KAS scheme, and KAS must not change.
 */
describe('marking by exam', () => {
  it('marks KEA FDA / SDA +1 / −0.25, a hundred-question paper out of 100', () => {
    const scheme = markingSchemeFor('kea-fda-sda');
    expect(scheme).toEqual({ marks: 1, negativeMarks: 0.25 });
    expect(scheme).toBe(FDA_SDA_MARKING);
    expect(100 * scheme.marks).toBe(100);
  });

  it('keeps KAS, and any exam without a scheme of its own, on +2 / −0.5', () => {
    expect(markingSchemeFor('kas')).toEqual({ marks: 2, negativeMarks: 0.5 });
    expect(markingSchemeFor('some-new-exam')).toBe(KAS_MARKING);
    expect(markingSchemeFor(undefined)).toBe(KAS_MARKING);
    expect(markingSchemeFor(null)).toBe(KAS_MARKING);
  });

  it('describes the FDA scheme in the same numbers', () => {
    expect(markingSchemeText(FDA_SDA_MARKING)).toBe(
      'Each question carries 1 mark. 0.25 marks are deducted for an incorrect answer. ' +
        'Unanswered questions carry no penalty.',
    );
  });
});
