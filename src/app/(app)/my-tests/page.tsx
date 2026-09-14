import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Clock, FileQuestion, PlayCircle, Trophy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { TERMINAL_ATTEMPT_STATUSES, TEST_CATEGORY_LABELS, type TestCategory } from '@/lib/enums';
import { formatDate, formatDuration, ordinal } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getOpenableSeries } from '@/server/services/purchased-service';

export const metadata: Metadata = {
  title: 'My tests',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MyTestsPage() {
  const user = await enforceStudent('/my-tests');

  const [inProgress, completed, available] = await Promise.all([
    db.testAttempt.findMany({
      where: { userId: user.id, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        expiresAt: true,
        test: { select: { title: true, totalQuestions: true, durationMinutes: true } },
      },
    }),
    db.testAttempt.findMany({
      where: { userId: user.id, status: { in: [...TERMINAL_ATTEMPT_STATUSES] } },
      orderBy: { submittedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        score: true,
        maxScore: true,
        percentage: true,
        accuracy: true,
        rank: true,
        percentile: true,
        timeSpentSeconds: true,
        submittedAt: true,
        attemptNumber: true,
        test: { select: { id: true, title: true, category: true } },
      },
    }),
    // The series a student can open, not every paper inside them. Listing
    // each paper put dozens of near-identical cards on one screen, and the
    // query behind it only ever looked at free tests — so a course they had
    // paid for did not appear here at all.
    getOpenableSeries(user.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My tests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you have attempted, and everything you can start right now.
        </p>
      </header>

      {/* Resume -------------------------------------------------------- */}
      {inProgress.length > 0 && (
        <section aria-labelledby="in-progress-heading">
          <h2 id="in-progress-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            In progress
          </h2>

          <div className="mt-3 space-y-3">
            {inProgress.map((attempt) => (
              <Card key={attempt.id} variant="accent">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <PlayCircle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-semibold leading-tight">{attempt.test.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Started {formatDate(attempt.startedAt, 'full')} · your answers are saved
                      </p>
                    </div>
                  </div>
                  <Button asChild className="shrink-0">
                    <Link href={`/test/${attempt.id}`}>
                      Resume
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* What they can open ---------------------------------------------- */}
      <section aria-labelledby="available-heading">
        <h2 id="available-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your test series
        </h2>

        {available.length === 0 ? (
          <EmptyState
            className="mt-3"
            size="sm"
            icon={FileQuestion}
            title="No test series available yet"
            description="Free series appear here as soon as they are published, along with anything you buy."
            action={{ label: 'Browse test series', href: '/test-series' }}
          />
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((series) => (
              <Card key={series.id} interactive className="h-full">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="flex items-center gap-2">
                    <Badge variant={series.isFree ? 'success' : 'brand'} size="sm">
                      {series.isFree ? 'Free' : 'Purchased'}
                    </Badge>
                  </div>

                  <h3 className="mt-3 font-semibold leading-snug tracking-tight">{series.name}</h3>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {series.blurb}
                  </p>

                  {/* How much is sittable today, against the published plan.
                      A series part-written says so rather than implying every
                      paper is ready. */}
                  <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                    <FileQuestion className="size-3.5" aria-hidden="true" />
                    {series.readyCount === series.totalCount
                      ? `${series.totalCount} ${series.totalCount === 1 ? 'test' : 'tests'}`
                      : `${series.readyCount} of ${series.totalCount} ready to attempt`}
                  </p>

                  {/* One button per series. The series page is where a paper
                      is chosen — it already knows which are open and shows the
                      schedule beside them. */}
                  <Button asChild fullWidth className="mt-4">
                    <Link href={series.href}>
                      Open series
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* History -------------------------------------------------------- */}
      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Completed
        </h2>

        {completed.length === 0 ? (
          <EmptyState
            className="mt-3"
            size="sm"
            icon={Trophy}
            title="No completed tests yet"
            description="Once you submit a test, your score, rank and full analysis appear here."
          />
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              {completed.map((attempt) => (
                <Link
                  key={attempt.id}
                  href={`/test/${attempt.id}/result`}
                  className="group flex items-center gap-4 p-4 transition-colors hover:bg-muted/40 sm:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-tight transition-colors group-hover:text-primary">
                      {attempt.test.title}
                      {attempt.attemptNumber > 1 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Attempt {attempt.attemptNumber}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(attempt.submittedAt, 'short')} ·{' '}
                      {formatDuration(attempt.timeSpentSeconds)} · {attempt.accuracy}% accuracy
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    {attempt.rank != null && (
                      <p className="text-sm font-medium tabular-nums">{ordinal(attempt.rank)}</p>
                    )}
                    {attempt.percentile != null && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {attempt.percentile} percentile
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">
                      {attempt.score}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{attempt.maxScore}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {attempt.percentage}%
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
