import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  FileQuestion,
  LifeBuoy,
  Plus,
  Receipt,
  Target,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { formatDate, formatNumber, formatPaise } from '@/lib/utils';
import { can, enforceAdminArea } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import {
  getAdminOverview,
  getIncompleteTests,
  getRecentActivity,
} from '@/server/services/admin-service';

export const metadata: Metadata = {
  title: 'Admin dashboard',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const user = await enforceAdminArea('/admin');

  const [overview, activity, incomplete] = await Promise.all([
    getAdminOverview(),
    getRecentActivity(),
    getIncompleteTests(),
  ]);

  const firstName = user.name.split(' ')[0] ?? user.name;

  /** Things actually waiting on a human, most consequential first. */
  const needsAttention = [
    incomplete.length > 0 && {
      label: `${incomplete.length} published ${incomplete.length === 1 ? 'test has' : 'tests have'} no questions`,
      detail: 'Students who open these get a dead end.',
      href: '/admin/tests?status=PUBLISHED',
      tone: 'danger' as const,
    },
    overview.inbox.openTickets > 0 && {
      label: `${overview.inbox.openTickets} open support ${overview.inbox.openTickets === 1 ? 'ticket' : 'tickets'}`,
      detail: 'Students are waiting for a reply.',
      href: '/admin/support',
      tone: 'warning' as const,
    },
    overview.inbox.openReports > 0 && {
      label: `${overview.inbox.openReports} reported ${overview.inbox.openReports === 1 ? 'question' : 'questions'}`,
      detail: 'Students have flagged a possible mistake.',
      href: '/admin/reports',
      tone: 'warning' as const,
    },
    overview.questions.flagged > 0 && {
      label: `${overview.questions.flagged} ${overview.questions.flagged === 1 ? 'question carries' : 'questions carry'} a review note`,
      detail: 'Flagged during import; verify before ranked use.',
      href: '/admin/questions?flagged=1',
      tone: 'info' as const,
    },
    overview.questions.draft > 0 && {
      label: `${overview.questions.draft} draft ${overview.questions.draft === 1 ? 'question' : 'questions'}`,
      detail: 'Not visible to students until published.',
      href: '/admin/questions?status=DRAFT',
      tone: 'info' as const,
    },
  ].filter(Boolean) as { label: string; detail: string; href: string; tone: 'danger' | 'warning' | 'info' }[];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What needs your attention, and what the platform has been doing.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/admin/questions/new">
              <Plus aria-hidden="true" />
              New question
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/tests/new">
              <Plus aria-hidden="true" />
              New test
            </Link>
          </Button>
        </div>
      </header>

      {/* Needs attention ------------------------------------------------- */}
      {needsAttention.length > 0 && (
        <Card variant="accent">
          <CardContent className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-semibold tracking-tight">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              Needs attention
            </h2>

            <ul className="mt-4 space-y-2.5">
              {needsAttention.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
                  >
                    <span
                      className={
                        item.tone === 'danger'
                          ? 'mt-1.5 size-2 shrink-0 rounded-full bg-destructive'
                          : item.tone === 'warning'
                            ? 'mt-1.5 size-2 shrink-0 rounded-full bg-warning'
                            : 'mt-1.5 size-2 shrink-0 rounded-full bg-info'
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight transition-colors group-hover:text-primary">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <ArrowRight
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Counters -------------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Questions"
          value={formatNumber(overview.questions.total)}
          icon={FileQuestion}
          hint={`${overview.questions.published} published`}
        />
        <StatCard
          label="Tests"
          value={overview.tests.total}
          icon={ClipboardList}
          hint={`${overview.tests.published} published${overview.tests.empty > 0 ? `, ${overview.tests.empty} empty` : ''}`}
        />
        <StatCard
          label="Students"
          value={formatNumber(overview.students.total)}
          icon={Users}
          hint={`+${overview.students.newThisWeek} this week`}
        />
        <StatCard
          label="Attempts"
          value={formatNumber(overview.attempts.total)}
          icon={Target}
          hint={`${overview.attempts.thisWeek} this week`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent activity --------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold tracking-tight">Recent attempts</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/analytics">Analytics</Link>
              </Button>
            </div>

            {activity.length === 0 ? (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                No tests have been submitted yet. Once students start attempting, their results
                appear here.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {activity.map((attempt) => (
                  <li key={attempt.id} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {attempt.user.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {attempt.test.title} · {formatDate(attempt.submittedAt, 'short')}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {attempt.score}
                      <span className="font-normal text-muted-foreground">/{attempt.maxScore}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Commerce ----------------------------------------------------- */}
        <Card>
          <CardContent className="p-5 sm:p-6">
            {/* Revenue and orders only for an admin who may see orders; the
                support summary below is for everyone. */}
            {can(user, PERMISSIONS.ORDER_READ) && (
              <>
                <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                  <Receipt className="size-4 text-muted-foreground" aria-hidden="true" />
                  Commerce
                </h2>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Revenue collected
                    </p>
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                      {formatPaise(overview.commerce.revenueInPaise)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Paid orders</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {overview.commerce.paidOrders}
                    </p>
                  </div>
                </div>

                <Button asChild fullWidth variant="outline" size="sm" className="mt-5">
                  <Link href="/admin/orders">View orders</Link>
                </Button>
              </>
            )}

            <div
              className={
                can(user, PERMISSIONS.ORDER_READ) ? 'mt-5 border-t border-border pt-4' : undefined
              }
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <LifeBuoy className="size-4 text-muted-foreground" aria-hidden="true" />
                Support
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {overview.inbox.openTickets === 0
                  ? 'No open tickets.'
                  : `${overview.inbox.openTickets} waiting for a reply.`}
              </p>
              <Button asChild fullWidth variant="outline" size="sm" className="mt-3">
                <Link href="/admin/support">Open inbox</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty tests ------------------------------------------------------ */}
      {incomplete.length > 0 && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">Published tests with no questions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These are visible to students but cannot be attempted. Attach questions or unpublish
              them.
            </p>

            <ul className="mt-4 divide-y divide-border">
              {incomplete.map((test) => (
                <li key={test.id} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{test.title}</p>
                    {test.testSeries && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {test.testSeries.name}
                      </p>
                    )}
                  </div>
                  <Badge variant="danger" size="sm">
                    0 questions
                  </Badge>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={`/admin/tests/${test.id}`}>Fix</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
