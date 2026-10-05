import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { QuestionEditor } from '@/features/admin/question-editor';
import { enforceAdminArea } from '@/server/auth/guards';
import { getQuestionForEdit, getTaxonomyTree } from '@/server/services/admin-service';

export const metadata: Metadata = {
  title: 'Edit question',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function EditQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  await enforceAdminArea(`/admin/questions/${id}`);

  const [question, exams, query] = await Promise.all([
    getQuestionForEdit(id),
    getTaxonomyTree(),
    searchParams,
  ]);
  if (!question) notFound();

  // The list the editor was opened from - a paper, or a filtered list such as
  // the questions with a review note - so Back returns there instead of to the
  // unfiltered bank. Only a question-bank address is accepted.
  const returnTo =
    query.back && query.back.startsWith('/admin/questions')
      ? query.back
      : query.testId
        ? `/admin/questions?testId=${query.testId}`
        : undefined;

  return (
    <QuestionEditor
      returnTo={returnTo}
      exams={exams.filter((exam) => exam.subjects.length > 0)}
      initial={{
        id: question.id,
        code: question.code,
        examId: question.examId,
        subjectId: question.subjectId,
        chapterId: question.chapterId,
        topicId: question.topicId,
        type: question.type,
        difficulty: question.difficulty,
        status: question.status,
        body: question.body,
        passage: question.passage,
        imageUrl: question.imageUrl,
        marks: question.marks,
        negativeMarks: question.negativeMarks,
        numericalAnswer: question.numericalAnswer,
        numericalTolerance: question.numericalTolerance,
        explanation: question.explanation,
        detailedSolution: question.detailedSolution,
        concept: question.concept,
        source: question.source,
        examYear: question.examYear,
        reviewNote: question.reviewNote,
        options: question.options.map((option) => ({
          body: option.body,
          isCorrect: option.isCorrect,
          // Loaded, not dropped: omitting this wipes an option's image on the
          // next save, because the editor sends back what it was given.
          imageUrl: option.imageUrl,
        })),
      }}
    />
  );
}
