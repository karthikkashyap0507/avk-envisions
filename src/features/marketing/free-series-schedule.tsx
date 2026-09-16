import * as React from 'react';
import Link from 'next/link';
import { BookOpen, Clock, FileText, Info, Lock, Play } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EnrolmentBar } from '@/features/marketing/enrolment-bar';

/**
 * The free series as a timetable rather than a sales page.
 *
 * Every test is listed, open or not. The series is a published plan — a
 * student is meant to see the whole run before the later papers exist — so a
 * row that is not ready says so rather than being hidden, and each row carries
 * its own state instead of the page hiding what it cannot yet offer.
 */

export interface ScheduleTest {
  id: string;
  slug: string;
  title: string;
  durationMinutes: number;
  totalQuestions: number;
  startDate: Date | null;
  synopsisFileName: string | null;
}

interface Props {
  name: string;
  tagline: string | null;
  tests: ScheduleTest[];
  /** The line above the title — the series' own kind, not always "Free". */
  eyebrow?: string;
  /**
   * What each paper is planned to hold, where the series has a fixed length.
   *
   * The header used to infer this from the written papers, which drifts: with
   * two of ten written and one of them edited to 26, the series advertised
   * "26 questions per test". A series with a stated length should say it.
   */
  plannedQuestions?: number;
  /**
   * The purchase panel, for a series that is sold.
   *
   * Passed in rather than resolved here: this component knows about a
   * timetable, and the free series has nothing to buy.
   */
  purchase?: React.ReactNode;
  /**
   * Where the published timetable PDF is read, for a series that has one.
   *
   * The table below lists the papers, but the document is what the schedule
   * was actually planned and announced as — subjects, dates and the run-up in
   * one page — and someone deciding whether to buy wants to see the whole plan
   * before the later papers exist.
   */
  scheduleHref?: string;
  /**
   * How many have joined, where the series is sold on a limited early price.
   *
   * Shown because the early rung is genuinely capped: a student who cannot see
   * how many seats remain has no way to judge whether the price they are
   * looking at will still be there tomorrow.
   */
  enrolment?: { count: number; limit: number } | null;
}

/**
 * A paper's date, as "14 Sep 2026".
 *
 * Pinned to IST and to en-IN rather than the viewer's locale: the timetable is
 * published for one exam in one country, and a date that renders differently
 * on the server and in the browser would fail hydration.
 */
function formatTestDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

/** Open when it has questions and either no date or a date already past. */
function isOpen(test: ScheduleTest): boolean {
  if (test.totalQuestions === 0) return false;
  return test.startDate === null || test.startDate <= new Date();
}

export function FreeSeriesSchedule({
  name,
  tagline,
  tests,
  eyebrow,
  plannedQuestions,
  purchase,
  scheduleHref,
  enrolment,
}: Props) {
  // The planned length where the series states one, and otherwise the most
  // common written length. Inferring it alone drifted: with two papers of ten
  // written, one edited to 26 questions, the header announced 26 per test.
  const written = tests.map((t) => t.totalQuestions).filter((n) => n > 0);
  const commonest =
    plannedQuestions ??
    (written.length
      ? [...written].sort(
          (a, b) =>
            written.filter((n) => n === b).length - written.filter((n) => n === a).length || b - a,
        )[0]
      : null);

  // Likewise the duration: a single edited paper should not make ten tests
  // read as "varies".
  const durationCounts = tests.map((t) => t.durationMinutes);
  const durations = [...new Set(durationCounts)].sort(
    (a, b) => durationCounts.filter((n) => n === b).length - durationCounts.filter((n) => n === a).length,
  );

  return (
    <div className="container max-w-5xl py-8 sm:py-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {eyebrow ?? 'Free Test Series'}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
            {tagline && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {tagline}
              </p>
            )}
          </div>

          {purchase ?? (
            <p className="hidden shrink-0 rounded-2xl bg-primary-muted/60 px-5 py-4 text-center text-sm font-semibold italic leading-snug sm:block">
              Practice Today
              <br />
              Perform Tomorrow
            </p>
          )}
        </div>

        {/* The published timetable, and how full the early price is. Both sit
            above the table because both are read before deciding to buy. */}
        {(scheduleHref || enrolment) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {scheduleHref && (
              <Link
                href={scheduleHref}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="size-4" aria-hidden="true" />
                View Schedule
              </Link>
            )}

            {enrolment && <EnrolmentBar count={enrolment.count} limit={enrolment.limit} />}
          </div>
        )}

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat icon={FileText} label="Total tests" value={String(tests.length)} />
          <Stat
            icon={BookOpen}
            label="Questions per test"
            value={commonest === null ? '—' : String(commonest)}
          />
          <Stat
            icon={Clock}
            label="Duration per test"
            value={durations[0] !== undefined ? `${durations[0]} minutes` : '—'}
          />
        </dl>
      </header>

      <section className="mt-7 overflow-hidden rounded-2xl border border-border">
        <h2 className="bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-wide text-primary-foreground">
          Test schedule
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="w-14 px-4 py-2.5 font-medium">No.</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Test</th>
                <th scope="col" className="w-32 px-3 py-2.5 font-medium">Date</th>
                <th scope="col" className="w-28 px-3 py-2.5 font-medium">Duration</th>
                <th scope="col" className="w-44 px-3 py-2.5 font-medium">Action</th>
              </tr>
            </thead>

            <tbody>
              {tests.map((test, index) => {
                const open = isOpen(test);

                return (
                  <tr
                    key={test.id}
                    className={cn(
                      'border-b border-border last:border-0',
                      !open && 'bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                          open ? 'bg-primary-muted text-primary' : 'bg-muted',
                        )}
                      >
                        {index + 1}
                      </span>
                    </td>

                    <td className="px-3 py-3.5">
                      <p className={cn('font-semibold leading-tight', open && 'text-foreground')}>
                        {test.title}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookOpen className="size-3.5" aria-hidden="true" />
                        {test.totalQuestions > 0
                          ? `${test.totalQuestions} questions`
                          : 'Questions being added'}
                      </p>
                    </td>

                    {/* The date the paper opens. A series sold on a published
                        timetable is bought for its dates as much as its
                        subjects, and they were carried into this component all
                        along without ever being shown. */}
                    <td className="px-3 py-3.5 text-sm">
                      {test.startDate ? (
                        <span className={cn('tabular-nums', open && 'text-foreground')}>
                          {formatTestDate(test.startDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Any day</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-sm tabular-nums">
                      {test.durationMinutes} min
                    </td>

                    <td className="px-3 py-3.5">
                      {open ? (
                        <div className="flex flex-col gap-1.5">
                          <Link
                            href={`/start/${test.id}`}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Play className="size-3.5" aria-hidden="true" />
                            Start
                          </Link>

                          {test.synopsisFileName && (
                            <Link
                              href={`/synopsis/test/${test.id}`}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <FileText className="size-3.5" aria-hidden="true" />
                              Synopsis
                            </Link>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Lock className="size-3.5" aria-hidden="true" />
                          Unlocks soon
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-5 flex items-start gap-3 rounded-2xl border border-border bg-primary-muted/30 p-4 text-sm sm:p-5">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold">Important instructions</span>
          <br />
          <span className="text-muted-foreground">
            Free tests can be attempted on any day, in any order. Once started, a test must be
            completed in one sitting — the timer runs on our servers and does not pause. You may
            attempt each test at most 2 times.
          </span>
        </span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <span className="font-semibold uppercase tracking-wide">Legend</span>
        <span className="flex items-center gap-1.5">
          <Play className="size-3.5 text-primary" aria-hidden="true" />
          Active test
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden="true" />
          Locked (will be available as per schedule)
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="size-3.5" aria-hidden="true" />
          Synopsis available
        </span>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary"
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="text-lg font-bold leading-tight tabular-nums">{value}</dd>
      </div>
    </div>
  );
}
