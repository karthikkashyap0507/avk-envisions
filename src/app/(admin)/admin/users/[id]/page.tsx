import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardList, FileQuestion, ListChecks, Trophy } from 'lucide-react';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { formatDate, formatDuration } from '@/lib/utils';
import { enforceAdminPermission } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import { getUserAttemptHistory } from '@/server/services/admin-service';

export const metadata: Metadata = {
  title: 'Student',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** How each attempt state reads in the list. */
const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'muted' }> = {
  SUBMITTED: { label: 'Submitted', tone: 'success' },
  AUTO_SUBMITTED: { label: 'Time up', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  IN_PROGRESS: { label: 'In progress', tone: 'muted' },
  ABANDONED: { label: 'Abandoned', tone: 'muted' },
};

/**
 * `/admin/users/[id]` - one student, and every test they have attempted.
 *
 * Reached from a name in the dashboard's recent attempts or in the users
 * list. Behind the same permission as the users list: the staff admin, who
 * may not see users, cannot open it either.
 */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await enforceAdminPermission(PERMISSIONS.USER_READ, `/admin/users/${id}`);

  const history = await getUserAttemptHistory(id);
  if (!history) notFound();
  const { user, attempts, quizzes, summary } = history;
  const isGuest = user.signupSource === 'GUEST_FREE_TEST';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/users">
            <ArrowLeft aria-hidden="true" />
            Users
          </Link>
        </Button>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {user.name}
          <Badge variant={user.role === 'ADMIN' ? 'brand' : 'muted'} size="sm">
            {user.role}
          </Badge>
          <StatusBadge status={user.status} />
          {isGuest && (
            <Badge variant="info" size="sm">
              Free-test lead
            </Badge>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isGuest ? (user.phone ?? 'No number recorded') : user.email}
          {!isGuest && user.phone && ` · ${user.phone}`} · joined {formatDate(user.createdAt, 'short')}
          {user.lastLoginAt && ` · last seen ${formatDate(user.lastLoginAt, 'short')}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Attempts" value={summary.attempts} hint={`${summary.finished} finished`} icon={ClipboardList} />
        <StatCard label="Tests attempted" value={summary.tests} hint="Different tests" icon={FileQuestion} />
        <StatCard
          label="Average score"
          value={summary.averagePercentage === null ? '—' : `${summary.averagePercentage}%`}
          hint={summary.bestPercentage === null ? 'No finished attempt yet' : `Best ${summary.bestPercentage}%`}
          icon={Trophy}
        />
        <StatCard label="Quizzes" value={quizzes} hint="Quiz sessions started" icon={ListChecks} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold tracking-tight">Every attempt</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Newest first, finished or not.</p>
          </div>

          {attempts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ClipboardList}
                title="No attempts yet"
                description="This student has not started any test."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Test</th>
                    <th className="px-3 py-3 font-medium">Attempt</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Score</th>
                    <th className="px-3 py-3 text-right font-medium">Accuracy</th>
                    <th className="px-3 py-3 text-right font-medium">Right · wrong · left</th>
                    <th className="px-3 py-3 text-right font-medium">Time</th>
                    <th className="px-5 py-3 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attempts.map((attempt) => {
                    const status = STATUS_LABEL[attempt.status] ?? { label: attempt.status, tone: 'muted' as const };
                    const finished = attempt.status !== 'IN_PROGRESS' && attempt.status !== 'ABANDONED';
                    return (
                      <tr key={attempt.id} className="align-top">
                        <td className="px-5 py-3">
                          <Link href={`/admin/tests/${attempt.test.id}`} className="font-medium hover:text-primary hover:underline">
                            {attempt.test.title}
                          </Link>
                          {attempt.test.testSeries && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{attempt.test.testSeries.name}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-muted-foreground">#{attempt.attemptNumber}</td>
                        <td className="px-3 py-3">
                          <Badge variant={status.tone} size="sm">
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {finished ? (
                            <>
                              <span className="font-semibold">{attempt.score}</span>
                              <span className="text-muted-foreground">/{attempt.maxScore}</span>
                              <p className="text-xs text-muted-foreground">{Math.round(attempt.percentage)}%</p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {finished ? `${Math.round(attempt.accuracy)}%` : '—'}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {finished
                            ? `${attempt.correctCount} · ${attempt.incorrectCount} · ${attempt.unansweredCount}`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {attempt.timeSpentSeconds > 0 ? formatDuration(attempt.timeSpentSeconds) : '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">
                          {formatDate(attempt.submittedAt ?? attempt.startedAt, 'short')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
