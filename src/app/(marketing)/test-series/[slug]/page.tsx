import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Clock, FileQuestion, Lock, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TEST_CATEGORY_LABELS, type TestCategory } from '@/lib/enums';
import { formatDuration, formatPaise } from '@/lib/utils';
import { BuyButton } from '@/features/checkout/buy-button';
import { db } from '@/server/db';
import { countEnrolledMany, resolvePricing } from '@/server/services/pricing-service';
import { FreeSeriesSchedule } from '@/features/marketing/free-series-schedule';
import { getAllTestSeries, getTestSeriesBySlug } from '@/server/services/marketing-service';

/** The free series renders as a schedule; every other series keeps the pitch. */
/**
 * Series that render as a timetable rather than a pitch.
 *
 * Both are sold on a published schedule, so what a student wants from the page
 * is which paper falls on which date and what can be sat today — not a feature
 * list. The paid series showed the pitch and, because its papers are still
 * being written, an empty "What is included" beneath a "TESTS 0" summary.
 */
/**
 * What each paper in a series is planned to hold.
 *
 * Stated rather than inferred: the header used to take the most common length
 * among the written papers, so two of ten written — one of them edited to 26
 * questions — made the series advertise "26 questions per test". A series sold
 * on a fixed length should quote that length.
 */
const PLANNED_QUESTIONS: Record<string, number> = {
  'kas-prelims-free-test-series': 25,
  'kas-prelims-paid-test-series': 100,
};

/**
 * The published timetable behind "View Schedule", where a series has one.
 *
 * Points at the existing reader rather than the PDF itself: the reader renders
 * on a phone, which a raw PDF largely does not, and it is already where the
 * courses pages send people for the same document.
 */
const SCHEDULE_PAGES: Record<string, string> = {
  'kas-prelims-paid-test-series': '/courses/paid-test-series/syllabus',
};

const SCHEDULE_SERIES = new Set([
  'kas-prelims-free-test-series',
  'kas-prelims-paid-test-series',
]);

export async function generateStaticParams() {
  const series = await getAllTestSeries();
  return series.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const series = await getTestSeriesBySlug(slug);

  if (!series) return { title: 'Test series not found', robots: { index: false, follow: false } };

  return {
    title: series.seoTitle ?? series.name,
    description: series.seoDescription ?? series.tagline ?? undefined,
    alternates: { canonical: `/test-series/${series.slug}` },
  };
}

export default async function TestSeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const series = await getTestSeriesBySlug(slug);

  if (!series) notFound();

  if (SCHEDULE_SERIES.has(slug)) {
    // The live price, resolved from the early-bird ladder against real
    // enrolments — the same figure the pricing page and the buy button use.
    // Reading `priceInPaise` alone showed the standard price to everyone,
    // so the page quoted 299 while checkout charged 99.
    const row = await db.testSeries.findFirst({
      where: { slug, deletedAt: null },
      select: {
        id: true,
        priceInPaise: true,
        tier1PriceInPaise: true,
        tier1Limit: true,
        tier2PriceInPaise: true,
        tier2Limit: true,
      },
    });

    const enrolled = row ? await countEnrolledMany([row.id]) : null;
    const pricing = row ? resolvePricing(row, enrolled?.get(row.id) ?? 0) : null;
    const earlyBird = pricing?.ladder.find((rung) => rung.active && rung.limit !== null) ?? null;
    const standard = pricing?.ladder.find((rung) => rung.limit === null) ?? null;

    return (
      <FreeSeriesSchedule
        name={series.name}
        tagline={series.tagline}
        eyebrow={series.priceInPaise > 0 ? 'KAS Full Length Tests' : 'Free Test Series'}
        plannedQuestions={PLANNED_QUESTIONS[slug]}
        scheduleHref={SCHEDULE_PAGES[slug]}
        // Only while an early rung is genuinely open. Past that the price on
        // the page is the standard one, and there is no capped offer to report.
        enrolment={
          earlyBird?.limit != null
            ? { count: enrolled?.get(row!.id) ?? 0, limit: earlyBird.limit }
            : null
        }
        purchase={
          series.priceInPaise > 0 ? (
            <div className="w-full shrink-0 rounded-2xl border border-primary/30 bg-primary-muted/40 p-4 sm:w-56">
              <p className="text-3xl font-bold tabular-nums">
                {formatPaise(pricing?.priceInPaise ?? series.priceInPaise)}
              </p>

              {/* The later price, while an early-bird rung is genuinely open.
                  Saying what it becomes is the point of an early-bird offer;
                  quoting only today's figure hides the reason to act. */}
              {earlyBird && standard ? (
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  for the first {earlyBird.limit} members, then{' '}
                  <span className="font-semibold text-foreground">
                    {formatPaise(standard.priceInPaise)}
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  One-time payment · lifetime access
                </p>
              )}
              <BuyButton
                seriesSlug={series.slug}
                label="Proceed to pay"
                size="default"
                className="mt-2.5 w-full"
              />
            </div>
          ) : undefined
        }
        tests={series.tests.map((test) => ({
          id: test.id,
          slug: test.slug,
          title: test.title,
          durationMinutes: test.durationMinutes,
          totalQuestions: test.totalQuestions,
          startDate: test.startDate,
          synopsisFileName: test.synopsisFileName,
        }))}
      />
    );
  }

  const freeTests = series.tests.filter((test) => test.accessType === 'FREE');

  return (
    <>
      <section className="border-b border-border bg-muted/20">
        <div className="container grid gap-10 py-14 sm:py-16 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">{series.exam.shortName}</Badge>
              <Badge variant="muted">{series.difficulty.toLowerCase()}</Badge>
              {series.discountPercent > 0 && (
                <Badge variant="success">{series.discountPercent}% off</Badge>
              )}
            </div>

            <h1 className="mt-4 text-balance text-display-sm sm:text-display-md">{series.name}</h1>
            {series.tagline && (
              <p className="mt-3 text-pretty text-lg leading-relaxed text-muted-foreground">
                {series.tagline}
              </p>
            )}
            {series.description && (
              <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
                {series.description}
              </p>
            )}

            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tests</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{series.testCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Questions</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                  {series.totalQuestions}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Access</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                  {series.accessDurationDays === 0
                    ? 'Lifetime'
                    : `${series.accessDurationDays} days`}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Free tests</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{freeTests.length}</dd>
              </div>
            </dl>
          </div>

          {/* Purchase panel — sticky on desktop so the CTA follows the reader. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Card variant="elevated">
              <CardContent className="p-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">
                    {series.priceInPaise === 0 ? 'Free' : formatPaise(series.priceInPaise)}
                  </span>
                  {series.comparePriceInPaise > series.priceInPaise && (
                    <span className="text-base text-muted-foreground line-through">
                      {formatPaise(series.comparePriceInPaise)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  One-time payment · {series.accessDurationDays === 0 ? 'lifetime' : `${series.accessDurationDays} days`}{' '}
                  access
                </p>

                <Button asChild fullWidth size="lg" variant="brand" className="mt-5">
                  <Link href={`/register?next=/test-series/${series.slug}`}>Get this series</Link>
                </Button>

                {freeTests.length > 0 && (
                  <Button asChild fullWidth variant="outline" className="mt-3">
                    <Link href="/register">Try a free test first</Link>
                  </Button>
                )}

                <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                  Full refund within 7 days if you have attempted fewer than two tests.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <div className="container grid gap-12 py-14 sm:py-16 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-12">
          {/* Included tests */}
          <section>
            <h2 className="text-display-sm">What is included</h2>
            <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
              Every test in this series, in the order we recommend attempting them.
            </p>

            <div className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
              {series.tests.map((test) => (
                <div key={test.id} className="flex items-center gap-4 p-4 sm:p-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                    <FileQuestion className="size-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{test.title}</p>
                      {test.accessType === 'FREE' ? (
                        <Badge variant="success" size="sm">
                          Free
                        </Badge>
                      ) : (
                        <Badge variant="muted" size="sm">
                          <Lock aria-hidden="true" />
                          Included
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {TEST_CATEGORY_LABELS[test.category as TestCategory] ?? test.category} ·{' '}
                      {test.totalQuestions} questions · {test.totalMarks} marks
                    </p>
                  </div>

                  <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {formatDuration(test.durationMinutes * 60)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* FAQs */}
          {series.faqs.length > 0 && (
            <section>
              <h2 className="text-display-sm">Questions about this series</h2>
              <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
                {series.faqs.map((faq) => (
                  <details key={faq.id} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                      {faq.question}
                      <span
                        aria-hidden="true"
                        className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
                      {faq.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Features sidebar */}
        <aside>
          <Card>
            <CardContent className="p-6">
              <h2 className="font-semibold tracking-tight">Everything you get</h2>
              <ul className="mt-4 space-y-3">
                {series.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    <span className="leading-relaxed text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
