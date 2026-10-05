'use client';

import * as React from 'react';

import { EmptyState } from '@/components/ui/states';

import { QuestionReview, type ReviewOption } from './question-review';

/**
 * Bookmark list.
 *
 * Client-side so removing a bookmark drops the row immediately rather than
 * leaving a question on screen that is no longer saved. The server remains the
 * source of truth — this only mirrors a write that already succeeded.
 */
export interface BookmarkItem {
  bookmarkId: string;
  note: string | null;
  questionId: string;
  type: string;
  difficulty: string;
  body: string;
  passage: string | null;
  imageUrl: string | null;
  explanation: string | null;
  detailedSolution: string | null;
  numericalAnswer: number | null;
  options: ReviewOption[];
  subject: string | null;
  chapter: string | null;
  topic: string | null;
}

export function BookmarkList({ items }: { items: BookmarkItem[] }) {
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());

  const visible = items.filter((item) => !removed.has(item.questionId));

  if (visible.length === 0) {
    return (
      <EmptyState
        title="All bookmarks removed"
        description="You have cleared every saved question. Bookmark more while taking a quiz and they will appear here."
        action={{ label: 'Start practising', href: '/practice' }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((item, index) => (
        <div key={item.bookmarkId}>
          <QuestionReview
            questionId={item.questionId}
            index={index + 1}
            body={item.body}
            passage={item.passage}
            imageUrl={item.imageUrl}
            type={item.type}
            difficulty={item.difficulty}
            options={item.options}
            numericalAnswer={item.numericalAnswer}
            explanation={item.explanation}
            detailedSolution={item.detailedSolution}
            subject={item.subject}
            chapter={item.chapter}
            topic={item.topic}
            isBookmarked
            onBookmarkChange={(bookmarked) => {
              if (bookmarked) return;
              setRemoved((previous) => new Set(previous).add(item.questionId));
            }}
          />

          {item.note && (
            <p className="mt-2 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Your note:</span> {item.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
