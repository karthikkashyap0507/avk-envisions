import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock, RotateCcw, Target, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProgressRing } from '@/components/ui/progress';
import { MiniStat } from '@/components/ui/stat-card';
import { QuestionReview } from '@/features/practice/question-review';
import { formatDuration } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { getPracticeSession } from '@/server/services/practice-service';

export const metadata: Metadata = {
  title: 'Quiz summary',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PracticeSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await enforceStudent(`/practice/${id}/summary`);

  const session = await getPracticeSession(id, user.id).catch(() => null);
  if (!session) notFound();

  const answered = session.questions.filter((q) => q.answer !== null);
  const wrong = answered.filter((q) => q.answer?.isCorrect === false);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/practice">
            <ArrowLeft aria-hidden="true" />
            Quiz
          </Link>
        </Button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Quiz summary</h1>
        <p className="mt-1 text-sm text-muted-foreground">{session.scope}</p>
      </div>

      {/* Headline ------------------------------------------------------- */}
      <Card variant="elevated">
        <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:p-8">
          <ProgressRing
            value={session.accuracy}
            size={128}
            strokeWidth={10}
            tone={session.accuracy >= 75 ? 'success' : session.accuracy >= 50 ? 'warning' : 'danger'}
            label={
              <div className="text-center">
                <p className="text-2xl font-semibold tabular-nums">
                  {Math.round(session.accuracy)}%
                </p>
                <p className="text-xs text-muted-foreground">accuracy</p>
              </div>
            }
          />

          <div className="flex-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Correct" value={session.correctCount} tone="success" />
              <MiniStat label="Incorrect" value={session.incorrectCount} tone="danger" />
              <MiniStat
                label="Answered"
                value={`${session.attemptedCount}/${session.questionCount}`}
              />
              <MiniStat label="Time" value={formatDuration(session.timeSpentSeconds)} />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/practice">
                  <RotateCcw aria-hidden="true" />
                  Take another quiz
                </Link>
              </Button>
              {wrong.length > 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/wrong-questions">Review all mistakes</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href="/analytics">See analytics</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verdict strip -------------------------------------------------- */}
      {answered.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-5 py-4 text-sm">
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <span className="font-semibold tabular-nums">{session.correctCount}</span> correct
          </span>
          <span className="flex items-center gap-1.5 text-destructive">
            <XCircle className="size-4" aria-hidden="true" />
            <span className="font-semibold tabular-nums">{session.incorrectCount}</span> incorrect
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Target className="size-4" aria-hidden="true" />
            <span className="font-semibold tabular-nums">
              {session.questionCount - session.attemptedCount}
            </span>{' '}
            skipped
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-4" aria-hidden="true" />
            {session.attemptedCount > 0
              ? `${Math.round(session.timeSpentSeconds / session.attemptedCount)}s avg`
              : '—'}
          </span>
        </div>
      )}

      {/* Review --------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Question review
        </h2>

        <div className="mt-3 space-y-4">
          {session.questions.map((question, index) => (
            <QuestionReview
              key={question.questionId}
              questionId={question.questionId}
              index={index + 1}
              body={question.body}
              passage={question.passage}
              imageUrl={question.imageUrl}
              type={question.type}
              difficulty={question.difficulty}
              numericalAnswer={question.numericalAnswer}
              numericalValue={question.answer?.numericalValue ?? null}
              explanation={question.explanation}
              detailedSolution={question.detailedSolution}
              subject={question.subject}
              chapter={question.chapter}
              topic={question.topic?.name ?? null}
              isCorrect={question.answer?.isCorrect ?? null}
              isBookmarked={question.isBookmarked}
              options={question.options.map((option) => ({
                ...option,
                isSelected: question.answer?.selectedOptionIds.includes(option.id) ?? false,
              }))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
