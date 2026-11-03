import { errors } from '@/lib/api';
import { AUDIT_ACTIONS, audit } from '@/server/audit';
import { parseBody, route } from '@/server/api-handler';
import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';
import { refreshTestTotals } from '@/server/services/admin-service';
import { testQuestionsSchema } from '@/validations/admin';

/**
 * POST /api/admin/tests/[id]/questions — attach, detach or reorder questions.
 *
 * Every branch ends by recomputing the test's cached totals, so
 * `totalQuestions` and `totalMarks` can never drift from what is actually
 * attached. Those two fields drive the student-facing catalogue and the
 * "published but empty" warning, so a stale value is not cosmetic.
 */
export const POST = route(async ({ request, params, ip }) => {
  const admin = await requireAdmin();
  const input = await parseBody(request, testQuestionsSchema);
  const testId = params.id!;

  const test = await db.test.findFirst({
    where: { id: testId, deletedAt: null },
    select: { id: true, title: true, defaultNegativeRatio: true, examId: true },
  });
  if (!test) throw errors.notFound('Test');

  if (input.action === 'publish') {
    // Publishes drafts that are already on this test. A draft is attached but
    // skipped when a student sits the paper, so this is the fix for the warning
    // that reports them — offered here rather than leaving someone to open each
    // question in turn.
    //
    // Scoped to this test's own questions: an id sent from elsewhere must not
    // be able to publish arbitrary content through this route.
    const attached = await db.testQuestion.findMany({
      where: { testId, questionId: { in: input.questionIds } },
      select: { questionId: true },
    });

    const publishable = await db.question.findMany({
      where: {
        id: { in: attached.map((row) => row.questionId) },
        deletedAt: null,
        status: { not: 'PUBLISHED' },
        // Never publish something unanswerable: a question with no correct
        // option would mark every student wrong.
        options: { some: { isCorrect: true } },
      },
      select: { id: true },
    });

    await db.question.updateMany({
      where: { id: { in: publishable.map((q) => q.id) } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    await audit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: AUDIT_ACTIONS.TEST_UPDATED,
      entityType: 'Test',
      entityId: testId,
      meta: { published: publishable.length },
      ipAddress: ip,
    });

    return {
      data: {
        attached: 0,
        skipped: attached.length - publishable.length,
        published: publishable.length,
        ...(await refreshTestTotals(testId)),
      },
      message:
        publishable.length === 1
          ? 'Question published.'
          : `${publishable.length} questions published.`,
    };
  }

  if (input.action === 'attach') {
    // Only attach questions that exist, are not archived, and are not already
    // on the test — silently skipping the rest beats failing the whole batch.
    const existing = await db.testQuestion.findMany({
      where: { testId },
      select: { questionId: true, sortOrder: true },
    });
    const already = new Set(existing.map((row) => row.questionId));
    let nextOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), 0);

    const candidates = await db.question.findMany({
      where: {
        id: { in: input.questionIds.filter((qid) => !already.has(qid)) },
        deletedAt: null,
      },
      select: { id: true, marks: true, negativeMarks: true, examId: true },
    });

    // Only the test's own exam. A question carries its exam's marks, so a KAS
    // question on a KEA FDA / SDA paper would be scored +2 / −0.5 there.
    const usable = candidates.filter((question) => question.examId === test.examId);
    const foreign = candidates.length - usable.length;

    for (const question of usable) {
      nextOrder += 1;
      await db.testQuestion.create({
        data: {
          testId,
          questionId: question.id,
          sortOrder: nextOrder,
          // Marks default to the question's own, so a test inherits the
          // authored value unless an admin overrides it later.
          marks: question.marks,
          negativeMarks: question.negativeMarks,
        },
      });
    }

    const totals = await refreshTestTotals(testId);

    await audit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: AUDIT_ACTIONS.TEST_UPDATED,
      entityType: 'Test',
      entityId: testId,
      meta: { attached: usable.length, totalQuestions: totals.totalQuestions },
      ipAddress: ip,
    });

    return {
      data: { attached: usable.length, skipped: input.questionIds.length - usable.length, ...totals },
      message:
        (usable.length === 0 && foreign === 0
          ? 'Those questions are already on this test.'
          : `Added ${usable.length} question${usable.length === 1 ? '' : 's'}.`) +
        (foreign > 0
          ? ` ${foreign} from another exam ${foreign === 1 ? 'was' : 'were'} left out.`
          : ''),
    };
  }

  if (input.action === 'clear') {
    // Emptying a paper somebody has sat would leave their result page reading
    // back questions that are no longer attached, so an attempted paper is
    // refused rather than quietly broken.
    const attempts = await db.testAttempt.count({ where: { testId } });
    if (attempts > 0) {
      throw errors.badRequest(
        `${attempts} student attempt${attempts === 1 ? ' exists' : 's exist'} on this paper. ` +
          'Clearing it would break those result pages. Remove the attempts first if you are sure.',
      );
    }

    const removed = await db.testQuestion.deleteMany({ where: { testId } });
    const totals = await refreshTestTotals(testId);

    await audit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: AUDIT_ACTIONS.TEST_UPDATED,
      entityType: 'Test',
      entityId: testId,
      meta: { cleared: removed.count, title: test.title },
      ipAddress: ip,
    });

    return {
      data: { detached: removed.count, ...totals },
      message:
        removed.count === 0
          ? 'That paper was already empty.'
          : `Cleared ${removed.count} question${removed.count === 1 ? '' : 's'} from this paper. ` +
            'They remain in the question bank.',
    };
  }

  if (input.action === 'detach') {
    const removed = await db.testQuestion.deleteMany({
      where: { testId, questionId: { in: input.questionIds } },
    });

    const totals = await refreshTestTotals(testId);

    return {
      data: { detached: removed.count, ...totals },
      message: `Removed ${removed.count} question${removed.count === 1 ? '' : 's'}.`,
    };
  }

  if (input.action === 'move') {
    if (!input.destinationTestId) {
      throw errors.validation({ destinationTestId: ['Choose a paper to move these questions to.'] });
    }
    if (input.destinationTestId === testId) {
      throw errors.validation({
        destinationTestId: ['That is the paper they are already on.'],
      });
    }

    const destination = await db.test.findFirst({
      where: { id: input.destinationTestId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!destination) throw errors.notFound('Destination test');

    // Only questions actually on this paper, in the order this paper puts
    // them in — a move that scrambles the order is barely better than
    // detaching and re-attaching by hand, which is what it replaces.
    const moving = await db.testQuestion.findMany({
      where: { testId, questionId: { in: input.questionIds } },
      orderBy: { sortOrder: 'asc' },
      select: { questionId: true, marks: true, negativeMarks: true },
    });

    if (moving.length === 0) {
      throw errors.validation({ questionIds: ['None of those questions are on this paper.'] });
    }

    // Anything already on the destination is left there rather than
    // duplicated, but is still taken off this paper: the intent is "these
    // belong over there".
    const alreadyThere = new Set(
      (
        await db.testQuestion.findMany({
          where: {
            testId: destination.id,
            questionId: { in: moving.map((m) => m.questionId) },
          },
          select: { questionId: true },
        })
      ).map((r) => r.questionId),
    );

    const last = await db.testQuestion.aggregate({
      where: { testId: destination.id },
      _max: { sortOrder: true },
    });
    let next = (last._max.sortOrder ?? 0) + 1;

    const toAttach = moving.filter((m) => !alreadyThere.has(m.questionId));

    await db.$transaction([
      ...toAttach.map((m) =>
        db.testQuestion.create({
          data: {
            testId: destination.id,
            questionId: m.questionId,
            sortOrder: next++,
            marks: m.marks,
            negativeMarks: m.negativeMarks,
          },
        }),
      ),
      db.testQuestion.deleteMany({
        where: { testId, questionId: { in: moving.map((m) => m.questionId) } },
      }),
    ]);

    const [from, to] = await Promise.all([
      refreshTestTotals(testId),
      refreshTestTotals(destination.id),
    ]);

    // Recorded against the paper they came from, naming where they went, so
    // an accidental move can be traced back.
    await audit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: AUDIT_ACTIONS.TEST_UPDATED,
      entityType: 'Test',
      entityId: testId,
      meta: { moved: toAttach.length, to: destination.id, toTitle: destination.title },
      ipAddress: ip,
    });

    void to;

    return {
      data: { moved: toAttach.length, skipped: alreadyThere.size, ...from },
      message:
        `Moved ${toAttach.length} question${toAttach.length === 1 ? '' : 's'} to ` +
        `${destination.title}.` +
        (alreadyThere.size > 0
          ? ` ${alreadyThere.size} were already there and were removed from this paper.`
          : ''),
    };
  }

  // --- reorder -------------------------------------------------------------
  const owned = await db.testQuestion.findMany({
    where: { testId },
    select: { id: true },
  });
  const valid = new Set(owned.map((row) => row.id));

  await db.$transaction(
    input.order
      .filter((rowId) => valid.has(rowId))
      .map((rowId, index) =>
        db.testQuestion.update({ where: { id: rowId }, data: { sortOrder: index + 1 } }),
      ),
  );

  const totals = await refreshTestTotals(testId);

  return { data: totals, message: 'Order saved.' };
});
