import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, Clock, Gauge, Target, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { cn, formatDate, formatDuration, formatNumber } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import {
  getAnalyticsOverview,
  getChapterPerformance,
  getDifficultyPerformance,
  getScoreTrend,
  getSubjectPerformance,
  getTopicVerdicts,
} from '@/server/services/analytics-service';

export const metadata: Metadata = {
  title: 'Analytics',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

/** Accuracy → tone, applied consistently across every bar on the page. */
function toneFor(accuracy: number) {
  return accuracy >= 75 ? 'success' : accuracy >= 50 ? 'warning' : 'danger';
}

export default async function AnalyticsPage() {
  const user = await enforceStudent('/analytics');

  const [overview, subjects, chapters, difficulty, verdicts, trend] = await Promise.all([
    getAnalyticsOverview(user.id),
    getSubjectPerformance(user.id),
    getChapterPerformance(user.id),
    getDifficultyPerformance(user.id),
    getTopicVerdicts(user.id),
    getScoreTrend(user.id),
  ]);

  if (overview.questionsAnswered === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where your marks are going, and what to do about it.
          </p>
        </header>

        <EmptyState
          icon={BarChart3}
          title="No data to analyse yet"
          description="Attempt a test or a quiz and this page fills with subject, chapter and topic breakdowns drawn from your actual answers."
          action={{ label: 'Attempt a test', href: '/my-tests' }}
          secondaryAction={{ label: 'Take a quiz', href: '/practice' }}
        />
      </div>
    );
  }

  const bestTrend = trend.length > 0 ? Math.max(...trend.map((t) => t.percentage)) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Computed from every answer you have given, in tests and in quizzes.
        </p>
      </header>

      {/* Overview -------------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Questions answered"
          value={formatNumber(overview.questionsAnswered)}
          icon={Target}
          hint={`${overview.correct} correct, ${overview.incorrect} incorrect`}
        />
        <StatCard
          label="Overall accuracy"
          value={`${overview.accuracy}%`}
          icon={Gauge}
          hint="Across tests and quizzes"
        />
        <StatCard
          label="Average time"
          value={`${Math.round(overview.avgTimeSeconds)}s`}
          icon={Clock}
          hint="Per question"
        />
        <StatCard
          label="Time invested"
          value={formatDuration(overview.totalTimeSeconds)}
          icon={TrendingUp}
          hint={`${overview.testsCompleted} tests, ${overview.practiceSessions} quizzes`}
        />
      </div>

      {/* Score trend ----------------------------------------------------- */}
      {trend.length > 0 && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold tracking-tight">Score trend</h2>
              <p className="text-xs text-muted-foreground">
                Last {trend.length} {trend.length === 1 ? 'attempt' : 'attempts'}, oldest first
              </p>
            </div>

            {trend.length === 1 ? (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                One attempt so far — a trend needs at least two. Your next test will start the line.
              </p>
            ) : (
              <>
                {/* Column chart drawn with plain divs: no chart library, no
                    hydration cost, and it degrades cleanly without CSS. */}
                <div className="mt-6 flex h-44 items-end gap-1.5" role="img" aria-label="Score trend by attempt">
                  {trend.map((point) => (
                    <div key={point.attemptId} className="group relative flex flex-1 flex-col justify-end">
                      <div
                        className={cn(
                          'w-full rounded-t transition-colors',
                          point.percentage >= 75
                            ? 'bg-success'
                            : point.percentage >= 50
                              ? 'bg-warning'
                              : 'bg-destructive',
                        )}
                        style={{ height: `${Math.max(4, point.percentage)}%` }}
                      />
                      <span className="sr-only">
                        {point.title}: {point.percentage}%
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(trend[0]!.date, 'short')}</span>
                  <span>Best {bestTrend}%</span>
                  <span>{formatDate(trend[trend.length - 1]!.date, 'short')}</span>
                </div>

                <ul className="mt-5 divide-y divide-border border-t border-border">
                  {[...trend].reverse().slice(0, 5).map((point) => (
                    <li key={point.attemptId}>
                      <Link
                        href={`/test/${point.attemptId}/result`}
                        className="group flex items-center gap-4 py-2.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate transition-colors group-hover:text-primary">
                          {point.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(point.date, 'short')}
                        </span>
                        <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                          {point.percentage}%
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Focus areas ----------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">Weak topics</h2>

            {verdicts.weak.length === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {verdicts.analysedCount === 0
                  ? `No topic has enough data yet. A topic is only classified once you have answered ${verdicts.minAnswers} questions on it — ${verdicts.pendingCount} ${verdicts.pendingCount === 1 ? 'topic is' : 'topics are'} still gathering evidence.`
                  : `None of your ${verdicts.analysedCount} analysed topics are below 50% accuracy.`}
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {verdicts.weak.map((topic) => (
                  <li key={topic.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{topic.name}</span>
                      <span className="shrink-0 tabular-nums text-destructive">
                        {topic.accuracy}%
                      </span>
                    </div>
                    <Progress value={topic.accuracy} className="mt-1.5" size="sm" tone="danger" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {topic.correct}/{topic.total} correct · {Math.round(topic.avgTimeSeconds)}s avg
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {verdicts.weak.length > 0 && (
              <Button asChild fullWidth variant="outline" className="mt-5">
                <Link href="/practice">Take a quiz on these topics</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">Strong topics</h2>

            {verdicts.strong.length === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                No topic is above 75% accuracy with enough attempts to be sure yet. Keep going —
                this fills in as you answer more.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {verdicts.strong.map((topic) => (
                  <li key={topic.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{topic.name}</span>
                      <span className="shrink-0 tabular-nums text-success">{topic.accuracy}%</span>
                    </div>
                    <Progress value={topic.accuracy} className="mt-1.5" size="sm" tone="success" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {topic.correct}/{topic.total} correct
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Breakdowns ------------------------------------------------------ */}
      {(
        [
          { title: 'By subject', rows: subjects },
          { title: 'By chapter', rows: chapters.slice(0, 12) },
          { title: 'By difficulty', rows: difficulty },
        ] as const
      )
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <Card key={section.title}>
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-semibold tracking-tight">{section.title}</h2>

              <div className="mt-5 space-y-4">
                {section.rows.map((row) => (
                  <div key={row.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        <span className="truncate">{DIFFICULTY_LABELS[row.name] ?? row.name}</span>
                        {!row.isReliable && (
                          <Badge variant="muted" size="sm">
                            Low data
                          </Badge>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.accuracy}%
                        <span className="ml-2 text-xs">
                          ({row.correct}/{row.total})
                        </span>
                      </span>
                    </div>
                    <Progress
                      value={row.accuracy}
                      className="mt-2"
                      size="sm"
                      tone={toneFor(row.accuracy)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {Math.round(row.avgTimeSeconds)}s average per question
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

      <p className="text-xs leading-relaxed text-muted-foreground">
        A topic is only labelled weak or strong once you have answered at least{' '}
        {verdicts.minAnswers} questions on it. Anything below that is marked &ldquo;low data&rdquo;
        rather than guessed at.
      </p>
    </div>
  );
}
