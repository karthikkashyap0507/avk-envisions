import type { Metadata } from 'next';
import Link from 'next/link';
import { PlayCircle, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PracticeSetup } from '@/features/practice/practice-setup';
import { formatDate, formatDuration } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getPracticeFilters, getRecentPracticeSessions } from '@/server/services/practice-service';

export const metadata: Metadata = {
  title: 'Quiz',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PracticePage() {
  const user = await enforceStudent('/practice');

  const [filters, recent, live] = await Promise.all([
    getPracticeFilters(user.id),
    getRecentPracticeSessions(user.id, 8),
    db.practiceSession.findFirst({
      where: { userId: user.id, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, questionCount: true, attemptedCount: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Quiz</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Untimed, unpenalised drilling with the solution revealed the moment you answer.
        </p>
      </header>

      {live && (
        <Card variant="accent">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <PlayCircle className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold leading-tight">Quiz in progress</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {live.attemptedCount} of {live.questionCount} answered
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href={`/practice/${live.id}`}>Resume</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {filters.subjects.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No questions available yet"
          description="The quiz opens up as soon as questions are published to the bank."
          action={{ label: 'Browse courses', href: '/courses' }}
        />
      ) : (
        <PracticeSetup
          subjects={filters.subjects}
          bookmarkCount={filters.bookmarkCount}
          incorrectCount={filters.incorrectCount}
        />
      )}

      {/* History -------------------------------------------------------- */}
      {recent.length > 0 && (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent sessions
          </h2>

          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {recent.map((session) => {
                const scope =
                  session.topic?.name ?? session.chapter?.name ?? session.subject?.name ?? 'All subjects';
                const href =
                  session.status === 'IN_PROGRESS'
                    ? `/practice/${session.id}`
                    : `/practice/${session.id}/summary`;

                return (
                  <li key={session.id}>
                    <Link
                      href={href}
                      className="group flex items-center gap-4 p-4 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate font-medium leading-tight transition-colors group-hover:text-primary">
                          {scope}
                          {session.status === 'IN_PROGRESS' && (
                            <Badge variant="info" size="sm">
                              In progress
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(session.startedAt, 'short')} · {session.attemptedCount}/
                          {session.questionCount} answered ·{' '}
                          {formatDuration(session.timeSpentSeconds)}
                        </p>
                      </div>

                      {session.attemptedCount > 0 && (
                        <div className="shrink-0 text-right">
                          <p className="font-semibold tabular-nums">{Math.round(session.accuracy)}%</p>
                          <p className="text-xs text-muted-foreground">
                            {session.correctCount}/{session.attemptedCount}
                          </p>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
