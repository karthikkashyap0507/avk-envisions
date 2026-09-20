import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  Lightbulb,
  Star,
  Target,
  Trophy,
  TrendingUp,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { db } from '@/server/db';
import { getCourseTracks, type TrackKey } from '@/server/services/catalogue-service';

export const metadata: Metadata = {
  title: 'Test series',
  description:
    'Previous year papers, free tests, the fifty-day challenge and full-length mocks — with detailed solutions and a performance report after every attempt.',
  alternates: { canonical: '/test-series' },
};

export const dynamic = 'force-dynamic';

/**
 * Presentation for each track, in the order they are offered.
 *
 * Copy and colour live here; whether a track is live, and what it costs, comes
 * from the catalogue — so a card cannot promise something the site does not
 * have. `key` ties a card to its track, and a track with no data simply does
 * not render.
 */
interface CardSpec {
  key: TrackKey;
  number: number;
  icon: typeof BookOpen;
  title: string;
  tagline: string;
  benefits: string[];
  cta: string;
  tint: string;
  accent: string;
  iconWash: string;
  button: string;
  chip: string;
}

const CARDS: CardSpec[] = [
  {
    key: 'PYQ',
    number: 1,
    icon: BookOpen,
    title: 'Previous Year Questions (PYQs)',
    tagline: 'Real KAS questions. Know the exam trend.',
    benefits: ['Year-wise PYQs', 'Subject-wise practice'],
    cta: 'Explore PYQs',
    tint: 'border-blue-200/70 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20',
    accent: 'bg-blue-600 text-white',
    iconWash: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    button: 'bg-blue-600 hover:bg-blue-700 text-white',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  {
    key: 'FREE_SERIES',
    number: 2,
    icon: CheckCircle2,
    title: 'Free Test Series',
    tagline: 'Test Yourself Before the Real Exam Tests You.',
    benefits: ['Exam-style practice', 'Realistic KAS question sets', 'Detailed solutions'],
    cta: 'Start Free Test',
    tint: 'border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20',
    accent: 'bg-emerald-600 text-white',
    iconWash: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  {
    key: 'DAILY_CHALLENGE',
    number: 3,
    icon: CalendarDays,
    title: 'KAS-50 (Daily tests)',
    tagline: '50 Days. 50 Tests. One Powerful Preparation Journey.',
    benefits: ['Daily practice', 'Build speed & accuracy', 'Track your progress'],
    cta: 'Start KAS50',
    tint: 'border-rose-200/70 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20',
    accent: 'bg-rose-500 text-white',
    iconWash: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    button: 'bg-rose-500 hover:bg-rose-600 text-white',
    chip: 'bg-rose-500 text-white',
  },
  {
    key: 'PAID_SERIES',
    number: 4,
    icon: Trophy,
    title: 'KAS Full Length Tests',
    tagline: '100 Questions. Real Exam Pattern.',
    benefits: ['All India ranking', 'Detailed analysis', 'Performance report'],
    cta: 'Explore Tests',
    tint: 'border-amber-200/70 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20',
    accent: 'bg-amber-500 text-white',
    iconWash: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  {
    key: 'CHAPTERWISE',
    number: 5,
    icon: BookOpen,
    title: 'Chapter-wise Practice',
    tagline: 'Strengthen every chapter, step by step.',
    benefits: ['Topic-wise tests', 'Detailed solutions', 'Concept clarity'],
    cta: 'Explore Chapter-wise',
    tint: 'border-violet-200/70 bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/20',
    accent: 'bg-violet-600 text-white',
    iconWash: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    button: 'bg-violet-600 hover:bg-violet-700 text-white',
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  },
];

const PROMISES = [
  { icon: Target, title: 'Exam', detail: 'Focused' },
  { icon: TrendingUp, title: 'Track Your', detail: 'Progress' },
  { icon: Lightbulb, title: 'Learn with', detail: 'Solutions' },
  { icon: Trophy, title: 'Get Closer', detail: 'to Your Goal' },
];

const FREE_SERIES_SLUG = 'kas-prelims-free-test-series';

export default async function TestSeriesPage() {
  const [tracks, freeSeries] = await Promise.all([
    getCourseTracks(),
    // The free card advertises its length, and that has to be the real one —
    // it read "20 questions per test" while the papers held fifty-one.
    db.testSeries.findFirst({
      where: { slug: FREE_SERIES_SLUG, deletedAt: null },
      select: {
        tests: {
          where: { deletedAt: null, status: 'PUBLISHED' },
          select: { totalQuestions: true, durationMinutes: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    }),
  ]);

  const byKey = new Map(tracks.map((track) => [track.key, track]));
  const sample = freeSeries?.tests[0];

  return (
    <div className="bg-gradient-to-b from-sky-50/70 to-transparent dark:from-sky-950/10">
      <div className="container max-w-4xl py-10 sm:py-14">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            KAS Prelims
          </p>
          <h1 className="mt-2 text-4xl font-extrabold uppercase tracking-tight text-primary sm:text-5xl">
            Test Series
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Practice Today. Perform Tomorrow.
          </p>

          <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
            {PROMISES.map((promise) => (
              <li key={promise.title} className="flex items-center gap-2.5">
                <promise.icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium leading-tight">
                  {promise.title}
                  <br />
                  <span className="text-muted-foreground">{promise.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </header>

        <ul className="mt-8 space-y-4">
          {CARDS.map((card) => {
            const track = byKey.get(card.key);
            if (!track) return null;

            const Icon = card.icon;
            // "Coming soon" is decided by the catalogue, not by this file: a
            // track with nothing behind it must not offer a button that leads
            // to an empty page.
            const soon = track.comingSoon;

            return (
              <li key={card.key}>
                <div className={cn('rounded-2xl border p-4 sm:p-5', card.tint)}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                    <div className="flex items-center gap-3 sm:flex-col sm:items-start">
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                          card.accent,
                        )}
                        aria-hidden="true"
                      >
                        {card.number}
                      </span>
                      <span
                        className={cn(
                          'flex size-14 shrink-0 items-center justify-center rounded-2xl sm:size-16',
                          card.iconWash,
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-7 sm:size-8" />
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h2 className="text-lg font-bold leading-tight tracking-tight sm:text-xl">
                          {card.title}
                        </h2>

                        {soon ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            <Clock className="size-3" aria-hidden="true" />
                            Coming Soon
                          </span>
                        ) : (
                          track.ribbon && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                card.chip,
                              )}
                            >
                              {track.ribbon.toLowerCase() === 'popular' ? (
                                <Flame className="size-3" aria-hidden="true" />
                              ) : (
                                <Star className="size-3" aria-hidden="true" />
                              )}
                              {track.ribbon}
                            </span>
                          )
                        )}
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">{card.tagline}</p>

                      {/* The free card states its real length, read from the paper itself. */}
                      {card.key === 'FREE_SERIES' && sample && sample.totalQuestions > 0 && (
                        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
                          <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                          {sample.totalQuestions} Questions • {sample.durationMinutes} Minutes
                        </p>
                      )}

                      <ul className="mt-2.5 space-y-1.5">
                        {card.benefits.map((benefit) => (
                          <li key={benefit} className="flex items-center gap-2 text-sm">
                            <CheckCircle2
                              className="size-4 shrink-0 text-success"
                              aria-hidden="true"
                            />
                            {benefit}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="shrink-0">
                      {soon ? (
                        <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted px-5 py-2.5 text-sm font-semibold text-muted-foreground">
                          <Clock className="size-4" aria-hidden="true" />
                          Coming Soon
                        </span>
                      ) : (
                        <Link
                          href={track.href}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            card.button,
                          )}
                        >
                          {card.cta}
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-center text-sm font-medium italic text-muted-foreground">
          Consistent practice builds big results.
        </p>
      </div>
    </div>
  );
}
