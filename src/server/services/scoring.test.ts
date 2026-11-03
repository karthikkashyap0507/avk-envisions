import { describe, expect, it } from 'vitest';

import {
  buildBreakdown,
  computePercentile,
  computeRank,
  evaluateAnswer,
  totalAttempt,
  type QuestionKey,
} from './scoring';
import { markingSchemeFor } from '@/lib/marking';

/**
 * Scoring is the one part of an exam platform where a bug is unforgivable — it
 * silently changes results that students act on. These tests cover the marking
 * rules exhaustively, including the edge cases that only surface in production.
 */

const singleCorrect: QuestionKey = {
  questionId: 'q1',
  type: 'SINGLE_CORRECT',
  marks: 1,
  negativeMarks: 0.25,
  correctOptionIds: ['b'],
};

const multiCorrect: QuestionKey = {
  questionId: 'q2',
  type: 'MULTIPLE_CORRECT',
  marks: 4,
  negativeMarks: 2,
  correctOptionIds: ['a', 'c'],
};

const numerical: QuestionKey = {
  questionId: 'q3',
  type: 'NUMERICAL',
  marks: 4,
  negativeMarks: 0,
  correctOptionIds: [],
  numericalAnswer: 15,
  numericalTolerance: 0.01,
};

describe('evaluateAnswer — single correct', () => {
  it('awards full marks for the correct option', () => {
    const result = evaluateAnswer(singleCorrect, { selectedOptionIds: ['b'] });
    expect(result).toEqual({ verdict: 'CORRECT', isCorrect: true, marksAwarded: 1 });
  });

  it('applies the negative penalty for a wrong option', () => {
    const result = evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] });
    expect(result).toEqual({ verdict: 'INCORRECT', isCorrect: false, marksAwarded: -0.25 });
  });

  it('scores an unanswered question as exactly zero, never negative', () => {
    const result = evaluateAnswer(singleCorrect, { selectedOptionIds: [] });
    expect(result).toEqual({ verdict: 'UNANSWERED', isCorrect: null, marksAwarded: 0 });
  });

  it('treats a missing answer row as unanswered', () => {
    expect(evaluateAnswer(singleCorrect, undefined).verdict).toBe('UNANSWERED');
  });

  it('suppresses the penalty when negative marking is disabled', () => {
    const result = evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] }, { negativeMarkingEnabled: false });
    expect(result.marksAwarded).toBe(0);
    expect(result.isCorrect).toBe(false);
  });
});

describe('evaluateAnswer — multiple correct (EXACT, the default)', () => {
  it('awards full marks only when the selection matches exactly', () => {
    expect(evaluateAnswer(multiCorrect, { selectedOptionIds: ['a', 'c'] }).marksAwarded).toBe(4);
  });

  it('ignores selection order', () => {
    expect(evaluateAnswer(multiCorrect, { selectedOptionIds: ['c', 'a'] }).isCorrect).toBe(true);
  });

  it('penalises a partial selection', () => {
    const result = evaluateAnswer(multiCorrect, { selectedOptionIds: ['a'] });
    expect(result).toEqual({ verdict: 'INCORRECT', isCorrect: false, marksAwarded: -2 });
  });

  it('penalises a superset that includes a wrong option', () => {
    expect(evaluateAnswer(multiCorrect, { selectedOptionIds: ['a', 'b', 'c'] }).isCorrect).toBe(false);
  });
});

describe('evaluateAnswer — multiple correct (PARTIAL)', () => {
  const partial = { multiSelectScheme: 'PARTIAL' as const };

  it('awards proportional marks for a correct subset', () => {
    const result = evaluateAnswer(multiCorrect, { selectedOptionIds: ['a'] }, partial);
    expect(result.marksAwarded).toBe(2);
  });

  it('awards full marks for the complete set', () => {
    expect(evaluateAnswer(multiCorrect, { selectedOptionIds: ['a', 'c'] }, partial).marksAwarded).toBe(4);
  });

  it('applies the full penalty as soon as any wrong option is chosen', () => {
    const result = evaluateAnswer(multiCorrect, { selectedOptionIds: ['a', 'b'] }, partial);
    expect(result.marksAwarded).toBe(-2);
  });
});

describe('evaluateAnswer — numerical', () => {
  it('accepts an exact match', () => {
    expect(evaluateAnswer(numerical, { selectedOptionIds: [], numericalValue: 15 }).isCorrect).toBe(true);
  });

  it('accepts a value inside the tolerance band', () => {
    expect(evaluateAnswer(numerical, { selectedOptionIds: [], numericalValue: 15.009 }).isCorrect).toBe(true);
  });

  it('rejects a value outside the tolerance band', () => {
    expect(evaluateAnswer(numerical, { selectedOptionIds: [], numericalValue: 15.5 }).isCorrect).toBe(false);
  });

  it('treats zero as an answer, not as a blank', () => {
    const zeroKey: QuestionKey = { ...numerical, numericalAnswer: 0 };
    const result = evaluateAnswer(zeroKey, { selectedOptionIds: [], numericalValue: 0 });
    expect(result.verdict).toBe('CORRECT');
  });

  it('treats null as unanswered', () => {
    expect(evaluateAnswer(numerical, { selectedOptionIds: [], numericalValue: null }).verdict).toBe(
      'UNANSWERED',
    );
  });

  it('refuses to mark a question with no key rather than guessing', () => {
    const keyless: QuestionKey = { ...numerical, numericalAnswer: null };
    const result = evaluateAnswer(keyless, { selectedOptionIds: [], numericalValue: 15 });
    expect(result).toEqual({ verdict: 'UNANSWERED', isCorrect: null, marksAwarded: 0 });
  });
});

describe('evaluateAnswer — malformed keys', () => {
  it('refuses to mark an option question with no correct option flagged', () => {
    const broken: QuestionKey = { ...singleCorrect, correctOptionIds: [] };
    expect(evaluateAnswer(broken, { selectedOptionIds: ['a'] }).marksAwarded).toBe(0);
  });
});

describe('totalAttempt', () => {
  it('aggregates a mixed attempt correctly', () => {
    const totals = totalAttempt([
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['b'] }), maxMarks: 1 },
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] }), maxMarks: 1 },
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: [] }), maxMarks: 1 },
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['b'] }), maxMarks: 1 },
    ]);

    expect(totals.correctCount).toBe(2);
    expect(totals.incorrectCount).toBe(1);
    expect(totals.unansweredCount).toBe(1);
    expect(totals.attemptedCount).toBe(3);
    expect(totals.maxScore).toBe(4);
    // 1 + 1 − 0.25 = 1.75
    expect(totals.score).toBe(1.75);
  });

  it('computes accuracy against attempted questions, not the total', () => {
    const totals = totalAttempt([
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['b'] }), maxMarks: 1 },
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] }), maxMarks: 1 },
      { evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: [] }), maxMarks: 1 },
    ]);
    // 1 correct of 2 attempted = 50%, not 33%.
    expect(totals.accuracy).toBe(50);
  });

  it('floors a net-negative score at zero', () => {
    const totals = totalAttempt(
      Array.from({ length: 4 }, () => ({
        evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] }),
        maxMarks: 1,
      })),
    );
    expect(totals.score).toBe(0);
  });

  it('does not accumulate floating-point drift over many questions', () => {
    const totals = totalAttempt(
      Array.from({ length: 100 }, () => ({
        evaluated: evaluateAnswer(singleCorrect, { selectedOptionIds: ['a'] }),
        maxMarks: 1,
      })),
    );
    expect(totals.maxScore).toBe(100);
    expect(totals.score).toBe(0);
  });

  it('handles an empty attempt without dividing by zero', () => {
    const totals = totalAttempt([]);
    expect(totals.score).toBe(0);
    expect(totals.accuracy).toBe(0);
    expect(totals.percentage).toBe(0);
  });
});

describe('ranking', () => {
  const scores = [90, 75, 75, 60, 40];

  it('ranks the top score first', () => {
    expect(computeRank(90, scores)).toBe(1);
  });

  it('gives tied scores the same rank', () => {
    expect(computeRank(75, scores)).toBe(2);
  });

  it('skips ranks after a tie (competition ranking)', () => {
    // Two students on 75 occupy 2nd; the next distinct score is 4th.
    expect(computeRank(60, scores)).toBe(4);
  });

  it('computes percentile as the share scoring at or below (NTA formula)', () => {
    // Top scorer: all 5 of 5 are at or below -> 100.
    expect(computePercentile(90, scores)).toBe(100);
    // Lowest scorer: only themselves -> 1/5 = 20.
    expect(computePercentile(40, scores)).toBe(20);
    // Tied pair at 75: 4 of 5 are at or below -> 80.
    expect(computePercentile(75, scores)).toBe(80);
  });

  it('reports 100 for the only attempt at a test', () => {
    // A student who is the first to attempt must not be told they are at the
    // 0th percentile.
    expect(computePercentile(50, [50])).toBe(100);
  });

  it('reports 100 for an empty cohort', () => {
    expect(computePercentile(50, [])).toBe(100);
  });
});

describe('buildBreakdown', () => {
  it('groups results and derives per-group accuracy', () => {
    const rows = buildBreakdown([
      {
        groupKey: 'phy',
        groupLabel: 'Physics',
        evaluated: { verdict: 'CORRECT', isCorrect: true, marksAwarded: 1 },
        maxMarks: 1,
        timeSpentSeconds: 30,
      },
      {
        groupKey: 'phy',
        groupLabel: 'Physics',
        evaluated: { verdict: 'INCORRECT', isCorrect: false, marksAwarded: -0.25 },
        maxMarks: 1,
        timeSpentSeconds: 50,
      },
      {
        groupKey: 'chem',
        groupLabel: 'Chemistry',
        evaluated: { verdict: 'UNANSWERED', isCorrect: null, marksAwarded: 0 },
        maxMarks: 1,
        timeSpentSeconds: 10,
      },
    ]);

    const physics = rows.find((r) => r.key === 'phy')!;
    expect(physics.total).toBe(2);
    expect(physics.correct).toBe(1);
    expect(physics.accuracy).toBe(50);
    expect(physics.score).toBe(0.75);
    expect(physics.avgTimeSeconds).toBe(40);

    const chemistry = rows.find((r) => r.key === 'chem')!;
    expect(chemistry.unanswered).toBe(1);
    // No attempted questions must not produce NaN.
    expect(chemistry.accuracy).toBe(0);
  });
});

/**
 * A KEA FDA / SDA paper end to end: 100 questions keyed at the FDA scheme,
 * scored exactly as the published rules say — +1, −0.25, 0 — out of 100.
 */
describe('KEA FDA / SDA paper', () => {
  const fda = markingSchemeFor('kea-fda-sda');
  const key = (i: number): QuestionKey => ({
    questionId: `q${i}`,
    type: 'SINGLE_CORRECT',
    marks: fda.marks,
    negativeMarks: fda.negativeMarks,
    correctOptionIds: [`q${i}-a`],
  });

  function sit(correct: number, wrong: number) {
    return totalAttempt(
      Array.from({ length: 100 }, (_, i) => {
        const answer =
          i < correct
            ? { selectedOptionIds: [`q${i}-a`] }
            : i < correct + wrong
              ? { selectedOptionIds: [`q${i}-b`] }
              : undefined;
        return { evaluated: evaluateAnswer(key(i), answer), maxMarks: fda.marks };
      }),
    );
  }

  it('awards +1 for a correct answer, −0.25 for a wrong one, 0 for a blank', () => {
    expect(evaluateAnswer(key(1), { selectedOptionIds: ['q1-a'] }).marksAwarded).toBe(1);
    expect(evaluateAnswer(key(1), { selectedOptionIds: ['q1-b'] }).marksAwarded).toBe(-0.25);
    expect(evaluateAnswer(key(1), undefined).marksAwarded).toBe(0);
    expect(evaluateAnswer(key(1), { selectedOptionIds: [] }).marksAwarded).toBe(0);
  });

  it('puts the paper out of 100', () => {
    expect(sit(100, 0)).toMatchObject({ score: 100, maxScore: 100, percentage: 100 });
  });

  it('scores 60 right, 20 wrong, 20 blank as 55', () => {
    const totals = sit(60, 20);
    expect(totals).toMatchObject({
      score: 55,
      maxScore: 100,
      correctCount: 60,
      incorrectCount: 20,
      unansweredCount: 20,
      attemptedCount: 80,
      accuracy: 75,
    });
  });

  it('keeps quarter marks exact across a whole paper', () => {
    // 73 − 27 × 0.25 = 66.25, with no floating-point drift.
    expect(sit(73, 27).score).toBe(66.25);
    expect(sit(1, 3).score).toBe(0.25);
  });

  it('never reports a score below zero', () => {
    expect(sit(0, 100).score).toBe(0);
  });
});
