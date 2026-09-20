import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  PlayCircle,
  Timer,
} from 'lucide-react';

import { PageHeader } from '@/components/site/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { formatDate, formatDuration, formatPaise } from '@/lib/utils';
import { currentUser } from '@/server/auth/guards';
import { getSeriesPricing } from '@/server/services/pricing-service';
import { paymentsEnabled } from '@/server/services/payment-service';
import { BuyButton } from '@/features/checkout/buy-button';
import {
  getTrackSeries,
  type ScheduleRow,
  type TrackKey,
} from '@/server/services/catalogue-service';

/** URL slug -> track, so /courses/free-test-series reads naturally. */
const TRACKS: Record<string, { key: TrackKey; title: string; eyebrow: string; blurb: string }> = {
  'free-test-series': {
    key: 'FREE_SERIES',
    title: 'KPSC KAS Prelims — Free Test Series',
    eyebrow: 'Free Test Series',
    blurb:
      'Attempt tests as per the schedule to assess your preparation level. Each test unlocks at midnight on its scheduled date and must be completed in one sitting.',
  },
  'paid-test-series': {
    key: 'PAID_SERIES',
    title: 'KPSC KAS Prelims — KAS Full Length Tests',
    eyebrow: 'KAS Full Length Tests',
    blurb:
      'Full-length tests in the exact prelims pattern, each followed by All India ranking, percentile and a complete subject-level breakdown.',
  },
  // The three remaining tracks. Without these, "View details" on the courses
  // page 404'd for previous-year papers, KAS-50 and chapterwise.
  'previous-year-papers': {
    key: 'PYQ',
    title: 'KPSC KAS Prelims — Previous Year Papers',
    eyebrow: 'KAS PYQ Tests',
    blurb:
      'Every paper KPSC has set, with the full analysis for each. The complete 2011 paper is free, so you can see exactly what you get before paying for another year.',
  },
  'kas-50': {
    key: 'DAILY_CHALLENGE',
    title: 'KAS-50 (Daily tests)',
    eyebrow: 'KAS-50 (Daily tests)',
    blurb:
      'One fifty-question paper a day for fifty days, with answers and explanations the moment you finish and your streak tracked throughout.',
  },
  'chapterwise': {
    key: 'CHAPTERWISE',
    title: 'KPSC KAS Prelims — Chapter-wise Practice',
    eyebrow: 'Chapter-wise Practice',
    blurb:
      'Work through the standard reference books chapter by chapter — Laxmikanth, Spectrum, NCERT, Shankar IAS and the Economic Survey — with a test for each chapter.',
  },
};

export function generateStaticParams() {
  return Object.keys(TRACKS).map((track) => ({ track }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ track: string }>;
}): Promise<Metadata> {
  const { track } = await params;
  const meta = TRACKS[track];

  if (!meta) return { title: 'Not found', robots: { index: false, follow: false } };
  return {
    title: meta.eyebrow,
    description: meta.blurb,
    alternates: { canonical: `/courses/${track}` },
  };
}

/** Renders the right action control for a scheduled test's state. */
function ScheduleAction({ row }: { row: ScheduleRow }) {
  switch (row.state) {
    case 'IN_PROGRESS':
      return (
        <Button asChild size="sm" className="w-full sm:w-32">
          <Link href={`/test/${row.attemptId}`}>
            <PlayCircle aria-hidden="true" />
            Resume
          </Link>
        </Button>
      );
    case 'COMPLETED':
      return (
        <Button asChild size="sm" variant="success" className="w-full sm:w-32">
          <Link href={`/test/${row.attemptId}/result`}>
            <CheckCircle2 aria-hidden="true" />
            Completed
          </Link>
        </Button>
      );
    case 'AVAILABLE':
      return (
        <Button asChild size="sm" variant="outline" className="w-full sm:w-32 border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive">
          <Link href={`/test/${row.id}`}>
            <PlayCircle aria-hidden="true" />
            Start
          </Link>
        </Button>
      );
    case 'LOCKED':
      return (
        <Button size="sm" variant="ghost" disabled className="w-full sm:w-32">
          <Lock aria-hidden="true" />
          Locked
        </Button>
      );
    default:
      return (
        <Button size="sm" variant="ghost" disabled className="w-full sm:w-32">
          <Lock aria-hidden="true" />
          Unlocks soon
        </Button>
      );
  }
}

/** Tracks with a schedule document behind the button. */
// Tracks with a published timetable document to open. The free series has
// none — its tests can be attempted on any day, in any order.
const HAS_TIMETABLE = new Set(['paid-test-series', 'kas-50']);

export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const { track } = await params;
  const meta = TRACKS[track];
  if (!meta) notFound();

  // Signed-in students see their own progress; visitors see the plain schedule.
  const user = await currentUser();
  const series = await getTrackSeries(meta.key, user?.id);

  const allRows = series.flatMap((s) => s.schedule);

  // What a student wants to know is how long one sitting takes, not the sum of
  // every test in the series. Where the series is uniform (it is, for both the
  // free and paid tracks) that is a single number.
  const durations = [...new Set(allRows.map((r) => r.durationMinutes))];
  const perTestMinutes = durations.length === 1 ? (durations[0] ?? null) : null;

  // The typical paper length, not a strict single value: one paper differing
  // by a question or two — because an item failed to parse, or was withdrawn —
  // should not turn a real figure into "Varies". Papers with nothing in them
  // are ignored so an unwritten one does not count as zero.
  const lengths = allRows.map((r) => r.totalQuestions).filter((n) => n > 0);
  const questionsPerTest =
    lengths.length === 0
      ? null
      : [...lengths].sort(
          (a, b) =>
            lengths.filter((n) => n === b).length - lengths.filter((n) => n === a).length,
        )[0]!;
  // Quote the live early-bird price, not the regular one, so the figure here
  // matches what checkout will charge.
  const first = series[0];
  const pricing = first ? await getSeriesPricing(first.id) : null;
  const price = pricing?.priceInPaise ?? first?.priceInPaise ?? 0;

  return (
    <>
      <PageHeader eyebrow={meta.eyebrow} title={meta.title} description={meta.blurb}>
        <div className="mt-8 flex flex-wrap gap-4">
          <div className="rounded-xl border border-border bg-card px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Total tests
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{allRows.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              Durations per test
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {perTestMinutes === null
                ? 'Varies'
                : perTestMinutes >= 60
                  ? `${perTestMinutes / 60} hours`
                  : `${perTestMinutes} minutes`}
            </p>
          </div>
          {questionsPerTest !== null && (
            <div className="rounded-xl border border-border bg-card px-5 py-3.5">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <BookOpen className="size-3.5" aria-hidden="true" />
                Questions per test
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">{questionsPerTest}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card px-5 py-3.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Price</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {price === 0 ? 'Free' : formatPaise(price)}
            </p>
            {pricing?.activeTier && (
              <p className="mt-0.5 text-xs font-medium text-primary">
                Only for the first {pricing.tierLimit} members
              </p>
            )}
          </div>
        </div>
      </PageHeader>

      {pricing && pricing.regularPriceInPaise > 0 && (
        <section className="container pt-10" aria-labelledby="offer-heading">
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-5">
            <h2 id="offer-heading" className="sr-only">
              Pricing and availability
            </h2>

            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              {pricing.ladder.map((rung) => (
                <div
                  key={rung.label}
                  className={`bg-card px-4 py-3.5 text-center ${
                    rung.active ? 'ring-1 ring-inset ring-primary' : ''
                  }`}
                >
                  <p className="text-xs text-muted-foreground">{rung.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {formatPaise(rung.priceInPaise)}
                  </p>
                  {rung.active && (
                    <Badge variant="success" size="sm" className="mt-1">
                      Current price
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                The offer is valid only for the number of members shown. Once a limit is crossed the
                next price applies automatically.
              </p>

              {!paymentsEnabled() ? (
                <Button size="lg" variant="brand" disabled>
                  Coming soon
                </Button>
              ) : !first ? null : user ? (
                <BuyButton
                  seriesSlug={first.slug}
                  label={`Proceed to pay — ${formatPaise(price)}`}
                  prefill={{ name: user.name, email: user.email }}
                />
              ) : (
                <Button asChild size="lg" variant="brand">
                  <Link href={`/login?next=/courses/${track}`}>Sign in to enrol</Link>
                </Button>
              )}
            </div>

            {/* Counted from real entitlements, so this cannot overstate demand. */}
            {pricing.activeTier && pricing.tierLimit !== null && (
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{pricing.enrolled}</span>
                  <span className="text-muted-foreground"> / {pricing.tierLimit} enrolled</span>
                </p>
                <div
                  className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={pricing.enrolled}
                  aria-valuemin={0}
                  aria-valuemax={pricing.tierLimit}
                  aria-label="Early bird seats taken"
                >
                  <div
                    className="h-full rounded-full bg-success"
                    style={{
                      width: `${Math.min(100, (pricing.enrolled / pricing.tierLimit) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-sm font-medium tabular-nums text-primary">
                  {pricing.seatsLeftInTier} left at {formatPaise(pricing.priceInPaise)}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Only where a published timetable exists to open. The free series has
          no schedule document — its tests can be attempted on any day, in any
          order — so the button led to a page repeating what is already in the
          table above it. */}
      {HAS_TIMETABLE.has(track) && (
        <section className="container pt-8">
          <Button asChild fullWidth size="lg" variant="brand">
            <Link href={`/courses/${track}/syllabus`}>
              <FileText aria-hidden="true" />
              View syllabus &amp; timetable
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </section>
      )}

      <section className="container py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/courses">
            <ArrowLeft aria-hidden="true" />
            All courses
          </Link>
        </Button>

        {series.map((s) => (
          <div key={s.id} className="mt-6">
            {s.schedule.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Schedule not published yet"
                description="Tests will appear here once the schedule is finalised."
                action={{ label: 'Browse other courses', href: '/courses' }}
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="bg-primary px-5 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-primary-foreground">
                    Test schedule
                  </h2>
                </div>

                {/* Column headings — desktop only; each row is self-describing on mobile. */}
                <div className="hidden items-center gap-4 border-b border-border bg-muted/40 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
                  <span className="w-10 shrink-0">No.</span>
                  <span className="w-28 shrink-0">Date</span>
                  <span className="flex-1">Subject / syllabus</span>
                  <span className="w-24 shrink-0 text-center">Duration</span>
                  <span className="w-32 shrink-0 text-center">Test / analysis</span>
                </div>

                <ol className="divide-y divide-border">
                  {s.schedule.map((row, index) => (
                    <li
                      key={row.id}
                      className={`flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4 ${
                        row.state === 'COMPLETED' ? 'bg-success/5' : ''
                      }`}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums sm:w-10 sm:rounded-lg">
                        {index + 1}
                      </span>

                      <span className="w-28 shrink-0 text-sm text-muted-foreground">
                        {row.startDate ? formatDate(row.startDate, 'short') : 'Anytime'}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium leading-tight">{row.title}</p>
                          {/* The paper's own subtitle, where the content team
                              has written one — not a label this page invents. */}
                          {row.description && (
                            <span className="rounded-full bg-primary-muted px-2 py-0.5 text-xs font-medium text-primary">
                              {row.description}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <BookOpen className="size-3" aria-hidden="true" />
                            {row.totalQuestions > 0
                              ? `${row.totalQuestions} questions`
                              : 'Questions being added'}
                          </span>
                          {row.maxAttempts > 0 && (
                            <span>
                              {row.attemptsUsed}/{row.maxAttempts} attempts used
                            </span>
                          )}
                        </p>
                      </div>

                      <span className="w-24 shrink-0 text-center text-sm font-medium tabular-nums">
                        {row.durationMinutes >= 60
                          ? `${row.durationMinutes / 60} hr`
                          : `${row.durationMinutes} min`}
                      </span>

                      {/* Two actions on every row: sit the paper, and read its
                          analysis. The synopsis control is always present so the
                          column reads consistently — disabled where the analysis
                          has not been written yet, rather than absent, which
                          would make it look as though only some papers have one. */}
                      <div className="flex shrink-0 flex-col gap-1.5 sm:w-32">
                        <ScheduleAction row={row} />

                        {row.hasSynopsis ? (
                          <Button asChild size="sm" variant="outline" className="w-full sm:w-32">
                            <Link href={`/synopsis/test/${row.id}`}>
                              <FileText aria-hidden="true" />
                              Synopsis
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled
                            className="w-full sm:w-32"
                            title="The analysis for this test has not been published yet"
                          >
                            <FileText aria-hidden="true" />
                            Synopsis soon
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="border-t border-border bg-muted/30 px-5 py-4">
                  <p className="text-sm font-medium">Important instructions</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {meta.key === 'FREE_SERIES'
                      ? 'Free tests can be attempted on any day, in any order.'
                      : 'Tests open at their scheduled session time.'}{' '}
                    Once started, a test must be completed in one sitting — the timer runs on our
                    servers and does not pause. You may attempt each test at most{' '}
                    {series[0]?.schedule[0]?.maxAttempts || 2} times.
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Legend mirrors the row states above. */}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Legend</span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <PlayCircle className="size-3.5 text-primary" aria-hidden="true" />
            Available now
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            Unlocks on schedule
          </span>
          <span className="flex items-center gap-1.5">
            <Timer className="size-3.5" aria-hidden="true" />
            Content being added
          </span>
        </div>

        {!user && (
          <div className="mt-8 rounded-xl border border-border bg-card p-6 text-center">
            <h2 className="font-semibold tracking-tight">Sign in to track your progress</h2>
            <p className="mx-auto mt-1.5 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
              Create a free account to attempt these tests and keep your scores, ranks and
              analysis in one place.
            </p>
            <Button asChild variant="brand" className="mt-4">
              <Link href={`/register?next=/courses/${track}`}>Create free account</Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
