import type { Metadata } from 'next';
import Link from 'next/link';
import { Target, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { QuestionReview } from '@/features/practice/question-review';
import { enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'Wrong questions',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Every question the student has answered incorrectly, from tests and practice
 * alike, with the correct answer and full solution.
 *
 * Deduplicated by question: getting the same item wrong three times should
 * produce one entry to revise, not three identical cards. The repeat count is
 * surfaced instead, because a question missed repeatedly is exactly the one
 * worth the most attention.
 */
export default async function WrongQuestionsPage() {
  const user = await enforceStudent('/wrong-questions');

  const [testWrong, practiceWrong] = await Promise.all([
    db.testAnswer.findMany({
      where: { attempt: { userId: user.id }, isCorrect: false },
      orderBy: { updatedAt: 'desc' },
      select: { questionId: true, selectedOptionIdsJson: true, numericalValue: true },
    }),
    db.practiceAnswer.findMany({
      where: { session: { userId: user.id }, isCorrect: false },
      orderBy: { updatedAt: 'desc' },
      select: { questionId: true, selectedOptionIdsJson: true, numericalValue: true },
    }),
  ]);

  const all = [...testWrong, ...practiceWrong];

  // Count repeats, and keep the most recent wrong answer for each question.
  const misses = new Map<string, { count: number; selected: string[]; numericalValue: number | null }>();
  for (const row of all) {
    const existing = misses.get(row.questionId);
    let selected: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.selectedOptionIdsJson);
      if (Array.isArray(parsed)) selected = parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      // A malformed column must not take down the whole page.
      selected = [];
    }

    if (existing) existing.count += 1;
    else misses.set(row.questionId, { count: 1, selected, numericalValue: row.numericalValue });
  }

  const questionIds = [...misses.keys()].slice(0, 100);

  const [questions, bookmarks] = await Promise.all([
    db.question.findMany({
      where: { id: { in: questionIds }, deletedAt: null },
      select: {
        id: true,
        type: true,
        difficulty: true,
        body: true,
        passage: true,
        imageUrl: true,
        explanation: true,
        detailedSolution: true,
        numericalAnswer: true,
        options: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, label: true, body: true, isCorrect: true },
        },
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
        topic: { select: { name: true } },
      },
    }),
    db.bookmark.findMany({
      where: { userId: user.id, questionId: { in: questionIds } },
      select: { questionId: true },
    }),
  ]);

  const bookmarked = new Set(bookmarks.map((b) => b.questionId));

  // Most-missed first — that ordering is the whole value of this page.
  const ordered = questions.sort(
    (a, b) => (misses.get(b.id)?.count ?? 0) - (misses.get(a.id)?.count ?? 0),
  );

  const repeated = ordered.filter((q) => (misses.get(q.id)?.count ?? 0) > 1).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Wrong questions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ordered.length === 0
            ? 'Questions you answer incorrectly are collected here for revision.'
            : `${ordered.length} ${ordered.length === 1 ? 'question' : 'questions'} to revise, most-missed first.`}
        </p>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          icon={XCircle}
          title="Nothing to revise yet"
          description="Once you get a question wrong in a test or a quiz, it lands here with the correct answer and a full solution."
          action={{ label: 'Attempt a test', href: '/my-tests' }}
          secondaryAction={{ label: 'Take a quiz', href: '/practice' }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{ordered.length}</span>{' '}
              distinct questions
            </span>
            {repeated > 0 && (
              <Badge variant="warning" size="sm">
                {repeated} missed more than once
              </Badge>
            )}
            <Button asChild size="sm" className="ml-auto">
              <Link href="/practice">
                <Target aria-hidden="true" />
                Quiz yourself on these
              </Link>
            </Button>
          </div>

          <div className="space-y-4">
            {ordered.map((question, index) => {
              const miss = misses.get(question.id);

              return (
                <div key={question.id}>
                  {miss && miss.count > 1 && (
                    <p className="mb-1.5 text-xs font-medium text-warning">
                      Missed {miss.count} times
                    </p>
                  )}
                  <QuestionReview
                    questionId={question.id}
                    index={index + 1}
                    body={question.body}
                    passage={question.passage}
                    imageUrl={question.imageUrl}
                    type={question.type}
                    difficulty={question.difficulty}
                    numericalAnswer={question.numericalAnswer}
                    numericalValue={miss?.numericalValue ?? null}
                    explanation={question.explanation}
                    detailedSolution={question.detailedSolution}
                    subject={question.subject?.name ?? null}
                    chapter={question.chapter?.name ?? null}
                    topic={question.topic?.name ?? null}
                    isCorrect={false}
                    isBookmarked={bookmarked.has(question.id)}
                    options={question.options.map((option) => ({
                      ...option,
                      isSelected: miss?.selected.includes(option.id) ?? false,
                    }))}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
