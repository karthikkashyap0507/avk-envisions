import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, LayoutGrid } from 'lucide-react';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ClearSeriesQuestions } from '@/features/admin/clear-series-questions';
import { formatPaise } from '@/lib/utils';
import { enforceAdminArea } from '@/server/auth/guards';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'Test series',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TRACK_LABELS: Record<string, string> = {
  FREE_SERIES: 'Free series',
  PAID_SERIES: 'Paid series',
  PYQ: 'Previous year',
  CHAPTERWISE: 'Chapterwise',
  KEA_FDA_SDA: 'KEA FDA / SDA',
};

export default async function AdminTestSeriesPage() {
  await enforceAdminArea('/admin/test-series');

  const series = await db.testSeries.findMany({
    where: { deletedAt: null },
    orderBy: [{ track: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      track: true,
      status: true,
      priceInPaise: true,
      examYear: true,
      sessionLabel: true,
      exam: { select: { shortName: true } },
      tests: {
        where: { deletedAt: null },
        select: { id: true, status: true, totalQuestions: true },
      },
    },
  });

  const grouped = series.reduce<Record<string, typeof series>>((acc, item) => {
    (acc[item.track] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Test series</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {series.length} series across the four catalogue tracks.
        </p>
      </header>

      {series.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No test series"
          description="Series are created by the catalogue seed. Run `npm run db:seed:catalogue`."
        />
      ) : (
        Object.entries(grouped).map(([track, items]) => (
          <section key={track}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {TRACK_LABELS[track] ?? track}
            </h2>

            <Card className="mt-3">
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {items.map((item) => {
                    const published = item.tests.filter((t) => t.status === 'PUBLISHED');
                    const ready = published.filter((t) => t.totalQuestions > 0).length;
                    const empty = published.length - ready;

                    const questionCount = item.tests.reduce((n, t) => n + t.totalQuestions, 0);

                    return (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium leading-tight">{item.name}</span>
                            <StatusBadge status={item.status} />
                            {empty > 0 && (
                              <Badge variant="warning" size="sm">
                                <AlertTriangle aria-hidden="true" />
                                {empty} empty
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.exam.shortName} · {ready} of {item.tests.length} tests ready ·{' '}
                            {questionCount} question{questionCount === 1 ? '' : 's'} ·{' '}
                            {item.priceInPaise === 0 ? 'Free' : formatPaise(item.priceInPaise)}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <ClearSeriesQuestions
                            seriesId={item.id}
                            seriesName={item.name}
                            questionCount={questionCount}
                          />
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/admin/tests?q=${encodeURIComponent(item.name)}`}>
                              Tests
                            </Link>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
