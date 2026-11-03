import type { Metadata } from 'next';

import { QuestionEditor } from '@/features/admin/question-editor';
import { EmptyState } from '@/components/ui/states';
import { enforceAdminArea } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getTaxonomyTree } from '@/server/services/admin-service';

export const metadata: Metadata = {
  title: 'New question',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await enforceAdminArea('/admin/questions/new');
  const [exams, query] = await Promise.all([getTaxonomyTree(), searchParams]);

  // The paper this was opened from: the new question joins it, and saving
  // returns there rather than to the unfiltered bank.
  const testId = query.testId;

  // That paper's exam and subject, so the question starts there and with that
  // exam's marks — an FDA paper's question at KAS marks would score it wrong.
  const paper = testId
    ? await db.test.findFirst({
        where: { id: testId, deletedAt: null },
        select: { examId: true, subjectId: true },
      })
    : null;

  // A question must belong to a subject, so there is nothing to render until
  // the taxonomy exists. Say so rather than showing empty dropdowns.
  const usable = exams.filter((exam) => exam.subjects.length > 0);

  if (usable.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No subjects to file a question under"
          description="Every question belongs to an exam and a subject. Create at least one subject before adding questions."
          action={{ label: 'Manage exams', href: '/admin/exams' }}
        />
      </div>
    );
  }

  return (
    <QuestionEditor
      exams={usable}
      attachToTestId={testId}
      start={paper ? { examId: paper.examId, subjectId: paper.subjectId } : undefined}
      returnTo={testId ? `/admin/questions?testId=${testId}` : undefined}
    />
  );
}
