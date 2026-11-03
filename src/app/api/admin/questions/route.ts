import { AppError } from '@/lib/api';
import { AUDIT_ACTIONS, audit } from '@/server/audit';
import { parseBody, route } from '@/server/api-handler';
import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';
import { questionSchema } from '@/validations/admin';

/**
 * POST /api/admin/questions — create a question.
 *
 * The schema refuses anything unscoreable (no correct option, two correct
 * options on a single-correct item), so a mis-keyed question cannot reach the
 * bank through this path.
 */
export const POST = route(async ({ request, ip }) => {
  const admin = await requireAdmin();
  const input = await parseBody(request, questionSchema);

  // Human-readable, collision-checked code. Sequence is per-exam.
  const exam = await db.exam.findUniqueOrThrow({
    where: { id: input.examId },
    select: { shortName: true },
  });
  // Checked before anything is written: a question for another exam's paper
  // would carry the wrong marks onto it, and refusing after creating it would
  // leave a stray question in the bank.
  if (input.attachToTestId) {
    const paper = await db.test.findFirst({
      where: { id: input.attachToTestId, deletedAt: null },
      select: { title: true, examId: true },
    });
    if (paper && paper.examId !== input.examId) {
      throw new AppError(
        'VALIDATION_ERROR',
        `“${paper.title}” belongs to another exam. Choose that exam for this question.`,
      );
    }
  }

  const count = await db.question.count({ where: { examId: input.examId } });

  let code = `${exam.shortName}-Q${String(count + 1).padStart(4, '0')}`;
  let suffix = 1;
  while (await db.question.findUnique({ where: { code }, select: { id: true } })) {
    code = `${exam.shortName}-Q${String(count + 1 + suffix).padStart(4, '0')}`;
    suffix += 1;
  }

  const question = await db.question.create({
    data: {
      code,
      examId: input.examId,
      subjectId: input.subjectId,
      chapterId: input.chapterId ?? null,
      topicId: input.topicId ?? null,
      type: input.type,
      difficulty: input.difficulty,
      status: input.status,
      body: input.body,
      passage: input.passage ?? null,
      imageUrl: input.imageUrl || null,
      marks: input.marks,
      negativeMarks: input.negativeMarks,
      numericalAnswer: input.numericalAnswer ?? null,
      numericalTolerance: input.numericalTolerance ?? null,
      explanation: input.explanation ?? null,
      detailedSolution: input.detailedSolution ?? null,
      concept: input.concept ?? null,
      source: input.source ?? null,
      examYear: input.examYear ?? null,
      reviewNote: input.reviewNote ?? null,
      createdById: admin.id,
      publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
      options: {
        create: input.options.map((option, index) => ({
          label: String.fromCharCode(65 + index),
          body: option.body,
          imageUrl: option.imageUrl ?? null,
          isCorrect: option.isCorrect,
          sortOrder: index,
        })),
      },
      stat: { create: {} },
    },
    select: { id: true, code: true },
  });

  // Attach to the paper it was created from, and keep that paper's totals in
  // step. Without this the question reached the bank and stopped there: the
  // paper's count never moved, so a new question looked as though it had been
  // silently discarded.
  if (input.attachToTestId) {
    const test = await db.test.findFirst({
      where: { id: input.attachToTestId, deletedAt: null },
      select: { id: true },
    });

    if (test) {
      const last = await db.testQuestion.aggregate({
        where: { testId: test.id },
        _max: { sortOrder: true },
      });

      await db.testQuestion.create({
        data: {
          testId: test.id,
          questionId: question.id,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          marks: input.marks,
          negativeMarks: input.negativeMarks,
        },
      });

      // Recomputed from the rows rather than incremented, so a count that has
      // already drifted is corrected rather than carried forward.
      const totals = await db.testQuestion.aggregate({
        where: { testId: test.id },
        _count: true,
        _sum: { marks: true },
      });

      await db.test.update({
        where: { id: test.id },
        data: {
          totalQuestions: totals._count,
          totalMarks: totals._sum.marks ?? 0,
        },
      });
    }
  }

  await audit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: AUDIT_ACTIONS.QUESTION_CREATED,
    entityType: 'Question',
    entityId: question.id,
    meta: { code: question.code, status: input.status },
    ipAddress: ip,
  });

  return {
    data: { id: question.id, code: question.code },
    message: `Question ${question.code} created.`,
    status: 201,
  };
});
