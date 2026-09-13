import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  Clock,
  Flame,
  Gauge,
  PlayCircle,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { TEST_CATEGORY_LABELS, type TestCategory } from '@/lib/enums';
import { formatDate, formatDuration, formatNumber, formatPaise, ordinal } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import {
  buildRecommendations,
  getDashboardSummary,
  getRecommendedTests,
  getResumableAttempt,
  getSubjectBreakdown,
  getTopicInsights,
  getUpcomingTests,
} from '@/server/services/dashboard-service';
import { db } from '@/server/db';
import { getAvailableCourses, getPurchasedCourses } from '@/server/services/purchased-service';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

/** Time-of-day greeting — small touch, makes the product feel attended to. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage() {
  const user = await enforceStudent();

  const [
    summary,
    resumable,
    insights,
    subjects,
    recommended,
    upcoming,
    incorrectCount,
    purchased,
    available,
  ] =
    await Promise.all([
      getDashboardSummary(user.id),
      getResumableAttempt(user.id),
      getTopicInsights(user.id),
      getSubjectBreakdown(user.id),
      getRecommendedTests(user.id),
      getUpcomingTests(),
      db.testAnswer.count({ where: { attempt: { userId: user.id }, isCorrect: false } }),
      getPurchasedCourses(user.id),
      getAvailableCourses(user.id),
    ]);

  const isNewStudent = summary.testsAttempted === 0;

  const recommendations = buildRecommendations({
    testsAttempted: summary.testsAttempted,
    weakTopics: insights.weak,
    incorrectCount,
    resumable: Boolean(resumable),
  });

  const firstName = user.name.split(' ')[0] ?? user.name;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Greeting -------------------------------------------------------- */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isNewStudent
            ? 'Let’s establish your baseline — one full-length test is all it takes.'
            : summary.currentStreak > 1
              ? `You’re on a ${summary.currentStreak}-day streak. Consistency is doing the work.`
              : 'Ready for your next challenge?'}
        </p>
      </header>

      {/* What they have bought ------------------------------------------- */}
      {purchased.length > 0 && (
        <section aria-labelledby="purchased-heading">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 id="purchased-heading" className="font-semibold tracking-tight">
                Courses purchased by you
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {purchased.length === 1
                  ? 'Open it and start taking tests.'
                  : 'Open any of these and start taking tests.'}
              </p>

              <ol className="mt-4 space-y-2">
                {purchased.map((course, index) => (
                  <li key={course.id}>
                    {/* Carries the brand colour, matching the cards below it.
                        These are the courses a student has already paid for —
                        the things they came to the dashboard to open — and in
                        plain grey they read as less important than the ones
                        still being sold underneath. */}
                    <Link
                      href={course.href}
                      className="flex items-center gap-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary-muted/70 to-primary-muted/25 px-4 py-3 shadow-subtle transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold leading-tight text-primary">
                          {course.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {course.blurb}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>
      )}

      {/*
        What else is on offer. Until now this lived only on the public
        catalogue, which a signed-in student has little reason to go back to —
        so someone who had bought one course had no way to see the others
        without leaving the app.
      */}
      {available.length > 0 && (
        <section aria-labelledby="available-heading">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 id="available-heading" className="font-semibold tracking-tight">
                Courses available to purchase
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {purchased.length > 0
                  ? 'Add another course to what you already have.'
                  : 'Pick a course to get started.'}
              </p>

              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {available.map((course) => (
                  <li key={course.id}>
                    {/* Tinted, not plain. These are the only things on the
                        dashboard a student can act on to get more, and in grey
                        on white they read as a table of contents rather than
                        an offer. The tint is the brand's own primary at low
                        opacity — enough to draw the eye, short of the shouting
                        that would make a study tool feel like an ad. */}
                    <Link
                      href={course.href}
                      className="flex h-full items-start gap-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary-muted/70 to-primary-muted/25 px-4 py-3 shadow-subtle transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold leading-tight">{course.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {course.blurb}
                        </span>
                      </span>
                      {/* Today's price first, with the later one struck
                          through beside it. Showing the later price alone —
                          which this did — quotes a buyer more than they would
                          actually be charged. */}
                      <span className="shrink-0 text-right">
                        <span className="block text-base font-bold tabular-nums text-primary">
                          {formatPaise(course.priceInPaise)}
                        </span>
                        {course.laterPriceInPaise !== null && (
                          <>
                            <span className="block text-xs text-muted-foreground">
                              <s>{formatPaise(course.laterPriceInPaise)}</s> later
                            </span>
                            {/* What they actually save, worked out rather than
                                left for the reader to subtract. */}
                            <span className="mt-1 inline-block rounded-full bg-success/15 px-2 py-0.5 text-[0.7rem] font-semibold text-success">
                              Save{' '}
                              {Math.round(
                                ((course.laterPriceInPaise - course.priceInPaise) /
                                  course.laterPriceInPaise) *
                                  100,
                              )}
                              %
                            </span>
                          </>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Resume banner --------------------------------------------------- */}
      {resumable && (
        <Card variant="accent">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <PlayCircle className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold leading-tight">Test in progress</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {resumable.test.title} — your answers are saved. Time remaining is calculated on
                  our servers.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href={`/test/${resumable.id}`}>
                Resume test
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats ------------------------------------------------------------ */}
      <section aria-label="Your performance">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Tests attempted"
            value={summary.testsAttempted}
            icon={BookOpenCheck}
            tone="primary"
            hint={isNewStudent ? 'Start with a free mock' : 'Across all exams'}
          />
          <StatCard
            label="Questions solved"
            value={formatNumber(summary.questionsSolved)}
            icon={Target}
            tone="info"
            hint="Tests and practice combined"
          />
          <StatCard
            label="Average accuracy"
            value={summary.averageAccuracy != null ? `${summary.averageAccuracy}%` : '—'}
            icon={Gauge}
            tone="success"
            hint={summary.averageAccuracy == null ? 'No attempts yet' : 'Of questions you answered'}
          />
          <StatCard
            label="Study streak"
            value={`${summary.currentStreak} ${summary.currentStreak === 1 ? 'day' : 'days'}`}
            icon={Flame}
            tone="accent"
            hint={summary.longestStreak > 0 ? `Best: ${summary.longestStreak} days` : 'Start today'}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column -------------------------------------------------- */}
        <div className="space-y-6 lg:col-span-2">
          {/* Recommendations */}
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-semibold tracking-tight">Do this next</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ordered by what will move your score most.
              </p>

              <ul className="mt-4 space-y-3">
                {recommendations.map((action, index) => (
                  <li key={action.title}>
                    <Link
                      href={action.href}
                      // The top recommendation is tinted and the rest are not.
                      // The list is already ordered by what moves a score most,
                      // but four identical grey rows hid that ranking — so the
                      // one worth doing first now looks like it.
                      className={
                        index === 0
                          ? 'group flex items-start gap-3.5 rounded-lg border border-primary/30 bg-primary-muted/40 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card'
                          : 'group flex items-start gap-3.5 rounded-lg border border-border p-4 transition-all hover:-translate-y-0.5 hover:shadow-card'
                      }
                    >
                      <span
                        className={
                          action.tone === 'primary'
                            ? 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground'
                            : 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground'
                        }
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-tight transition-colors group-hover:text-primary">
                          {action.title}
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                          {action.body}
                        </p>
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

          {/* Subject performance */}
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-semibold tracking-tight">Subject performance</h2>

              {subjects.length === 0 ? (
                <EmptyState
                  size="sm"
                  className="mt-4"
                  icon={Gauge}
                  title="No subject data yet"
                  description="Attempt a test and your accuracy will be broken down by subject here."
                  action={{ label: 'Browse tests', href: '/test-series' }}
                />
              ) : (
                <div className="mt-5 space-y-5">
                  {subjects.map((subject) => (
                    <div key={subject.subjectId}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{subject.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {subject.accuracy}%
                          <span className="ml-2 text-xs">({subject.attempts} questions)</span>
                        </span>
                      </div>
                      <Progress
                        value={subject.accuracy}
                        className="mt-2"
                        tone={
                          subject.accuracy >= 75
                            ? 'success'
                            : subject.accuracy >= 50
                              ? 'warning'
                              : 'danger'
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent attempts */}
          <Card>
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold tracking-tight">Recent attempts</h2>
                {summary.recentAttempts.length > 0 && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/my-tests">View all</Link>
                  </Button>
                )}
              </div>

              {summary.recentAttempts.length === 0 ? (
                <EmptyState
                  size="sm"
                  className="mt-4"
                  icon={BookOpenCheck}
                  title="No tests attempted yet"
                  description="Start your first mock test to see your performance here."
                  action={{ label: 'Find a test', href: '/test-series' }}
                />
              ) : (
                <ul className="mt-4 divide-y divide-border">
                  {summary.recentAttempts.map((attempt) => (
                    <li key={attempt.id}>
                      <Link
                        href={`/test/${attempt.id}/result`}
                        className="group flex items-center gap-4 py-3.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium leading-tight transition-colors group-hover:text-primary">
                            {attempt.test.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDate(attempt.submittedAt, 'short')} ·{' '}
                            {formatDuration(attempt.timeSpentSeconds)}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="font-semibold tabular-nums">
                            {attempt.score}
                            <span className="text-sm font-normal text-muted-foreground">
                              /{attempt.maxScore}
                            </span>
                          </p>
                          {attempt.rank != null && (
                            <p className="text-xs text-muted-foreground">
                              {ordinal(attempt.rank)} rank
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column ------------------------------------------------- */}
        <div className="space-y-6">
          {/* Weak topics */}
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-semibold tracking-tight">Focus areas</h2>

              {insights.weak.length === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {insights.analysedCount === 0
                    ? 'We need a few more attempts before we can identify your weak topics honestly. A topic is only flagged once you have answered enough questions on it.'
                    : 'No weak topics right now — your analysed topics are all above 50% accuracy.'}
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {insights.weak.map((topic) => (
                    <li key={topic.topicId} className="rounded-lg border border-border p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium leading-tight">{topic.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {topic.subject} · {topic.chapter}
                          </p>
                        </div>
                        <Badge variant="danger" size="sm">
                          {topic.accuracy}%
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Based on {topic.attempts} questions
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {insights.weak.length > 0 && (
                <Button asChild fullWidth variant="outline" className="mt-4">
                  <Link href="/practice">Practise these topics</Link>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Strong topics */}
          {insights.strong.length > 0 && (
            <Card>
              <CardContent className="p-5 sm:p-6">
                <h2 className="font-semibold tracking-tight">Your strengths</h2>
                <ul className="mt-4 space-y-2.5">
                  {insights.strong.map((topic) => (
                    <li key={topic.topicId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm">{topic.name}</span>
                      <Badge variant="success" size="sm">
                        {topic.accuracy}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Recommended tests */}
          <Card>
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-semibold tracking-tight">Available now</h2>

              {recommended.length === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  You have attempted every free test available. Explore the full test series for
                  more.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {recommended.map((test) => (
                    <li key={test.id}>
                      <Link
                        href={`/test/${test.id}`}
                        className="group block rounded-lg border border-border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="brand" size="sm">
                            {test.exam.shortName}
                          </Badge>
                          <Badge variant="muted" size="sm">
                            {TEST_CATEGORY_LABELS[test.category as TestCategory] ?? test.category}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-tight transition-colors group-hover:text-primary">
                          {test.title}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden="true" />
                          {test.durationMinutes} min · {test.totalQuestions} questions
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <Card>
              <CardContent className="p-5 sm:p-6">
                <h2 className="font-semibold tracking-tight">Scheduled</h2>
                <ul className="mt-4 space-y-3">
                  {upcoming.map((test) => (
                    <li key={test.id} className="text-sm">
                      <p className="font-medium leading-tight">{test.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Opens {formatDate(test.startDate, 'full')}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
