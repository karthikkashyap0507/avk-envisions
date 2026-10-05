import { describe, expect, it } from 'vitest';

import { coachAnswer, type CoachRecord } from './coach-engine';

/**
 * The built-in coach. What matters: it answers what was asked, every figure
 * it states is one from the record, and with no record it says so.
 */

const EMPTY: CoachRecord = {
  questionsAnswered: 0,
  correct: 0,
  accuracy: 0,
  avgTimeSeconds: 0,
  testsCompleted: 0,
  practiceSessions: 0,
  subjects: [],
  weakTopics: [],
  strongTopics: [],
  recentScores: [],
  minAnswers: 8,
};

const BUSY: CoachRecord = {
  questionsAnswered: 412,
  correct: 251,
  accuracy: 60.9,
  avgTimeSeconds: 104,
  testsCompleted: 6,
  practiceSessions: 9,
  subjects: [
    { name: 'Indian Polity', total: 120, accuracy: 71.7, isReliable: true },
    { name: 'History', total: 96, accuracy: 44.8, isReliable: true },
    { name: 'Indian Economy', total: 60, accuracy: 52.5, isReliable: true },
    { name: 'Environment', total: 4, accuracy: 25, isReliable: false },
  ],
  weakTopics: [{ name: 'Vijayanagara Empire', total: 14, accuracy: 35.7 }],
  strongTopics: [{ name: 'Fundamental Rights', total: 22, accuracy: 86.4 }],
  recentScores: [
    { title: 'T1', percentage: 40 },
    { title: 'T2', percentage: 44 },
    { title: 'T3', percentage: 55 },
    { title: 'T4', percentage: 59 },
  ],
  minAnswers: 8,
};

/** Every number in an answer, so tests can check none was made up. */
function numbers(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !['1', '2', '3', '10', '11', '12', '18', '20', '30', '45', '70', '72', '73', '74'].includes(n));
}

describe('coachAnswer', () => {
  it('builds this week from the weakest subjects and topic, with their real figures', () => {
    const answer = coachAnswer('What should I focus on this week?', BUSY);
    expect(answer).toContain('History - you are at 44.8%');
    expect(answer).toContain('Indian Economy (52.5%)');
    expect(answer).toContain('Vijayanagara Empire, your weakest topic at 35.7%');
    expect(answer).toContain('rising');
  });

  it('gives a general week, and says why, when there is too little data', () => {
    const answer = coachAnswer('Make me a plan for this week', EMPTY);
    expect(answer).toContain("haven't answered any questions yet");
    expect(answer).toContain('Polity');
  });

  it('answers on speed from the student\'s own pace', () => {
    expect(coachAnswer('How do I answer faster?', BUSY)).toContain('about 104 seconds a question');
    expect(coachAnswer('I run out of time', EMPTY)).toContain('72 seconds');
  });

  it('answers on accuracy with the weakest subject', () => {
    const answer = coachAnswer('How can I improve my accuracy?', BUSY);
    expect(answer).toContain('60.9%');
    expect(answer).toContain('History, at 44.8%');
  });

  it('answers about a subject, with the student\'s figure for it', () => {
    const polity = coachAnswer('How should I prepare polity?', BUSY);
    expect(polity).toContain('Laxmikanth');
    expect(polity).toContain('Indian Polity you are at 71.7%');
    // Too few answers in environment to give a figure as a verdict.
    expect(coachAnswer('Tips for environment and ecology', BUSY)).toContain('only 4 questions in Environment');
  });

  it('answers about a topic the record knows', () => {
    const answer = coachAnswer('How do I improve at Vijayanagara Empire?', BUSY);
    expect(answer).toContain('Vijayanagara Empire: you are at 35.7% over 14 questions');
    expect(answer).toContain('Wrong questions');
  });

  it('never states a figure that is not in the record', () => {
    const allowed = new Set(['412', '60.9', '104', '6', '9', '71.7', '120', '44.8', '96', '52.5', '60', '4', '25', '35.7', '14', '86.4', '22', '57', '42', '40', '8', '15', '90']);
    for (const question of [
      'What should I focus on this week?',
      'How am I doing?',
      'How can I improve my accuracy?',
      'How do I answer faster?',
      'How many mock tests should I take?',
      'How should I prepare history?',
    ]) {
      for (const n of numbers(coachAnswer(question, BUSY))) {
        expect(allowed.has(n), `${question} -> ${n}`).toBe(true);
      }
    }
  });

  it('shows progress with strong and weak areas', () => {
    const answer = coachAnswer('How am I doing?', BUSY);
    expect(answer).toContain('412 questions with 60.9% accuracy, across 6 tests and 9 quizzes');
    expect(answer).toContain('Fundamental Rights (86.4%)');
  });

  it('answers greetings, thanks and Kannada', () => {
    expect(coachAnswer('hi', EMPTY)).toContain("I'm your AVK AI Coach");
    expect(coachAnswer('thank you', BUSY)).toContain("You're welcome");
    expect(coachAnswer('Can I take tests in Kannada?', BUSY)).toContain('ಕನ್ನಡ');
    expect(coachAnswer('ನಾನು ಹೇಗೆ ತಯಾರಿ ಮಾಡಲಿ?', BUSY)).toContain('only answer in English');
  });

  it('meets distress with care, not a study plan', () => {
    const answer = coachAnswer('I feel so stressed and want to give up', BUSY);
    expect(answer).toContain('someone you trust');
    expect(answer).not.toContain('History');
  });

  it('falls back to where the student stands and what to ask', () => {
    const answer = coachAnswer('What is the capital of Mars?', BUSY);
    expect(answer).toContain("I don't have a ready answer");
    expect(answer).toContain('What should I focus on this week?');
  });
});
