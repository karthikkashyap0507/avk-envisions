import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, FileQuestion, Filter, Plus } from 'lucide-react';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { DeleteQuestion } from '@/features/admin/delete-question';
import { PaperReview } from '@/features/admin/paper-review';
import { formatDate } from '@/lib/utils';
import { enforceAdminArea } from '@/server/auth/guards';
import {
  getTaxonomyTree,
  listPaperForReview,
  listPaperGroups,
  listQuestions,
} from '@/server/services/admin-service';

export const metadata: Metadata = {
  title: 'Question bank',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await enforceAdminArea('/admin/questions');
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // This list's own address, handed to the editor as the way back.
  const listQuery = new URLSearchParams();
  for (const key of ['testId', 'q', 'examId', 'subjectId', 'status', 'difficulty', 'flagged', 'page'] as const) {
    const value = params[key];
    if (value) listQuery.set(key, value);
  }
  const listHref = listQuery.size > 0 ? `/admin/questions?${listQuery.toString()}` : '/admin/questions';
  const editHref = (questionId: string) => {
    const query = new URLSearchParams();
    if (params.testId) query.set('testId', params.testId);
    if (listHref !== '/admin/questions') query.set('back', listHref);
    return query.size > 0 ? `/admin/questions/${questionId}?${query.toString()}` : `/admin/questions/${questionId}`;
  };

  // The bank opens on the papers, not on every question ever imported.
  // Content is written and corrected one paper at a time, and reaching the 2011
  // Paper II questions in a flat list of 1,273 meant paging past a thousand
  // unrelated ones. A search or filter still searches everything.
  const browsing =
    !params.testId && !params.q && !params.subjectId && !params.status && !params.difficulty && params.flagged !== '1';

  // A paper opened on its own is opened to be proof-read, so it comes back
  // whole and editable — the same layout the PDF import shows after a parse.
  // Narrow it with a filter and it falls back to the paged list, because then
  // the question is "which ones match", not "read all hundred".
  const reviewing =
    Boolean(params.testId) &&
    !params.q &&
    !params.subjectId &&
    !params.status &&
    !params.difficulty &&
    params.flagged !== '1';

  const [result, exams, groups, review] = await Promise.all([
    listQuestions({
      search: params.q,
      examId: params.examId,
      subjectId: params.subjectId,
      status: params.status,
      difficulty: params.difficulty,
      flagged: params.flagged === '1',
      testId: params.testId,
      page,
    }),
    getTaxonomyTree(),
    browsing ? listPaperGroups() : Promise.resolve([]),
    reviewing ? listPaperForReview(params.testId!) : Promise.resolve([]),
  ]);

  const paper = params.testId
    ? (await listPaperGroups()).flatMap((g) => g.papers).find((t) => t.id === params.testId)
    : undefined;

  /** Preserves the active filters when only the page changes. */
  function pageHref(target: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(target));
    return `/admin/questions?${query.toString()}`;
  }

  const activeFilters = [
    params.q && `“${params.q}”`,
    params.status && params.status.toLowerCase(),
    params.difficulty && params.difficulty.toLowerCase(),
    params.flagged === '1' && 'flagged',
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {paper && (
            <Link
              href="/admin/questions"
              className="mb-1 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ← All papers
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {paper ? paper.title : 'Question bank'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {browsing
              ? `${result.total} ${result.total === 1 ? 'question' : 'questions'} across all papers`
              : `${result.total} ${result.total === 1 ? 'question' : 'questions'}`}
            {activeFilters.length > 0 && ` matching ${activeFilters.join(', ')}`}
          </p>
        </div>

        <Button asChild>
          {/* Carries the paper, so a question created here joins it rather than
              landing in the bank alone. */}
          <Link
            href={
              params.testId
                ? `/admin/questions/new?testId=${params.testId}`
                : '/admin/questions/new'
            }
          >
            <Plus aria-hidden="true" />
            {paper ? 'Add a question to this paper' : 'New question'}
          </Link>
        </Button>
      </header>

      {/* Paper picker ----------------------------------------------------- */}
      {browsing && (
        <div className="space-y-5">
          {groups.map((group) => (
            <Card key={group.seriesSlug}>
              <CardContent className="p-4 sm:p-5">
                <h2 className="text-sm font-semibold tracking-tight">{group.seriesName}</h2>

                <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.papers.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/admin/questions?testId=${item.id}`}
                        className="flex h-full flex-col rounded-xl border border-border p-3 transition-colors hover:border-primary hover:bg-primary-muted/40"
                      >
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {item.questionCount}{' '}
                          {item.questionCount === 1 ? 'question' : 'questions'}
                          {item.status !== 'PUBLISHED' && (
                            <Badge variant="warning" size="sm">
                              {item.status.toLowerCase()}
                            </Badge>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters --------------------------------------------------------- */}
      {!browsing && (
      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            {/* A filter inside a paper must stay inside it; without this the
                form would drop testId and jump back to the whole bank. */}
            {params.testId && <input type="hidden" name="testId" value={params.testId} />}
            <div className="min-w-[200px] flex-1">
              <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
                Search
              </label>
              <input
                id="q"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Question text or code"
                className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="examId" className="text-xs font-medium text-muted-foreground">
                Exam
              </label>
              <select
                id="examId"
                name="examId"
                defaultValue={params.examId ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.shortName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={params.status ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="difficulty" className="text-xs font-medium text-muted-foreground">
                Difficulty
              </label>
              <select
                id="difficulty"
                name="difficulty"
                defaultValue={params.difficulty ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {['EASY', 'MEDIUM', 'HARD'].map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                name="flagged"
                value="1"
                defaultChecked={params.flagged === '1'}
                className="size-4 rounded border-input"
              />
              Flagged only
            </label>

            <Button type="submit" size="sm">
              <Filter aria-hidden="true" />
              Apply
            </Button>

            {activeFilters.length > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/questions">Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      )}

      {/* Results --------------------------------------------------------- */}
      {browsing ? null : reviewing ? (
        review.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="This paper has no questions yet"
            description="Import them from a PDF, or add the first one by hand."
            action={{
              label: 'Add a question',
              href: `/admin/questions/new?testId=${params.testId}`,
            }}
          />
        ) : (
          <PaperReview paperTitle={paper?.title ?? 'this paper'} questions={review} />
        )
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No questions match"
          description={
            activeFilters.length > 0
              ? 'Try widening the filters, or clear them to see the whole bank.'
              : 'The question bank is empty. Create the first question to get started.'
          }
          action={{
            label: 'New question',
            href: params.testId
              ? `/admin/questions/new?testId=${params.testId}`
              : '/admin/questions/new',
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {result.rows.map((question) => (
                <li key={question.id} className="flex items-start gap-1 pr-3">
                  <Link
                    // Carries this list through - the paper, or the filters
                    // such as "has a review note" - so Back returns here
                    // rather than to the unfiltered bank.
                    href={editHref(question.id)}
                    className="group flex items-start gap-4 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {question.code}
                        </span>
                        <StatusBadge status={question.status} />
                        <Badge variant="muted" size="sm">
                          {DIFFICULTY_LABELS[question.difficulty] ?? question.difficulty}
                        </Badge>
                        {question.subject && (
                          <span className="text-xs text-muted-foreground">
                            {question.subject.name}
                          </span>
                        )}
                        {question.reviewNote && (
                          <Badge variant="warning" size="sm">
                            <AlertTriangle aria-hidden="true" />
                            Flagged
                          </Badge>
                        )}
                      </div>

                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed transition-colors group-hover:text-primary">
                        {question.body}
                      </p>

                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          +{question.marks}
                          {question.negativeMarks > 0 && ` / −${question.negativeMarks}`}
                        </span>
                        <span>
                          in {question._count.testQuestions}{' '}
                          {question._count.testQuestions === 1 ? 'test' : 'tests'}
                        </span>
                        {question.stat && question.stat.attemptCount > 0 && (
                          <span>
                            {question.stat.attemptCount} attempts ·{' '}
                            {Math.round(question.stat.accuracy)}% correct
                          </span>
                        )}
                        {question.source && <span>{question.source}</span>}
                        <span>{formatDate(question.createdAt, 'short')}</span>
                      </p>
                    </div>
                  </Link>

                  {/* Beside the row, not inside it: the row is a link to the
                      editor, and a button nested in a link is not reliably
                      clickable. */}
                  <div className="pt-4">
                    <DeleteQuestion
                      questionId={question.id}
                      code={question.code}
                      attachedTo={question._count.testQuestions}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Pagination ------------------------------------------------------ */}
      {!reviewing && result.totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={pageHref(page - 1)}>Previous</Link>
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            Page {page} of {result.totalPages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= result.totalPages}>
            <Link href={pageHref(page + 1)}>Next</Link>
          </Button>
        </nav>
      )}
    </div>
  );
}
