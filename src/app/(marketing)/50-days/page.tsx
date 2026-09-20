import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Target,
  Trophy,
} from 'lucide-react';

import { EmptyState } from '@/components/ui/states';
import { KAS_50_DAYS } from '@/lib/data/kas-50-days-schedule';
import { EnrolmentBar } from '@/features/marketing/enrolment-bar';
import { BuyButton } from '@/features/checkout/buy-button';
import {
  DAILY_CHALLENGE_SLUG,
  KAS_PRELIMS_DATE,
  KAS_REVISION_FROM,
  KAS_REVISION_TO,
} from '@/lib/enums';
import { cn, formatDate, formatPaise } from '@/lib/utils';
import { getSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { getChallenge, type ChallengeDay } from '@/server/services/daily-challenge-service';
import { hasEntitlement } from '@/server/services/entitlement-service';
import { countEnrolledMany, resolvePricing } from '@/server/services/pricing-service';

/**
 * The enrolment figure shown on the KAS-50 badge.
 *
 * A FIXED number, not a live count, set by hand on 2026-09-16. It does not
 * move when someone joins and it does not read the database.
 *
 * Deliberately kept out of `resolvePricing`: the ladder must keep resolving
 * against the real `enrolledCount`, or the page would quote one price while
 * checkout charged another. This constant only ever reaches the badge.
 *
 * Update it by editing this line, and if it stops resembling the real
 * enrolment, delete it and pass the live count instead.
 */
const KAS_50_SHOWN_ENROLMENT = { count: 34, limit: 50 } as const;

export const metadata: Metadata = {
  title: 'KAS-50 (Daily tests)',
  description:
    'A fifty-day KAS Prelims schedule: one paper a day, subject by subject, with answers and a synopsis after each test.',
};

export const dynamic = 'force-dynamic';

/** What each day's paper is planned to hold — the "50 Questions" in the name. */
const QUESTIONS_PER_DAY = 50;

/** Colour per subject block, cycled so a new subject still reads as a group. */
const BAND_TINTS = [
  'bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200',
  'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  'bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-200',
  'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  'bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
];

/** Days in order, split into the consecutive runs that share a subject. */
function groupBySubject(days: ChallengeDay[]) {
  const bands: { key: string; heading: string; days: ChallengeDay[] }[] = [];

  for (const day of days) {
    // Days 37-50 span several subjects. They still carry one in the database
    // because the schema requires it, so reading it back printed headings like
    // "PAPER 2 – INDIAN POLITY" over the full-paper days. The published
    // schedule names these sections instead, and the day number is what
    // decides which — the same rule the timetable is written to.
    const band = KAS_50_DAYS.find((d) => d.day === day.dayNumber)?.band ?? null;

    const heading = (
      band
        ? [day.paperNumber ? `Paper ${day.paperNumber}` : null, band]
        : [day.paperNumber ? `Paper ${day.paperNumber}` : null, day.subject]
    )
      .filter(Boolean)
      .join(' – ')
      .toUpperCase();

    const last = bands[bands.length - 1];
    // A run ends when the heading changes, so the same subject appearing again
    // later in the schedule forms its own band rather than being merged into
    // the earlier one and losing its place in the calendar.
    if (last && last.heading === heading) {
      last.days.push(day);
    } else {
      bands.push({ key: `${heading}-${day.dayNumber}`, heading: heading || 'SCHEDULE', days: [day] });
    }
  }

  return bands;
}

export default async function FiftyDaysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [session, query] = await Promise.all([getSession(), searchParams]);
  const challenge = await getChallenge(session?.user.id ?? null);

  if (!challenge || !challenge.isPublished) {
    return (
      <div className="container py-16">
        <EmptyState
          icon={CalendarDays}
          title="KAS-50 (Daily tests) is on its way"
          description="The schedule has not opened yet. Check back shortly."
          action={{ label: 'Browse the test series', href: '/test-series' }}
        />
      </div>
    );
  }

  const paperFilter = query.paper === '1' || query.paper === '2' ? Number(query.paper) : null;
  const shown = paperFilter
    ? challenge.days.filter((day) => day.paperNumber === paperFilter)
    : challenge.days;

  const paper1 = challenge.days.filter((d) => d.paperNumber === 1).length;
  const paper2 = challenge.days.filter((d) => d.paperNumber === 2).length;

  // The series is paid, and until now the only way to buy it was from the
  // pricing page — someone reading the timetable had no way to join from it.
  const series = await db.testSeries.findFirst({
    where: { slug: DAILY_CHALLENGE_SLUG, deletedAt: null },
    select: {
      id: true,
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });

  const enrolled = series ? await countEnrolledMany([series.id]) : null;
  const enrolledCount = series ? (enrolled?.get(series.id) ?? 0) : 0;
  const pricing = series ? resolvePricing(series, enrolledCount) : null;

  // The capped rung, while one is genuinely open. Past it the price on the
  // page is the standard one and there are no early places left to report.
  const earlyRung = pricing?.ladder.find((rung) => rung.active && rung.limit !== null) ?? null;
  const owned = Boolean(
    session?.user && series && (await hasEntitlement(session.user.id, series.id)),
  );

  const dated = challenge.days.filter((d) => d.opensAt !== null);
  const firstDay = dated[0]?.opensAt ?? null;
  const lastDay = dated[dated.length - 1]?.opensAt ?? null;
  const totalQuestions = challenge.days.reduce((sum, d) => sum + d.questionCount, 0);

  // What the series is: fifty papers of fifty questions. Summing the questions
  // actually attached reported 0 while those papers are still being written,
  // so the page advertising "50 Questions × 50 Days" said it had none. The
  // written count is used once it exceeds the plan, so this can never
  // understate a series that has grown.
  const plannedQuestions = Math.max(totalQuestions, challenge.days.length * QUESTIONS_PER_DAY);

  const bands = groupBySubject(shown);

  const TABS: { label: string; href: string; active: boolean }[] = [
    {
      label: `All Tests (${challenge.days.length})`,
      href: '/50-days',
      active: paperFilter === null,
    },
    ...(paper1 > 0
      ? [{ label: `Paper 1 (${paper1})`, href: '/50-days?paper=1', active: paperFilter === 1 }]
      : []),
    ...(paper2 > 0
      ? [{ label: `Paper 2 (${paper2})`, href: '/50-days?paper=2', active: paperFilter === 2 }]
      : []),
  ];

  return (
    <div className="container max-w-7xl py-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            KAS-50 (Daily tests)
          </p>
          <h1 className="mt-2 text-3xl font-extrabold uppercase tracking-tight sm:text-4xl">
            KAS-50 (Daily tests)
          </h1>

          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {firstDay && lastDay && (
              <div className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-primary" aria-hidden="true" />
                {formatDate(firstDay)} → {formatDate(lastDay)}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              {challenge.days.length} Days • {plannedQuestions.toLocaleString('en-IN')} Questions
            </div>

            {/* What happens after day 50. The schedule does not end with the
                last paper — a student planning around it needs the revision
                window and the exam date, which are fixed dates rather than
                anything derived from the papers. */}
            <div className="flex items-center gap-1.5">
              <Trophy className="size-4 text-primary" aria-hidden="true" />
              {/* Parsed as UTC to match how the day papers are stored. Local
                  midnight would render a day early for any viewer east of
                  Greenwich, which is every student here. */}
              Final Revision: {formatDate(new Date(`${KAS_REVISION_FROM}T00:00:00Z`))} →{' '}
              {formatDate(new Date(`${KAS_REVISION_TO}T00:00:00Z`))} • Prelims:{' '}
              {formatDate(new Date(`${KAS_PRELIMS_DATE}T00:00:00Z`))}
            </div>

            {/* Progress is shown once there is any: a line reading "0 finished
                • streak 0" tells a student nothing they did not know and reads
                as a scoreboard of their failure to start. */}
            {session && challenge.completedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Target className="size-4 text-primary" aria-hidden="true" />
                {challenge.completedCount} finished • streak {challenge.currentStreak}
              </div>
            )}
          </dl>
        </div>

        <div className="flex flex-col items-start gap-3">
          {/* Outside the day list on purpose: the plan is what someone wants to
              read before any paper is published, which is exactly when the
              table below has nothing in it. Opens in the reader rather than
              downloading, like every other document here. */}
          <Link
            href="/50-days/syllabus"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="size-4" aria-hidden="true" />
            View Complete Timetable
          </Link>

          {/* Joining from the timetable itself. Someone reading the plan is
              exactly the person deciding whether to buy, and until now the
              only way in was the pricing page. */}
          {pricing && !owned && pricing.priceInPaise > 0 && (
            <div className="w-full rounded-xl border border-primary/30 bg-primary-muted/40 p-4">
              <p className="text-2xl font-bold tabular-nums">
                {formatPaise(pricing.priceInPaise)}
              </p>
              {earlyRung?.limit != null && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  for the first {earlyRung.limit} members
                </p>
              )}
              <BuyButton
                seriesSlug={DAILY_CHALLENGE_SLUG}
                label="Proceed to pay"
                size="default"
                className="mt-2.5 w-full"
              />
            </div>
          )}

          {owned && (
            <p className="w-full rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium">
              You have joined KAS-50 (Daily tests).
            </p>
          )}

          {/* How full the early price is, the same bar the paid series shows.
              Outside the purchase panel so it stays visible to someone who has
              already joined.

              Unlike the paid series, which reads its live enrolment, this one
              shows the fixed KAS_50_SHOWN_ENROLMENT figure. */}
          <EnrolmentBar
            count={KAS_50_SHOWN_ENROLMENT.count}
            limit={KAS_50_SHOWN_ENROLMENT.limit}
            className="w-full max-w-none sm:max-w-none"
          />

          <p className="rounded-xl bg-primary-muted/60 px-4 py-3 text-sm font-semibold leading-snug">
          <Trophy className="mb-1 size-5 text-primary" aria-hidden="true" />
          <br />
          Stay consistent.
          <br />
          Practice daily.
          <br />
          Crack KAS.
          </p>
        </div>
      </header>

      {challenge.days.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={CalendarDays}
            title="The first paper is being prepared"
            description="Days appear here as they are published. Nothing to attempt just yet."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                  tab.active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {/* Wide table, so it scrolls inside its own box rather than pushing
              the page sideways on a phone. */}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th scope="col" className="px-4 py-3 font-semibold">Day</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Paper</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Subject</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Key Focus</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Relevant Topics</th>
                  <th scope="col" className="px-4 py-3 text-center font-semibold">Actions</th>
                </tr>
              </thead>

              <tbody>
                {bands.map((band, bandIndex) => (
                  // Fragment needs the key, not the first row inside it —
                  // otherwise React reconciles the band rows by position and
                  // warns about a missing key on the list.
                  <React.Fragment key={band.key}>
                    <tr className={BAND_TINTS[bandIndex % BAND_TINTS.length]}>
                      <th scope="colgroup" colSpan={6} className="px-4 py-2.5 text-left font-bold">
                        {band.heading}
                      </th>
                      <td className="px-4 py-2.5 text-center">
                        <span className="rounded-full bg-background/70 px-2.5 py-0.5 text-xs font-semibold">
                          {band.days.length} {band.days.length === 1 ? 'Test' : 'Tests'}
                        </span>
                      </td>
                    </tr>

                    {band.days.map((day) => (
                      <tr key={day.testId} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-semibold tabular-nums">{day.dayNumber}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {day.opensAt ? formatDate(day.opensAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {day.paperNumber ? `Paper ${day.paperNumber}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{day.subject ?? '—'}</td>
                        <td className="px-4 py-3 font-medium">{day.title}</td>
                        <td className="max-w-sm px-4 py-3 text-muted-foreground">
                          {day.topics ?? '—'}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            {day.isAvailable ? (
                              <>
                                {/* Sitting the paper comes first while the
                                    student may still sit it. These are set to
                                    unlimited attempts, and offering only
                                    "Result" after one go meant an unlimited
                                    paper could never be retaken from here. */}
                                {day.canRetake && (
                                  <Link
                                    href={`/start/${day.testId}`}
                                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                  >
                                    {day.attempt ? 'Retake' : 'Take Test'}
                                  </Link>
                                )}

                                {/* Keyed on the attempt, not the paper. The
                                    result page resolves an attempt id, so
                                    passing the test id here 404'd. */}
                                {day.attempt && (
                                  <Link
                                    href={`/test/${day.attempt.id}/result`}
                                    className={
                                      day.canRetake
                                        ? 'inline-flex items-center gap-1 rounded-lg border border-primary/40 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-muted/50'
                                        : 'inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90'
                                    }
                                  >
                                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                    Result
                                  </Link>
                                )}
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                                <Lock className="size-3.5" aria-hidden="true" />
                                {day.opensAt && day.opensAt > new Date() ? 'Locked' : 'Soon'}
                              </span>
                            )}

                            {/* The synopsis is gated on finishing the paper, so
                                it is offered only where one exists. */}
                            {day.hasSynopsis ? (
                              <Link
                                href={`/synopsis/test/${day.testId}`}
                                className="inline-flex items-center rounded-lg border border-primary/40 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-muted/50"
                              >
                                Synopsis
                              </Link>
                            ) : (
                              <span className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-4" aria-hidden="true" />
            Showing {shown.length} of {challenge.days.length} tests.
          </p>
        </>
      )}
    </div>
  );
}
