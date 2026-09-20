import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays, Clock, FileQuestion } from 'lucide-react';

import { PageHeader } from '@/components/site/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { formatDate } from '@/lib/utils';
import { SynopsisViewer } from '@/features/student/synopsis-viewer';
import { getTrackSeries, type TrackKey } from '@/server/services/catalogue-service';

/**
 * Tracks with a syllabus worth a page of its own.
 *
 * The free series is deliberately absent: its tests can be attempted on any
 * day in any order, so there is no timetable to publish, and the page only
 * repeated the schedule already on the track page.
 */
const TRACKS: Record<string, { key: TrackKey; title: string; schedulePdf?: string }> = {
  'paid-test-series': {
    key: 'PAID_SERIES',
    title: 'KPSC KAS Prelims — KAS Full Length Tests',
    // The published timetable carries the per-test syllabus in full, which the
    // schedule rows do not. Shown alongside them rather than instead: the rows
    // say what is attemptable now, the document says what each test covers.
    schedulePdf: '/api/schedule/paid',
  },
  'kas-50': {
    key: 'DAILY_CHALLENGE',
    title: 'KAS-50 (Daily tests)',
    // The fifty-day plan, which is the whole proposition of this series: a
    // student wants to see what falls on which date before joining, and most
    // of those papers are not written yet.
    schedulePdf: '/api/schedule/50-days',
  },
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ track: string }>;
}): Promise<Metadata> {
  const { track } = await params;
  const meta = TRACKS[track];
  if (!meta) return { title: 'Syllabus', robots: { index: false, follow: false } };

  return {
    title: `Syllabus and timetable — ${meta.title}`,
    description: 'Every test in the series with its date, duration and full syllabus.',
    alternates: { canonical: `/courses/${track}/syllabus` },
  };
}

/**
 * `/courses/[track]/syllabus` — the full timetable, syllabus included.
 *
 * The schedule on the track page lists what to attempt and when. This is the
 * other question a student asks before paying: what is actually in each test.
 * The syllabus is long enough that putting it inline would bury the schedule,
 * so it lives on its own page.
 */
export default async function SyllabusPage({ params }: { params: Promise<{ track: string }> }) {
  const { track } = await params;
  const meta = TRACKS[track];
  if (!meta) notFound();

  const series = await getTrackSeries(meta.key);
  const rows = series.flatMap((s) => s.schedule);

  const durations = [...new Set(rows.map((r) => r.durationMinutes))];
  const perTest = durations.length === 1 ? (durations[0] ?? null) : null;

  return (
    <>
      <PageHeader
        eyebrow="Syllabus and timetable"
        title={meta.title}
        description="Every test in the series, in order, with the syllabus it covers."
      >
        <div className="mt-8 flex flex-wrap gap-4">
          <div className="rounded-xl border border-border bg-card px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <FileQuestion className="size-3.5" aria-hidden="true" />
              Total tests
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{rows.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              Duration per test
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {perTest === null
                ? 'Varies'
                : perTest >= 60
                  ? `${perTest / 60} hours`
                  : `${perTest} minutes`}
            </p>
          </div>
        </div>
      </PageHeader>

      {meta.schedulePdf && (
        <section className="container pt-10">
          <h2 className="text-lg font-semibold tracking-tight">The published timetable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every test with its date, sitting time and the syllabus it covers.
          </p>
          <div className="mt-4">
            <SynopsisViewer src={meta.schedulePdf} title={`${meta.title} timetable`} />
          </div>
        </section>
      )}

      <section className="container py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/courses/${track}`}>
            <ArrowLeft aria-hidden="true" />
            Back to the series
          </Link>
        </Button>

        {rows.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={CalendarDays}
            title="Timetable not published yet"
            description="The schedule will appear here once it is finalised."
          />
        ) : (
          <ol className="mt-6 space-y-3">
            {rows.map((row, index) => (
              <li
                key={row.id}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold tabular-nums text-primary">
                      {index + 1}
                    </span>
                    <div>
                      <h2 className="font-semibold leading-tight tracking-tight">{row.title}</h2>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          {row.startDate ? formatDate(row.startDate, 'long') : 'Attempt any day'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden="true" />
                          {row.durationMinutes >= 60
                            ? `${row.durationMinutes / 60} hours`
                            : `${row.durationMinutes} minutes`}
                        </span>
                      </p>
                    </div>
                  </div>

                  {row.totalQuestions > 0 ? (
                    <Badge variant="success" size="sm">
                      {row.totalQuestions} questions
                    </Badge>
                  ) : (
                    <Badge variant="muted" size="sm">
                      Questions being added
                    </Badge>
                  )}
                </div>

                {row.description && (
                  <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
                    {row.description}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
