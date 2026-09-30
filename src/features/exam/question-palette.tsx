'use client';

import * as React from 'react';

import type { AnswerState } from '@/lib/enums';
import { cn } from '@/lib/utils';

/**
 * Question palette.
 *
 * The visual language (green answered, red seen-but-unanswered, purple marked
 * for review) is the one students already know from real online exams. It is
 * deliberately fixed rather than themed — this is the single most
 * safety-critical piece of UI in the product, and familiarity beats brand
 * consistency here.
 *
 * State is never conveyed by colour alone: each button carries an accessible
 * label naming its state, and the legend spells out every mapping.
 */

export interface PaletteEntry {
  testQuestionId: string;
  sortOrder: number;
  state: AnswerState;
}

const STATE_STYLES: Record<AnswerState, string> = {
  ANSWERED: 'bg-exam-answered text-white border-transparent',
  NOT_ANSWERED: 'bg-exam-unanswered text-white border-transparent',
  NOT_VISITED: 'bg-background text-muted-foreground border-border',
  MARKED_FOR_REVIEW: 'bg-exam-review text-white border-transparent',
  ANSWERED_MARKED: 'bg-exam-review text-white border-transparent',
};

const STATE_LABELS: Record<AnswerState, string> = {
  ANSWERED: 'answered',
  NOT_ANSWERED: 'not answered',
  NOT_VISITED: 'not visited',
  MARKED_FOR_REVIEW: 'marked for review',
  ANSWERED_MARKED: 'answered and marked for review',
};

const LEGEND: { state: AnswerState; label: string }[] = [
  { state: 'ANSWERED', label: 'Answered' },
  { state: 'NOT_ANSWERED', label: 'Not answered' },
  { state: 'NOT_VISITED', label: 'Not visited' },
  { state: 'MARKED_FOR_REVIEW', label: 'Marked for review' },
  { state: 'ANSWERED_MARKED', label: 'Answered & marked' },
];

export interface QuestionPaletteProps {
  entries: PaletteEntry[];
  currentIndex: number;
  onJump: (index: number) => void;
  className?: string;
  /** The paper's language: a Kannada paper labels its palette in Kannada. */
  labels?: { questions: string; legend: string; states: Record<AnswerState, string> };
}

export function QuestionPalette({
  entries,
  currentIndex,
  onJump,
  className,
  labels,
}: QuestionPaletteProps) {
  const legend = labels
    ? LEGEND.map(({ state }) => ({ state, label: labels.states[state] }))
    : LEGEND;
  const counts = React.useMemo(() => {
    const tally: Record<AnswerState, number> = {
      ANSWERED: 0,
      NOT_ANSWERED: 0,
      NOT_VISITED: 0,
      MARKED_FOR_REVIEW: 0,
      ANSWERED_MARKED: 0,
    };
    for (const entry of entries) tally[entry.state] += 1;
    return tally;
  }, [entries]);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="scrollbar-slim flex-1 overflow-y-auto p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {labels?.questions ?? 'Questions'}
        </p>

        <div className="mt-3 grid grid-cols-5 gap-2" role="group" aria-label="Question navigation">
          {entries.map((entry, index) => {
            const isCurrent = index === currentIndex;
            return (
              <button
                key={entry.testQuestionId}
                type="button"
                onClick={() => onJump(index)}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Question ${entry.sortOrder}, ${STATE_LABELS[entry.state]}`}
                className={cn(
                  'relative flex size-10 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  STATE_STYLES[entry.state],
                  isCurrent && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              >
                {entry.sortOrder}
                {/* Distinguishes "answered & marked" from plain "marked" without
                    relying on a second colour. */}
                {entry.state === 'ANSWERED_MARKED' && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-exam-answered"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {labels?.legend ?? 'Legend'}
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {legend.map(({ state, label }) => (
            <li key={state} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className={cn('size-3.5 shrink-0 rounded border', STATE_STYLES[state])}
              />
              <span className="text-muted-foreground">{label}</span>
              <span className="ml-auto font-semibold tabular-nums">{counts[state]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
