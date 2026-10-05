'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Play, Shuffle, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiClientError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Practice setup.
 *
 * The source selector is the important control: "questions I got wrong" and
 * "questions I have never seen" are the two modes that actually move a score,
 * so they are given equal weight to plain topic selection rather than buried in
 * a filter dropdown.
 */
export interface PracticeSetupProps {
  subjects: {
    id: string;
    name: string;
    colorHex: string | null;
    examShortName: string;
    questionCount: number;
    chapters: { id: string; name: string; questionCount: number }[];
  }[];
  bookmarkCount: number;
  incorrectCount: number;
}

type Source = 'NEW' | 'INCORRECT' | 'BOOKMARKED' | 'ALL';

const COUNTS = [5, 10, 20, 30] as const;
const DIFFICULTIES = [
  { value: undefined, label: 'Any' },
  { value: 'EASY' as const, label: 'Easy' },
  { value: 'MEDIUM' as const, label: 'Medium' },
  { value: 'HARD' as const, label: 'Hard' },
];

export function PracticeSetup({ subjects, bookmarkCount, incorrectCount }: PracticeSetupProps) {
  const router = useRouter();

  const [source, setSource] = React.useState<Source>('NEW');
  const [subjectId, setSubjectId] = React.useState<string | undefined>();
  const [chapterId, setChapterId] = React.useState<string | undefined>();
  const [difficulty, setDifficulty] = React.useState<'EASY' | 'MEDIUM' | 'HARD' | undefined>();
  const [count, setCount] = React.useState<number>(10);
  const [starting, setStarting] = React.useState(false);

  const selectedSubject = subjects.find((s) => s.id === subjectId);

  const SOURCES: { value: Source; label: string; hint: string; icon: typeof Sparkles; count?: number }[] = [
    { value: 'NEW', label: 'New questions', hint: 'Ones you have never attempted', icon: Sparkles },
    {
      value: 'INCORRECT',
      label: 'My mistakes',
      hint: 'Questions you previously got wrong',
      icon: XCircle,
      count: incorrectCount,
    },
    {
      value: 'BOOKMARKED',
      label: 'Bookmarked',
      hint: 'Questions you saved for later',
      icon: Bookmark,
      count: bookmarkCount,
    },
    { value: 'ALL', label: 'All questions', hint: 'Anything in the bank', icon: Shuffle },
  ];

  async function start() {
    setStarting(true);
    try {
      const result = await api.post<{ sessionId: string; resumed: boolean; href: string }>(
        '/api/practice',
        { source, subjectId, chapterId, difficulty, count },
      );

      if (result.resumed) toast.info('Resuming your quiz in progress.');
      router.push(result.href);
    } catch (error) {
      setStarting(false);
      toast.error(
        error instanceof ApiClientError ? error.message : 'We could not start the quiz.',
      );
    }
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-5 sm:p-6">
        {/* Source ------------------------------------------------------ */}
        <fieldset>
          <legend className="text-sm font-semibold">What do you want to be quizzed on?</legend>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {SOURCES.map((item) => {
              const Icon = item.icon;
              const active = source === item.value;
              const empty = item.count !== undefined && item.count === 0;

              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSource(item.value)}
                  disabled={empty}
                  aria-pressed={active}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active ? 'border-primary bg-primary-muted' : 'border-border hover:bg-muted/50',
                    empty && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Icon
                    className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {item.label}
                      {item.count !== undefined && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          ({item.count})
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {empty ? 'Nothing here yet' : item.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Subject ----------------------------------------------------- */}
        <fieldset>
          <legend className="text-sm font-semibold">Subject</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSubjectId(undefined);
                setChapterId(undefined);
              }}
              aria-pressed={subjectId === undefined}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                subjectId === undefined
                  ? 'border-primary bg-primary-muted text-primary'
                  : 'border-border hover:bg-muted',
              )}
            >
              All subjects
            </button>

            {subjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => {
                  setSubjectId(subject.id);
                  setChapterId(undefined);
                }}
                aria-pressed={subjectId === subject.id}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  subjectId === subject.id
                    ? 'border-primary bg-primary-muted text-primary'
                    : 'border-border hover:bg-muted',
                )}
              >
                {subject.name}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {subject.questionCount}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* Chapter ----------------------------------------------------- */}
        {selectedSubject && selectedSubject.chapters.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold">Chapter</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setChapterId(undefined)}
                aria-pressed={chapterId === undefined}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  chapterId === undefined
                    ? 'border-primary bg-primary-muted text-primary'
                    : 'border-border hover:bg-muted',
                )}
              >
                All chapters
              </button>

              {selectedSubject.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => setChapterId(chapter.id)}
                  aria-pressed={chapterId === chapter.id}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    chapterId === chapter.id
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {chapter.name}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {chapter.questionCount}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* Difficulty + count ------------------------------------------ */}
        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-semibold">Difficulty</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIFFICULTIES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setDifficulty(item.value)}
                  aria-pressed={difficulty === item.value}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    difficulty === item.value
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">Number of questions</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {COUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCount(value)}
                  aria-pressed={count === value}
                  className={cn(
                    'rounded-lg border px-3.5 py-1.5 text-sm tabular-nums transition-colors',
                    count === value
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <Button
          size="lg"
          fullWidth
          variant="brand"
          onClick={start}
          loading={starting}
          loadingText="Preparing questions…"
        >
          <Play aria-hidden="true" />
          Start quiz
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          No timer, no negative marking. The solution appears as soon as you answer.
        </p>
      </CardContent>
    </Card>
  );
}
