import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  LineChart,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
} from 'lucide-react';

import { FeedbackWidget } from '@/components/site/feedback-widget';
import { TrackCards } from '@/components/site/track-cards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDuration } from '@/lib/utils';
import { FdaSdaBanner } from '@/features/marketing/fda-sda-banner';
import {
  getCourseTracks,
  getFdaSdaSummary,
  getPyqPaper,
} from '@/server/services/catalogue-service';
import { getFaqs, getTestimonials } from '@/server/services/marketing-service';

export const metadata: Metadata = {
  title: 'Prepare Smarter. Perform Better. Achieve More.',
  description:
    'Full-length mock tests, sectional practice and a question bank that adapts to you — with analytics that show exactly which topics to fix next.',
  alternates: { canonical: '/' },
};

/**
 * Homepage.
 *
 * Every section reads from the database so the content team can change it
 * without a deploy. Sections whose data has not been populated yet are omitted
 * entirely rather than rendering an empty shell.
 */
/** The previous-year paper offered free, so visitors can try a real paper first. */
const FREE_PAPER_SLUG = 'kas-pyq-2011';

export default async function HomePage() {
  const [tracks, testimonials, faqs, freePaper, fdaSda] = await Promise.all([
    getCourseTracks(),
    getTestimonials(3),
    getFaqs(undefined, 6),
    // The free sample paper. Null if it has not been seeded.
    getPyqPaper(FREE_PAPER_SLUG),
    // Null until the series is published.
    getFdaSdaSummary(),
  ]);

  return (
    <>
      <Hero />
      {fdaSda && <FdaSdaBanner summary={fdaSda} />}
      <FreePaperCta paper={freePaper} />
      <TrackChooser tracks={tracks} />
      <WhyAvk />
      {testimonials.length > 0 && <Testimonials testimonials={testimonials} />}
      {faqs.length > 0 && <Faqs faqs={faqs} />}
      <FinalCta />
      {/*
        Home page only. It used to be mounted in the marketing and app layouts,
        which put it on every page including the middle of a test — asking for
        an opinion while someone is being timed.
      */}
      <FeedbackWidget />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Promotes the free previous-year paper.
 *
 * Renders nothing unless the paper is actually seeded, genuinely free and has
 * questions loaded — an advert for a test that 404s or asks for payment is
 * worse than no advert at all.
 */
function FreePaperCta({ paper }: { paper: Awaited<ReturnType<typeof getPyqPaper>> }) {
  if (!paper || paper.priceInPaise !== 0) return null;

  const test = paper.fullLength.find((t) => t.isReady);
  if (!test) return null;

  const label = paper.sessionLabel ? `${paper.sessionLabel} ${paper.examYear}` : `${paper.examYear}`;

  return (
    <section className="border-y border-border bg-primary/5" aria-labelledby="free-paper-heading">
      <div className="container flex flex-col gap-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:py-10">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="size-6" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Free</Badge>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                No payment required
              </span>
            </div>
            <h2 id="free-paper-heading" className="mt-1.5 text-balance text-xl font-semibold tracking-tight">
              Attempt the {label} KAS Prelims paper free
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ClipboardList className="size-4" aria-hidden="true" />
                {test.totalQuestions} questions
              </span>
              <span className="flex items-center gap-1.5">
                <Timer className="size-4" aria-hidden="true" />
                {formatDuration(test.durationMinutes * 60)}
              </span>
              <span>Real exam timing and marking</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Button asChild size="lg" variant="brand">
            <Link href={`/test/${test.id}`}>
              Start free test
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/pyq/${paper.slug}`}>View paper</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden bg-mesh-hero">
      {/* Decorative grid; hidden from assistive tech. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:56px_56px] opacity-40" />
      </div>

      <div className="container relative py-14 sm:py-16 lg:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            KPSC KAS Exam Preparation Platform
          </p>

          <h1 className="mt-4 text-balance text-display-md sm:text-display-lg">
            Prepare Smarter.
            <br />
            <span className="text-primary">Perform Better.</span>
            <br />
            Achieve More.
          </h1>

          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground">
            AVK Envisions provides high-quality study resources, chapterwise practice, full-length
            tests and previous year papers — with detailed analytics to help you focus on what
            matters.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="xl" variant="brand" className="w-full sm:w-auto">
              <Link href="/test-series">
                Explore Test Series
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline" className="w-full sm:w-auto">
              <Link href="/register">Start Practising Free</Link>
            </Button>
          </div>

          <ul className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {['No credit card required', 'Free mock tests included', 'Cancel anytime'].map(
              (item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  {item}
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      )}
      <h2 className="mt-2.5 text-balance text-display-sm sm:text-display-md">{title}</h2>
      {description && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
const WHY_POINTS = [
  {
    icon: Target,
    title: 'Weak topics, identified honestly',
    body: 'A topic is only flagged once you have attempted enough questions for the signal to mean something — never after a single mistake.',
  },
  {
    icon: Timer,
    title: 'A test engine that does not lose work',
    body: 'Answers autosave continuously and the timer is server-authoritative, so a refresh, a dropped connection or a closed tab costs you nothing.',
  },
  {
    icon: LineChart,
    title: 'Analytics you can act on',
    body: 'Score, accuracy, speed and percentile tracked over time — with a clear next step, not twelve charts and no conclusion.',
  },
  {
    icon: BookOpenCheck,
    title: 'A question bank that is actually reviewed',
    body: 'Every question passes human review before publication, and reported questions are triaged and fixed.',
  },
  {
    icon: Gauge,
    title: 'Practice tuned to your level',
    body: 'Adaptive practice pulls from your weak topics and previous mistakes instead of serving the same easy questions again.',
  },
  {
    icon: ShieldCheck,
    title: 'Fair, exam-like conditions',
    body: 'Randomised questions and options, a real countdown and integrity checks that keep the leaderboard meaningful.',
  },
] as const;

function WhyAvk() {
  return (
    <section className="container py-20 sm:py-24">
      <SectionHeading
        eyebrow="Why AVK Envisions"
        title="Built by people who take preparation seriously"
        description="No inflated claims, no vanity metrics. Just the things that genuinely move a score."
      />

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {WHY_POINTS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-border bg-card p-6 shadow-card">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-muted text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 font-semibold leading-tight tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
function Testimonials({ testimonials }: { testimonials: Awaited<ReturnType<typeof getTestimonials>> }) {
  return (
    <section className="container py-20 sm:py-24">
      <SectionHeading eyebrow="What students say" title="Feedback from the people using it daily" />

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {testimonials.map((testimonial) => (
          <Card key={testimonial.id} className="h-full">
            <CardContent className="flex h-full flex-col p-6">
              <blockquote className="flex-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                “{testimonial.quote}”
              </blockquote>
              <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary-muted text-xs font-semibold text-primary">
                  {testimonial.studentName.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-semibold">{testimonial.studentName}</p>
                  <p className="text-xs text-muted-foreground">
                    {[testimonial.examName, testimonial.city].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Faqs({ faqs }: { faqs: Awaited<ReturnType<typeof getFaqs>> }) {
  return (
    <section className="border-t border-border bg-muted/20 py-20 sm:py-24">
      <div className="container">
        <SectionHeading eyebrow="FAQ" title="Questions students ask before starting" />

        {/* Native <details> keeps this fully accessible and zero-JS. */}
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border rounded-xl border border-border bg-card">
          {faqs.map((faq) => (
            <details key={faq.id} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium [&::-webkit-details-marker]:hidden">
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

        <div className="mt-8 text-center">
          <Button asChild variant="ghost">
            <Link href="/faq">
              See all questions
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function FinalCta() {
  return (
    <section className="container py-20 sm:py-24">
      <div className="relative overflow-hidden rounded-2xl bg-brand-gradient px-6 py-16 text-center sm:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,255,255,0.18),transparent)]"
        />

        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance text-display-sm text-primary-foreground sm:text-display-md">
            One more test. One step closer.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-primary-foreground/85">
            Create a free account, attempt a mock test, and see your first performance report in
            under an hour.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="xl" variant="secondary" className="w-full sm:w-auto">
              <Link href="/register">
                Create your free account
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="w-full text-primary-foreground hover:bg-white/10 hover:text-primary-foreground sm:w-auto"
            >
              <Link href="/test-series">Browse test series</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The four course tracks, sitting directly under the hero.
 *
 * Placed above every other section because choosing a track is the first real
 * decision a visitor makes; everything below it is supporting evidence.
 */
function TrackChooser({ tracks }: { tracks: Awaited<ReturnType<typeof getCourseTracks>> }) {
  return (
    <section className="container py-16 sm:py-20" aria-labelledby="courses-heading">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          KPSC KAS Courses
        </p>
        <h2 id="courses-heading" className="mt-2 text-balance text-display-sm">
          Choose the right path for your preparation
        </h2>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
          Start free to find your level, then move to daily practice, chapter-wise drills,
          full-length tests and previous year papers as your preparation sharpens.
        </p>
      </div>

      <div className="mt-8">
        <TrackCards tracks={tracks} />
      </div>
    </section>
  );
}
