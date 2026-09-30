'use client';

import * as React from 'react';

import { api } from '@/lib/api-client';

/**
 * Taking a test in Kannada.
 *
 * The questions come from the translation engine; everything the test screen
 * itself says - buttons, the palette, the submit dialog - is written here by
 * hand, so the chrome is right even before a single question is translated.
 */

export type ExamLanguage = 'en' | 'kn';

const STORAGE_KEY = 'avk.exam.language';

/** The student's last choice, remembered across tests on this device. */
export function storedLanguage(): ExamLanguage | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'kn' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(language: ExamLanguage) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private browsing or blocked storage: the choice just is not remembered.
  }
}

export const EXAM_TEXT = {
  en: {
    answeredOf: (answered: number, total: number) => `${answered} of ${total} answered`,
    marks: 'marks',
    saving: 'Saving',
    saved: 'Saved',
    reconnecting: 'Reconnecting',
    submit: 'Submit',
    submitTest: 'Submit test',
    question: 'Question',
    selectAll: 'Select all that apply',
    yourAnswer: 'Your answer',
    enterNumber: 'Enter a number',
    previous: 'Previous',
    clear: 'Clear',
    mark: 'Mark for review',
    unmark: 'Unmark',
    saveNext: 'Save & next',
    next: 'Next',
    questions: 'Questions',
    openPalette: 'Open question palette',
    close: 'Close',
    confirmTitle: 'Submit your test?',
    confirmBody: 'You cannot change your answers after submitting.',
    answered: 'Answered',
    unanswered: 'Unanswered',
    marked: 'Marked',
    unansweredWarning: (n: number) =>
      `You have ${n} unanswered ${n === 1 ? 'question' : 'questions'}. Unanswered questions score zero, with no penalty.`,
    keepWorking: 'Keep working',
    submitting: 'Submitting…',
    submitted: 'Test submitted.',
    timeUpSubmitted: 'Time is up — your test was submitted.',
    submitFailed: 'We could not submit your test. Please try again.',
    timeUp: 'Time is up. Submitting your test.',
    timeRemaining: 'Time remaining',
    legend: {
      ANSWERED: 'Answered',
      NOT_ANSWERED: 'Not answered',
      NOT_VISITED: 'Not visited',
      MARKED_FOR_REVIEW: 'Marked for review',
      ANSWERED_MARKED: 'Answered & marked',
    },
    // Language notices are always shown in both scripts: whoever reads them
    // is between the two.
    translating: 'Translating to Kannada… · ಕನ್ನಡಕ್ಕೆ ಅನುವಾದಿಸಲಾಗುತ್ತಿದೆ…',
    unavailable: 'Kannada translation is unavailable right now — showing English. · ಕನ್ನಡ ಅನುವಾದ ಸದ್ಯಕ್ಕೆ ಲಭ್ಯವಿಲ್ಲ.',
    machineNote: '',
  },
  kn: {
    answeredOf: (answered: number, total: number) => `${total} ರಲ್ಲಿ ${answered} ಉತ್ತರಿಸಲಾಗಿದೆ`,
    marks: 'ಅಂಕಗಳು',
    saving: 'ಉಳಿಸಲಾಗುತ್ತಿದೆ',
    saved: 'ಉಳಿಸಲಾಗಿದೆ',
    reconnecting: 'ಮರುಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ',
    submit: 'ಸಲ್ಲಿಸಿ',
    submitTest: 'ಪರೀಕ್ಷೆ ಸಲ್ಲಿಸಿ',
    question: 'ಪ್ರಶ್ನೆ',
    selectAll: 'ಅನ್ವಯವಾಗುವ ಎಲ್ಲವನ್ನೂ ಆಯ್ಕೆಮಾಡಿ',
    yourAnswer: 'ನಿಮ್ಮ ಉತ್ತರ',
    enterNumber: 'ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ',
    previous: 'ಹಿಂದಿನದು',
    clear: 'ಅಳಿಸಿ',
    mark: 'ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಿ',
    unmark: 'ಗುರುತು ತೆಗೆಯಿರಿ',
    saveNext: 'ಉಳಿಸಿ ಮತ್ತು ಮುಂದೆ',
    next: 'ಮುಂದೆ',
    questions: 'ಪ್ರಶ್ನೆಗಳು',
    openPalette: 'ಪ್ರಶ್ನೆಗಳ ಪಟ್ಟಿ ತೆರೆಯಿರಿ',
    close: 'ಮುಚ್ಚಿ',
    confirmTitle: 'ನಿಮ್ಮ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸುವುದೇ?',
    confirmBody: 'ಸಲ್ಲಿಸಿದ ನಂತರ ನಿಮ್ಮ ಉತ್ತರಗಳನ್ನು ಬದಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.',
    answered: 'ಉತ್ತರಿಸಿದವು',
    unanswered: 'ಉತ್ತರಿಸದವು',
    marked: 'ಗುರುತಿಸಿದವು',
    unansweredWarning: (n: number) =>
      `ನೀವು ${n} ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿಲ್ಲ. ಉತ್ತರಿಸದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಶೂನ್ಯ ಅಂಕ; ಯಾವುದೇ ಋಣಾತ್ಮಕ ಅಂಕವಿಲ್ಲ.`,
    keepWorking: 'ಮುಂದುವರಿಸಿ',
    submitting: 'ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ…',
    submitted: 'ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಲಾಗಿದೆ.',
    timeUpSubmitted: 'ಸಮಯ ಮುಗಿದಿದೆ — ನಿಮ್ಮ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಲಾಗಿದೆ.',
    submitFailed: 'ನಿಮ್ಮ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    timeUp: 'ಸಮಯ ಮುಗಿದಿದೆ. ನಿಮ್ಮ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ.',
    timeRemaining: 'ಉಳಿದಿರುವ ಸಮಯ',
    legend: {
      ANSWERED: 'ಉತ್ತರಿಸಲಾಗಿದೆ',
      NOT_ANSWERED: 'ಉತ್ತರಿಸಿಲ್ಲ',
      NOT_VISITED: 'ನೋಡಿಲ್ಲ',
      MARKED_FOR_REVIEW: 'ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಲಾಗಿದೆ',
      ANSWERED_MARKED: 'ಉತ್ತರಿಸಿ ಗುರುತಿಸಲಾಗಿದೆ',
    },
    translating: 'ಕನ್ನಡಕ್ಕೆ ಅನುವಾದಿಸಲಾಗುತ್ತಿದೆ… · Translating to Kannada…',
    unavailable: 'ಕನ್ನಡ ಅನುವಾದ ಸದ್ಯಕ್ಕೆ ಲಭ್ಯವಿಲ್ಲ — ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ. · Kannada is unavailable right now.',
    machineNote:
      'ಪ್ರಶ್ನೆಗಳನ್ನು ಯಂತ್ರದ ಮೂಲಕ ಅನುವಾದಿಸಲಾಗಿದೆ. ಯಾವುದಾದರೂ ಸ್ಪಷ್ಟವಾಗದಿದ್ದರೆ ಮೇಲಿನ "EN" ಒತ್ತಿ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ನೋಡಿ.',
  },
} as const;

export type ExamText = (typeof EXAM_TEXT)[ExamLanguage];

/** The pre-test briefing, in both languages. */
export const START_TEXT = {
  en: {
    myTests: 'My tests',
    duration: 'Duration',
    questions: 'Questions',
    totalMarks: 'Total marks',
    attemptsLeft: 'Attempts left',
    unlimited: 'Unlimited',
    beforeYouBegin: 'Before you begin',
    defaultMarks: 'Each question carries the marks shown alongside it.',
    defaultPenalty: 'Incorrect answers carry a penalty. Unanswered questions score zero.',
    defaultNavigation: 'You may move between questions freely and mark any for review.',
    timerNote:
      'The timer runs on our servers. Closing the tab does not pause it, and the test submits automatically when time expires.',
    saveNote:
      'Your answers save continuously. If your connection drops, reopen the test and you will resume exactly where you left off.',
    exhausted: (n: number) =>
      `You have used all ${n} attempts for this test. Your previous results remain available in My tests.`,
    start: 'Start test',
    preparing: 'Preparing your paper…',
    noPause: 'Once you begin, the timer cannot be paused.',
    resuming: 'Resuming your attempt in progress.',
    startFailed: 'We could not start this test.',
  },
  kn: {
    myTests: 'ನನ್ನ ಪರೀಕ್ಷೆಗಳು',
    duration: 'ಅವಧಿ',
    questions: 'ಪ್ರಶ್ನೆಗಳು',
    totalMarks: 'ಒಟ್ಟು ಅಂಕಗಳು',
    attemptsLeft: 'ಉಳಿದ ಪ್ರಯತ್ನಗಳು',
    unlimited: 'ಅನಿಯಮಿತ',
    beforeYouBegin: 'ಪ್ರಾರಂಭಿಸುವ ಮೊದಲು',
    defaultMarks: 'ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಅದರ ಪಕ್ಕದಲ್ಲಿ ತೋರಿಸಿರುವಷ್ಟು ಅಂಕಗಳಿವೆ.',
    defaultPenalty: 'ತಪ್ಪು ಉತ್ತರಗಳಿಗೆ ಋಣಾತ್ಮಕ ಅಂಕವಿದೆ. ಉತ್ತರಿಸದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಶೂನ್ಯ ಅಂಕ.',
    defaultNavigation: 'ನೀವು ಪ್ರಶ್ನೆಗಳ ನಡುವೆ ಮುಕ್ತವಾಗಿ ಹೋಗಬಹುದು ಮತ್ತು ಯಾವುದನ್ನಾದರೂ ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಬಹುದು.',
    timerNote:
      'ಸಮಯವನ್ನು ನಮ್ಮ ಸರ್ವರ್‌ನಲ್ಲಿ ಎಣಿಸಲಾಗುತ್ತದೆ. ಟ್ಯಾಬ್ ಮುಚ್ಚಿದರೂ ಅದು ನಿಲ್ಲುವುದಿಲ್ಲ; ಸಮಯ ಮುಗಿದಾಗ ಪರೀಕ್ಷೆ ತಾನಾಗಿಯೇ ಸಲ್ಲಿಕೆಯಾಗುತ್ತದೆ.',
    saveNote:
      'ನಿಮ್ಮ ಉತ್ತರಗಳು ನಿರಂತರವಾಗಿ ಉಳಿಯುತ್ತವೆ. ಸಂಪರ್ಕ ಕಡಿತಗೊಂಡರೆ ಪರೀಕ್ಷೆಯನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ — ನೀವು ನಿಲ್ಲಿಸಿದಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಯುತ್ತದೆ.',
    exhausted: (n: number) =>
      `ಈ ಪರೀಕ್ಷೆಯ ಎಲ್ಲಾ ${n} ಪ್ರಯತ್ನಗಳನ್ನು ನೀವು ಬಳಸಿದ್ದೀರಿ. ನಿಮ್ಮ ಹಿಂದಿನ ಫಲಿತಾಂಶಗಳು "ನನ್ನ ಪರೀಕ್ಷೆಗಳು" ವಿಭಾಗದಲ್ಲಿ ಲಭ್ಯವಿವೆ.`,
    start: 'ಕನ್ನಡದಲ್ಲಿ ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭಿಸಿ',
    preparing: 'ನಿಮ್ಮ ಪ್ರಶ್ನೆಪತ್ರಿಕೆ ಸಿದ್ಧವಾಗುತ್ತಿದೆ…',
    noPause: 'ಒಮ್ಮೆ ಪ್ರಾರಂಭಿಸಿದರೆ, ಸಮಯವನ್ನು ನಿಲ್ಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.',
    resuming: 'ನಿಮ್ಮ ಅಪೂರ್ಣ ಪ್ರಯತ್ನವನ್ನು ಮುಂದುವರಿಸಲಾಗುತ್ತಿದೆ.',
    startFailed: 'ಈ ಪರೀಕ್ಷೆಯನ್ನು ಪ್ರಾರಂಭಿಸಲಾಗಲಿಲ್ಲ.',
  },
} as const;

/** Shown in both scripts on the English screen, so a Kannada reader finds it. */
export const TAKE_IN_KANNADA = { kn: 'ಕನ್ನಡದಲ್ಲಿ ಪರೀಕ್ಷೆ ಬರೆಯಿರಿ', en: 'Take Test in Kannada' } as const;

export function kannadaProgress(ready: number, total: number): string {
  return ready >= total
    ? `ಎಲ್ಲಾ ${total} ಪ್ರಶ್ನೆಗಳು ಕನ್ನಡದಲ್ಲಿ ಸಿದ್ಧವಾಗಿವೆ.`
    : `ಕನ್ನಡ ಪ್ರಶ್ನೆಗಳು ಸಿದ್ಧ: ${total} ರಲ್ಲಿ ${ready}. ಉಳಿದವು ನೀವು ಪರೀಕ್ಷೆ ಬರೆಯುತ್ತಿರುವಾಗಲೇ ಅನುವಾದಗೊಳ್ಳುತ್ತವೆ.`;
}

export interface StartTranslation {
  engineAvailable: boolean;
  test: { title: string; description: string | null; instructions: string | null } | null;
  questionsReady: number;
  questionsTotal: number;
}

/**
 * The start screen's Kannada: the test's own text, and how much of the paper
 * is ready. Asking for it is also what starts the paper translating.
 */
export function useStartTranslation(testId: string, language: ExamLanguage) {
  const [data, setData] = React.useState<StartTranslation | null>(null);

  React.useEffect(() => {
    if (language !== 'kn') return;
    let cancelled = false;
    let timer: number | undefined;
    const started = Date.now();

    const load = async () => {
      try {
        const next = await api.get<StartTranslation>(`/api/tests/${testId}/translation?lang=kn`);
        if (cancelled) return;
        setData(next);
        const done = next.test !== null && next.questionsReady >= next.questionsTotal;
        if (!done && next.engineAvailable && Date.now() - started < GIVE_UP_MS) {
          timer = window.setTimeout(load, POLL_MS);
        }
      } catch {
        if (!cancelled && Date.now() - started < GIVE_UP_MS) timer = window.setTimeout(load, POLL_MS * 2);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [testId, language]);

  return data;
}

// ---------------------------------------------------------------------------
// Fetching an attempt's Kannada
// ---------------------------------------------------------------------------

export interface StemTranslation {
  body: string;
  passage: string | null;
  options: Record<string, string>;
}

export interface SolutionTranslation {
  explanation: string | null;
  detailedSolution: string | null;
}

export interface AttemptTranslation {
  engineAvailable: boolean;
  test: { title: string; description: string | null; instructions: string | null } | null;
  stems: Record<string, StemTranslation>;
  solutions: Record<string, SolutionTranslation>;
  pending: { stems: number; solutions: number };
  total: number;
}

/** How often to ask for more while translation is still running. */
const POLL_MS = 3_000;
/**
 * How long to keep asking with nothing new arriving. Past this the paper
 * stays in English for whatever is left, rather than polling forever.
 */
const GIVE_UP_MS = 4 * 60_000;

/**
 * The Kannada for an attempt, filling in as the engine translates it.
 *
 * Does nothing while the language is English. Polls only while something is
 * pending, and passes the question on screen so the engine does that first.
 */
export function useAttemptTranslation(attemptId: string, language: ExamLanguage, focusQuestionId?: string) {
  const [data, setData] = React.useState<AttemptTranslation | null>(null);
  const focusRef = React.useRef(focusQuestionId);
  focusRef.current = focusQuestionId;

  React.useEffect(() => {
    if (language !== 'kn') return;
    let cancelled = false;
    let timer: number | undefined;
    let lastProgress = Date.now();
    let lastReady = -1;

    const load = async () => {
      try {
        const focus = focusRef.current ? `&focus=${encodeURIComponent(focusRef.current)}` : '';
        const next = await api.get<AttemptTranslation>(`/api/attempts/${attemptId}/translation?lang=kn${focus}`);
        if (cancelled) return;
        setData(next);

        const ready = Object.keys(next.stems).length + Object.keys(next.solutions).length;
        if (ready !== lastReady) {
          lastReady = ready;
          lastProgress = Date.now();
        }
        const pending = next.pending.stems + next.pending.solutions > 0 || !next.test;
        if (!pending) return;
        if (Date.now() - lastProgress < GIVE_UP_MS) {
          timer = window.setTimeout(load, POLL_MS);
        } else {
          // Stalled: stop asking, and say so rather than spinning forever.
          setData({ ...next, engineAvailable: false });
        }
      } catch {
        if (!cancelled && Date.now() - lastProgress < GIVE_UP_MS) timer = window.setTimeout(load, POLL_MS * 2);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attemptId, language]);

  return data;
}
