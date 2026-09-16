import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Clock,
  FileText,
  Gauge,
  Target,
  RotateCcw,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';

import { Logo } from '@/components/site/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress, ProgressRing } from '@/components/ui/progress';
import { MiniStat } from '@/components/ui/stat-card';
import { cn, formatDuration, ordinal, round } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getAttemptResult, submitAttempt } from '@/server/services/attempt-service';
import {
  getAttemptComparison,
  getMarksBreakdown,
  getRetakeAllowance,
} from '@/server/services/result-analytics';

export const metadata: Metadata = {
  title: 'Result',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await enforceStudent(`/test/${id}/result`);

  // An attempt whose timer ran out while the tab was closed is still
  // IN_PROGRESS. Finalise it here rather than showing an error — the student
  // did the work, and the server clock already decided the outcome.
  const pending = await db.testAttempt.findFirst({
    where: { id, userId: user.id, status: 'IN_PROGRESS' },
    select: { id: true, expiresAt: true },
  });

  if (pending) {
    if (pending.expiresAt.getTime() > Date.now()) {
      // Still live — the student landed here by mistake.
      notFound();
    }
    await submitAttempt({ attemptId: pending.id, userId: user.id, reason: 'EXPIRED' });
  }

  const result = await getAttemptResult(id, user.id).catch(() => null);
  if (!result) notFound();

  // The test's own analysis, or the series document it falls back to.
  const hasSynopsis = Boolean(
    result.test.synopsisFileName ?? result.test.testSeries?.synopsisFileName,
  );

  const { attempt, test, review, breakdowns } = result;

  const [marks, comparison, retake] = await Promise.all([
    getMarksBreakdown(attempt.id),
    getAttemptComparison(test.id, attempt.id),
    getRetakeAllowance(test.id, user.id),
  ]);

  const passed = attempt.percentage >= 40;
  const avgTimePerQuestion =
    review.length > 0 ? round(attempt.timeSpentSeconds / review.length, 0) : 0;

  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/my-tests">
                <ArrowLeft aria-hidden="true" />
                My tests
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="container space-y-6 py-8">
        {/* Headline ------------------------------------------------------ */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Result</p>
          <h1 className="mt-2 text-balance text-display-sm">{test.title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Submitted {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString('en-IN') : '—'}
          </p>
        </div>

        <Card variant="elevated">
          <CardContent className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center justify-center gap-3">
              <ProgressRing
                value={attempt.percentage}
                size={140}
                strokeWidth={11}
                tone={attempt.percentage >= 75 ? 'success' : passed ? 'primary' : 'danger'}
                label={
                  <div className="text-center">
                    <p className="text-2xl font-semibold tabular-nums">
                      {attempt.score}
                      <span className="text-base font-normal text-muted-foreground">
                        /{attempt.maxScore}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{attempt.percentage}%</p>
                  </div>
                }
              />
              <Badge variant={attempt.percentage >= 75 ? 'success' : passed ? 'info' : 'warning'}>
                {attempt.percentage >= 75
                  ? 'Strong performance'
                  : passed
                    ? 'Room to improve'
                    : 'Needs work'}
              </Badge>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Correct" value={attempt.correctCount} tone="success" />
                <MiniStat label="Incorrect" value={attempt.incorrectCount} tone="danger" />
                <MiniStat label="Unanswered" value={attempt.unansweredCount} tone="muted" />
                <MiniStat label="Accuracy" value={`${attempt.accuracy}%`} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat
                  label="Rank"
                  value={attempt.rank ? ordinal(attempt.rank) : '—'}
                />
                <MiniStat
                  label="Percentile"
                  value={attempt.percentile != null ? attempt.percentile : '—'}
                />
                <MiniStat label="Time taken" value={formatDuration(attempt.timeSpentSeconds)} />
                <MiniStat label="Avg / question" value={`${avgTimePerQuestion}s`} />
              </div>

              {/* Marks split. A single net figure hides what guessing cost. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Marks earned{' '}
                  <span className="font-semibold tabular-nums text-success">+{marks.earned}</span>
                </span>
                <span className="text-muted-foreground">
                  Negative marks{' '}
                  <span className="font-semibold tabular-nums text-destructive">{marks.lost}</span>
                </span>
                <span className="text-muted-foreground">
                  Net score{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {marks.net} / {marks.maxScore}
                  </span>
                </span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {retake.canRetake && (
                  <Button asChild size="sm">
                    <Link href={`/test/${test.id}`}>
                      <RotateCcw aria-hidden="true" />
                      Retake test
                      {retake.remaining !== null && ` (${retake.remaining} left)`}
                    </Link>
                  </Button>
                )}
                <Button asChild size="sm" variant="outline">
                  <Link href="/leaderboard">
                    <Trophy aria-hidden="true" />
                    Leaderboard
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/practice">Practise weak areas</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/wrong-questions">Review incorrect questions</Link>
                </Button>

                {/* The analysis, offered where a student has just earned it.
                    It was reachable only from the series page, which is a step
                    backwards from the result they are already looking at. */}
                {hasSynopsis && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/synopsis/test/${result.test.id}`}>
                      <FileText aria-hidden="true" />
                      Read the analysis
                    </Link>
                  </Button>
                )}
              </div>

              {!retake.canRetake && retake.max > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  You have used all {retake.max} attempts for this test.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* How you compare / accuracy ------------------------------------ */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                How you compare
              </h2>

              {comparison.hasCohort ? (
                <>
                  <p className="mt-4 text-sm">
                    You scored better than{' '}
                    <span className="font-semibold text-primary">
                      {comparison.betterThanPercent}%
                    </span>{' '}
                    of attempts.
                  </p>
                  <Progress
                    value={comparison.betterThanPercent}
                    className="mt-2"
                    tone={comparison.betterThanPercent >= 60 ? 'success' : 'warning'}
                  />
                </>
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {/* Never quote a percentile off a cohort too small to mean anything. */}
                  Only {comparison.totalAttempts}{' '}
                  {comparison.totalAttempts === 1 ? 'attempt has' : 'attempts have'} been made at
                  this test so far — too few for a meaningful comparison. These figures become
                  reliable as more students attempt it.
                </p>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MiniStat label="Your score" value={comparison.yourScore} />
                <MiniStat label="Average" value={comparison.averageScore} tone="muted" />
                <MiniStat label="Best" value={comparison.bestScore} tone="success" />
                <MiniStat label="Attempts" value={comparison.totalAttempts} tone="muted" />
                <MiniStat label="Participants" value={comparison.uniqueParticipants} tone="muted" />
                <MiniStat
                  label="Percentile"
                  value={attempt.percentile != null ? attempt.percentile : '—'}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
                Accuracy analysis
              </h2>

              <div className="mt-4 flex flex-wrap items-baseline gap-3">
                <span
                  className={
                    attempt.accuracy >= 75
                      ? 'text-4xl font-semibold tabular-nums text-success'
                      : attempt.accuracy >= 50
                        ? 'text-4xl font-semibold tabular-nums text-warning'
                        : 'text-4xl font-semibold tabular-nums text-destructive'
                  }
                >
                  {attempt.accuracy}%
                </span>
                <span className="text-sm text-muted-foreground">
                  {attempt.correctCount} correct out of {attempt.attemptedCount} attempted
                </span>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3">
                <MiniStat
                  label="Questions attempted"
                  value={`${attempt.attemptedCount}/${review.length}`}
                />
                <MiniStat label="Marks earned" value={`+${marks.earned}`} tone="success" />
                <MiniStat label="Marks lost" value={marks.lost} tone="danger" />
                <MiniStat label="Net score" value={`${marks.net}/${marks.maxScore}`} />
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Score distribution -------------------------------------------- */}
        {comparison.totalAttempts > 1 && (
          <Card>
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold tracking-tight">Score distribution</h2>
                <p className="text-xs text-muted-foreground">
                  {comparison.totalAttempts} attempts · {comparison.uniqueParticipants} unique
                  participants · out of {marks.maxScore}
                </p>
              </div>

              <ul className="mt-5 space-y-2">
                {comparison.distribution.map((bucket) => {
                  const widest = Math.max(...comparison.distribution.map((b) => b.count), 1);
                  const width = (bucket.count / widest) * 100;

                  return (
                    <li key={bucket.label} className="flex items-center gap-3">
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {bucket.label}
                      </span>
                      <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className={
                            bucket.isYou
                              ? 'h-full rounded bg-primary transition-all'
                              : 'h-full rounded bg-muted-foreground/25 transition-all'
                          }
                          style={{ width: `${width}%` }}
                        />
                        {bucket.isYou && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[0.625rem] font-bold uppercase tracking-wider text-primary-foreground">
                            You
                          </span>
                        )}
                      </div>
                      <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {bucket.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Breakdowns ---------------------------------------------------- */}
        <div className="grid gap-6 lg:grid-cols-2">
          {(
            [
              { title: 'By subject', rows: breakdowns.subject, icon: Target },
              { title: 'By difficulty', rows: breakdowns.difficulty, icon: Gauge },
              { title: 'By chapter', rows: breakdowns.chapter, icon: Trophy },
              { title: 'By topic', rows: breakdowns.topic, icon: CheckCircle2 },
            ] as const
          )
            .filter((section) => section.rows.length > 0)
            .map((section) => (
              <Card key={section.title}>
                <CardContent className="p-5 sm:p-6">
                  <h2 className="font-semibold tracking-tight">{section.title}</h2>

                  <div className="mt-5 space-y-4">
                    {section.rows.map((row) => (
                      <div key={row.key}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-medium">
                            {DIFFICULTY_LABELS[row.label] ?? row.label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {row.score}/{row.maxScore}
                            <span className="ml-2 text-xs">{row.accuracy}% acc.</span>
                          </span>
                        </div>
                        <Progress
                          value={row.maxScore > 0 ? (row.score / row.maxScore) * 100 : 0}
                          className="mt-2"
                          size="sm"
                          tone={row.accuracy >= 75 ? 'success' : row.accuracy >= 50 ? 'warning' : 'danger'}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.correct} correct · {row.incorrect} incorrect · {row.unanswered}{' '}
                          skipped · {row.avgTimeSeconds}s avg
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>

        {/* Question review ----------------------------------------------- */}
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">Question-wise review</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your answer against the correct one, with the full solution for each question.
            </p>

            <div className="mt-5 space-y-3">
              {review.map((item) => {
                const verdict =
                  item.isCorrect === null ? 'skipped' : item.isCorrect ? 'correct' : 'incorrect';

                return (
                  <details
                    key={item.testQuestionId}
                    // Open by default. Collapsed, the page showed a list of
                    // truncated stems and every question had to be clicked to
                    // read its options and solution — which is most of the
                    // reason to open a result at all. It stays a `details` so
                    // a long review can still be folded away question by
                    // question.
                    open
                    // The left stripe carries the verdict in colour, so a long
                    // review can be skimmed down the edge without reading the
                    // badges: green ran right, red ran wrong, amber skipped.
                    className={cn(
                      'group overflow-hidden rounded-xl border-l-4 bg-card shadow-sm transition-shadow hover:shadow-md',
                      'border-y border-r border-border',
                      verdict === 'correct'
                        ? 'border-l-success'
                        : verdict === 'incorrect'
                          ? 'border-l-destructive'
                          : 'border-l-warning',
                    )}
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <span
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm',
                          verdict === 'correct'
                            ? 'bg-success'
                            : verdict === 'incorrect'
                              ? 'bg-destructive'
                              : 'bg-warning',
                        )}
                        aria-hidden="true"
                      >
                        {verdict === 'correct' ? (
                          <CheckCircle2 className="size-4" />
                        ) : verdict === 'incorrect' ? (
                          <XCircle className="size-4" />
                        ) : (
                          <CircleSlash className="size-4" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Q{item.sortOrder}
                          </span>
                          <Badge
                            variant={
                              verdict === 'correct'
                                ? 'success'
                                : verdict === 'incorrect'
                                  ? 'danger'
                                  : 'warning'
                            }
                            size="sm"
                          >
                            {verdict === 'correct'
                              ? `+${item.marksAwarded}`
                              : verdict === 'incorrect'
                                ? `${item.marksAwarded}`
                                : 'Skipped'}
                          </Badge>
                          <Badge variant="muted" size="sm">
                            {DIFFICULTY_LABELS[item.difficulty] ?? item.difficulty}
                          </Badge>
                          {item.topic && (
                            <span className="text-xs text-muted-foreground">{item.topic.name}</span>
                          )}
                          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" aria-hidden="true" />
                            {item.timeSpentSeconds}s
                          </span>
                        </div>

                        <p className="mt-2 line-clamp-2 whitespace-pre-line text-[0.95rem] font-medium leading-relaxed group-open:line-clamp-none">
                          {item.body}
                        </p>
                      </div>
                    </summary>

                    <div className="border-t border-border p-4">
                      {item.passage && (
                        <div className="mb-4 rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">
                          <p className="whitespace-pre-line">{item.passage}</p>
                        </div>
                      )}

                      {item.type === 'NUMERICAL' ? (
                        <dl className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-border p-3">
                            <dt className="text-xs text-muted-foreground">Your answer</dt>
                            <dd className="mt-0.5 font-semibold tabular-nums">
                              {item.numericalValue ?? 'Not answered'}
                            </dd>
                          </div>
                          <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                            <dt className="text-xs text-muted-foreground">Correct answer</dt>
                            <dd className="mt-0.5 font-semibold tabular-nums text-success">
                              {item.numericalAnswer ?? '—'}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <ul className="space-y-2">
                          {item.options.map((option) => (
                            <li
                              key={option.id}
                              className={cn(
                                'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                                option.isCorrect
                                  ? 'border-success/50 bg-success/10 ring-1 ring-success/20'
                                  : option.isSelected
                                    ? 'border-destructive/50 bg-destructive/10'
                                    : 'border-border bg-background hover:bg-muted/40',
                              )}
                            >
                              <span
                                className={cn(
                                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                  option.isCorrect
                                    ? 'bg-success text-white shadow-sm'
                                    : option.isSelected
                                      ? 'bg-destructive text-white shadow-sm'
                                      : 'border border-border bg-card text-muted-foreground',
                                )}
                                aria-hidden="true"
                              >
                                {option.label}
                              </span>
                              <span className="flex-1 whitespace-pre-line text-sm leading-relaxed">
                                {option.body}
                              </span>
                              {option.isCorrect && (
                                <Badge variant="success" size="sm">
                                  Correct
                                </Badge>
                              )}
                              {option.isSelected && !option.isCorrect && (
                                <Badge variant="danger" size="sm">
                                  Your answer
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {(item.detailedSolution || item.explanation) && (
                        <div className="mt-4 overflow-hidden rounded-xl border border-info/30 bg-info/5">
                          <p className="flex items-center gap-2 border-b border-info/20 bg-info/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-info">
                            <FileText className="size-3.5" aria-hidden="true" />
                            Solution
                          </p>
                          <div className="p-4">
                          {item.detailedSolution ? (
                            <div
                              className="prose-avk"
                              // Authored by faculty through the admin CMS.
                              dangerouslySetInnerHTML={{ __html: item.detailedSolution }}
                            />
                          ) : (
                            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                              {item.explanation}
                            </p>
                          )}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
