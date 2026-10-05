import type { Metadata } from 'next';
import Link from 'next/link';
import { Bookmark } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { BookmarkList } from '@/features/practice/bookmark-list';
import { enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'Bookmarks',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BookmarksPage() {
  const user = await enforceStudent('/bookmarks');

  const bookmarks = await db.bookmark.findMany({
    where: { userId: user.id, question: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      note: true,
      createdAt: true,
      question: {
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
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Bookmarks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {bookmarks.length === 0
            ? 'Questions you save while practising or reviewing appear here.'
            : `${bookmarks.length} saved ${bookmarks.length === 1 ? 'question' : 'questions'}, with full solutions.`}
        </p>
      </header>

      {bookmarks.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet"
          description="Tap the bookmark icon on any question while practising or reviewing a result, and it will be saved here for later."
          action={{ label: 'Take a quiz', href: '/practice' }}
          secondaryAction={{ label: 'My tests', href: '/my-tests' }}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/practice">Quiz yourself on bookmarked questions</Link>
            </Button>
          </div>

          <BookmarkList
            items={bookmarks.map((bookmark) => ({
              bookmarkId: bookmark.id,
              note: bookmark.note,
              questionId: bookmark.question.id,
              type: bookmark.question.type,
              difficulty: bookmark.question.difficulty,
              body: bookmark.question.body,
              passage: bookmark.question.passage,
              imageUrl: bookmark.question.imageUrl,
              explanation: bookmark.question.explanation,
              detailedSolution: bookmark.question.detailedSolution,
              numericalAnswer: bookmark.question.numericalAnswer,
              options: bookmark.question.options,
              subject: bookmark.question.subject?.name ?? null,
              chapter: bookmark.question.chapter?.name ?? null,
              topic: bookmark.question.topic?.name ?? null,
            }))}
          />
        </>
      )}
    </div>
  );
}
