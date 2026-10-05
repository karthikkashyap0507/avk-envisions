'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Flag,
  SkipForward,
  Lightbulb,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ApiClientError, api } from '@/lib/api-client';
import { MULTI_SELECT_TYPES } from '@/lib/enums';
import { cn } from '@/lib/utils';

/**
 * Practice runner.
 *
 * The inverse of the exam engine: no clock, no penalty, and the answer is
 * revealed the instant the student commits. Once revealed, the selection is
 * locked — letting them change it afterwards would turn practice into a
 * clicking exercise and corrupt their own accuracy record.
 */
export interface PracticeQuestion {
  questionId: string;
  index: number;
  type: string;
  difficulty: string;
  body: string;
  passage: string | null;
  imageUrl: string | null;
  explanation: string | null;
  detailedSolution: string | null;
  numericalAnswer: number | null;
  options: { id: string; label: string; body: string; isCorrect: boolean }[];
  subject: string | null;
  chapter: string | null;
  topic: { id: string; name: string } | null;
  isBookmarked: boolean;
  answer: { selectedOptionIds: string[]; numericalValue: number | null; isCorrect: boolean | null } | null;
}

export interface PracticeRunnerProps {
  sessionId: string;
  scope: string;
  source: string;
  questions: PracticeQuestion[];
  initialCorrect: number;
  initialAttempted: number;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export function PracticeRunner({
  sessionId,
  scope,
  source,
  questions,
  initialCorrect,
  initialAttempted,
}: PracticeRunnerProps) {
  const router = useRouter();

  // Resume at the first unanswered question rather than always at the start.
  const firstUnanswered = questions.findIndex((q) => q.answer === null);
  const [index, setIndex] = React.useState(firstUnanswered === -1 ? 0 : firstUnanswered);

  const [answers, setAnswers] = React.useState<
    Record<string, { selectedOptionIds: string[]; numericalValue: number | null; isCorrect: boolean | null }>
  >(() => {
    const seeded: Record<string, { selectedOptionIds: string[]; numericalValue: number | null; isCorrect: boolean | null }> = {};
    for (const question of questions) {
      if (question.answer) seeded[question.questionId] = question.answer;
    }
    return seeded;
  });

  const [draft, setDraft] = React.useState<string[]>([]);
  const [numericDraft, setNumericDraft] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(
    () => new Set(questions.filter((q) => q.isBookmarked).map((q) => q.questionId)),
  );
  const [correct, setCorrect] = React.useState(initialCorrect);
  const [attempted, setAttempted] = React.useState(initialAttempted);

  const enteredAt = React.useRef(Date.now());
  const current = questions[index];

  // Reset the draft whenever the question changes.
  React.useEffect(() => {
    setDraft([]);
    setNumericDraft('');
    enteredAt.current = Date.now();
  }, [index]);

  if (!current) return null;

  const revealed = answers[current.questionId] ?? null;
  const isMulti = MULTI_SELECT_TYPES.includes(current.type as never);
  const isNumeric = current.type === 'NUMERICAL';

  const canSubmit = isNumeric ? numericDraft.trim() !== '' : draft.length > 0;

  function toggleOption(optionId: string) {
    if (revealed) return;
    setDraft((previous) =>
      isMulti
        ? previous.includes(optionId)
          ? previous.filter((id) => id !== optionId)
          : [...previous, optionId]
        : [optionId],
    );
  }

  async function submitAnswer() {
    if (!canSubmit || submitting || revealed) return;
    setSubmitting(true);

    const numericalValue = isNumeric ? Number(numericDraft) : null;
    if (isNumeric && !Number.isFinite(numericalValue)) {
      toast.error('Enter a valid number.');
      setSubmitting(false);
      return;
    }

    try {
      const result = await api.post<{ isCorrect: boolean; alreadyAnswered: boolean }>(
        `/api/practice/${sessionId}/answer`,
        {
          questionId: current!.questionId,
          selectedOptionIds: isNumeric ? [] : draft,
          numericalValue,
          timeSpentSeconds: Math.min(3600, Math.round((Date.now() - enteredAt.current) / 1000)),
        },
      );

      setAnswers((previous) => ({
        ...previous,
        [current!.questionId]: {
          selectedOptionIds: isNumeric ? [] : draft,
          numericalValue,
          isCorrect: result.isCorrect,
        },
      }));

      if (!result.alreadyAnswered) {
        setAttempted((n) => n + 1);
        if (result.isCorrect) setCorrect((n) => n + 1);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : 'We could not save that answer.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleBookmark() {
    const questionId = current!.questionId;
    const next = !bookmarks.has(questionId);

    setBookmarks((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(questionId);
      else updated.delete(questionId);
      return updated;
    });

    try {
      if (next) await api.post('/api/bookmarks', { questionId });
      else await api.delete('/api/bookmarks', { questionId });
    } catch {
      // Revert on failure so the star never lies about what is stored.
      setBookmarks((previous) => {
        const updated = new Set(previous);
        if (next) updated.delete(questionId);
        else updated.add(questionId);
        return updated;
      });
      toast.error('We could not update that bookmark.');
    }
  }

  async function finish() {
    setSubmitting(true);
    try {
      await api.post(`/api/practice/${sessionId}/complete`);
      router.replace(`/practice/${sessionId}/summary`);
      router.refresh();
    } catch {
      setSubmitting(false);
      toast.error('We could not close this session.');
    }
  }

  const isLast = index === questions.length - 1;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Progress header ------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Quiz</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {scope} · {source.toLowerCase()} questions
            </p>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{index + 1}</span> /{' '}
              {questions.length}
            </span>
            {attempted > 0 && (
              <Badge variant={accuracy >= 70 ? 'success' : accuracy >= 40 ? 'warning' : 'danger'}>
                {accuracy}% accuracy
              </Badge>
            )}
          </div>
        </div>

        <Progress value={((index + 1) / questions.length) * 100} className="mt-3" size="sm" />
      </div>

      {/* Question --------------------------------------------------------- */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" size="sm">
              {DIFFICULTY_LABELS[current.difficulty] ?? current.difficulty}
            </Badge>
            {current.subject && (
              <span className="text-xs text-muted-foreground">{current.subject}</span>
            )}
            {current.topic && (
              <span className="text-xs text-muted-foreground">· {current.topic.name}</span>
            )}
            {isMulti && (
              <Badge variant="warning" size="sm">
                Select all that apply
              </Badge>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={toggleBookmark}
              aria-pressed={bookmarks.has(current.questionId)}
              aria-label={
                bookmarks.has(current.questionId) ? 'Remove bookmark' : 'Bookmark this question'
              }
            >
              {bookmarks.has(current.questionId) ? (
                <BookmarkCheck className="text-primary" aria-hidden="true" />
              ) : (
                <Bookmark aria-hidden="true" />
              )}
            </Button>
          </div>

          {current.passage && (
            <div className="mt-4 rounded-lg bg-muted/40 p-3">
              <p className="whitespace-pre-line text-sm leading-relaxed">{current.passage}</p>
            </div>
          )}

          <p className="mt-4 whitespace-pre-line text-question leading-relaxed">{current.body}</p>

          {current.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.imageUrl}
              alt=""
              className="mt-4 max-w-full rounded-lg border border-border"
            />
          )}

          {/* Answer input --------------------------------------------- */}
          <div className="mt-6">
            {isNumeric ? (
              <div className="max-w-xs">
                <label htmlFor="practice-numeric" className="text-sm font-medium">
                  Your answer
                </label>
                <Input
                  id="practice-numeric"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="mt-1.5"
                  placeholder="Enter a number"
                  value={revealed ? (revealed.numericalValue ?? '') : numericDraft}
                  onChange={(event) => setNumericDraft(event.target.value)}
                  disabled={Boolean(revealed)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitAnswer();
                  }}
                />
                {revealed && (
                  <p className="mt-2 text-sm">
                    Correct answer:{' '}
                    <span className="font-semibold text-success tabular-nums">
                      {current.numericalAnswer}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <fieldset disabled={Boolean(revealed)}>
                <legend className="sr-only">
                  {isMulti ? 'Select all correct options' : 'Select one option'}
                </legend>

                <div className="space-y-3">
                  {current.options.map((option) => {
                    const chosen = revealed
                      ? revealed.selectedOptionIds.includes(option.id)
                      : draft.includes(option.id);

                    // Colour only after reveal; before that, selection is neutral.
                    const tone = !revealed
                      ? chosen
                        ? 'border-primary bg-primary-muted'
                        : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50'
                      : option.isCorrect
                        ? 'border-success/50 bg-success/5'
                        : chosen
                          ? 'border-destructive/50 bg-destructive/5'
                          : 'border-border opacity-70';

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggleOption(option.id)}
                        aria-pressed={chosen}
                        className={cn(
                          'flex w-full items-start gap-3.5 rounded-xl border p-4 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          !revealed && 'cursor-pointer',
                          tone,
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center border text-sm font-semibold',
                            isMulti ? 'rounded-md' : 'rounded-full',
                            revealed && option.isCorrect
                              ? 'border-success bg-success text-white'
                              : revealed && chosen
                                ? 'border-destructive bg-destructive text-white'
                                : chosen
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border text-muted-foreground',
                          )}
                          aria-hidden="true"
                        >
                          {option.label}
                        </span>

                        <span className="flex-1 whitespace-pre-line pt-0.5 text-[0.975rem] leading-relaxed">
                          {option.body}
                        </span>

                        {revealed && option.isCorrect && (
                          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                        )}
                        {revealed && chosen && !option.isCorrect && (
                          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Controls --------------------------------------------------------- */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          <ArrowLeft aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        <div className="flex-1" />

        {/*
          Skip. Without it the only way past a question you cannot answer was
          to guess — which puts a wrong answer in the review list and teaches
          the wrong thing. Nothing is recorded: the question stays unanswered
          and can be returned to with Previous.
        */}
        {!revealed && !isLast && (
          <Button variant="ghost" onClick={() => setIndex((i) => i + 1)}>
            Skip
            <SkipForward aria-hidden="true" />
          </Button>
        )}

        {!revealed ? (
          <Button onClick={submitAnswer} disabled={!canSubmit} loading={submitting}>
            Check answer
          </Button>
        ) : isLast ? (
          <Button onClick={finish} loading={submitting} loadingText="Finishing…">
            <Flag aria-hidden="true" />
            Finish session
          </Button>
        ) : (
          <Button onClick={() => setIndex((i) => i + 1)}>
            Next question
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Verdict + solution ------------------------------------------------
          Below the controls, not above them. Reading the explanation is the
          part of practice that teaches, and when it sat between the options
          and the buttons the Next button was pushed off a phone screen — so
          moving on meant scrolling back past the whole solution, and the
          quickest way through was to skip reading it. Now the answer is
          checked, the buttons stay where the thumb already is, and the
          explanation reads downward from there. */}
      {revealed && (
        <div
          className={cn(
            'rounded-xl border p-4',
            revealed.isCorrect
              ? 'border-success/30 bg-success/5'
              : 'border-destructive/30 bg-destructive/5',
          )}
          role="status"
        >
          <p
            className={cn(
              'flex items-center gap-2 font-semibold',
              revealed.isCorrect ? 'text-success' : 'text-destructive',
            )}
          >
            {revealed.isCorrect ? (
              <CheckCircle2 className="size-5" aria-hidden="true" />
            ) : (
              <XCircle className="size-5" aria-hidden="true" />
            )}
            {revealed.isCorrect ? 'Correct' : 'Not quite'}
          </p>

          {(current.detailedSolution || current.explanation) && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Lightbulb className="size-3.5" aria-hidden="true" />
                Solution
              </p>
              {current.detailedSolution ? (
                <div
                  className="prose-avk mt-2"
                  dangerouslySetInnerHTML={{ __html: current.detailedSolution }}
                />
              ) : (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {current.explanation}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {attempted} of {questions.length} answered · {correct} correct
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/practice">Exit quiz</Link>
        </Button>
      </div>
    </div>
  );
}
