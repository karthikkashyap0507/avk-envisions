import { AppError, errors } from '@/lib/api';
import { AUDIT_ACTIONS, audit } from '@/server/audit';
import { parseBody, route } from '@/server/api-handler';
import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';
import { refreshTestTotals } from '@/server/services/admin-service';
import { translationWorker } from '@/server/translation/worker';
import { importCommitSchema } from '@/validations/import';

/**
 * POST /api/admin/import/commit — create the reviewed questions and wire them up.
 *
 * Everything happens in one transaction. A partial import — half the questions
 * created, the test left inconsistent — would be worse than a clean failure,
 * because the admin would have no way to tell which half landed.
 */
export const POST = route(async ({ request, ip }) => {
  const admin = await requireAdmin();
  const input = await parseBody(request, importCommitSchema);

  const [exam, subject] = await Promise.all([
    db.exam.findFirst({ where: { id: input.examId, deletedAt: null }, select: { id: true, shortName: true } }),
    db.subject.findFirst({ where: { id: input.subjectId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!exam) throw errors.notFound('Exam');
  if (!subject) throw errors.notFound('Subject');

  // Resolve every existing destination before writing anything, so a bad id
  // fails the whole import rather than leaving questions attached to some
  // tests and not others.
  const existingIds = input.destinations
    .filter((d) => d.kind === 'EXISTING_TEST')
    .map((d) => d.testId!);

  if (existingIds.length > 0) {
    const found = await db.test.findMany({
      where: { id: { in: existingIds }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(existingIds).size) throw errors.notFound('Test');
  }

  // Question codes must be unique. Reserve a contiguous range up front rather
  // than probing inside the loop, which would be O(n) round trips.
  const existingCount = await db.question.count({ where: { examId: exam.id } });
  const taken = new Set(
    (
      await db.question.findMany({
        where: { examId: exam.id },
        select: { code: true },
      })
    ).map((q) => q.code),
  );

  let sequence = existingCount;
  const nextCode = () => {
    let code: string;
    do {
      sequence += 1;
      code = `${exam.shortName}-Q${String(sequence).padStart(4, '0')}`;
    } while (taken.has(code));
    taken.add(code);
    return code;
  };

  const status = input.publish ? 'PUBLISHED' : 'DRAFT';
  const now = new Date();

  const result = await db.$transaction(
    async (tx) => {
      // --- Questions -------------------------------------------------------
      const createdIds: string[] = [];

      for (const question of input.questions) {
        const created = await tx.question.create({
          data: {
            code: nextCode(),
            examId: exam.id,
            subjectId: subject.id,
            type: 'SINGLE_CORRECT',
            difficulty: question.difficulty,
            status,
            body: question.body,
            imageUrl: question.imageUrl,
            marks: input.marks,
            negativeMarks: input.negativeMarks,
            source: input.source ?? null,
            examYear: input.examYear ?? null,
            language: 'en',
            createdById: admin.id,
            reviewedById: admin.id,
            reviewedAt: now,
            publishedAt: input.publish ? now : null,
            // Kept where the paper printed one and the reviewer left it in
            // place. Never invented: a fabricated explanation is worse than an
            // empty field, because a student would believe it.
            explanation: question.explanation?.trim() || null,
            options: {
              create: question.options.map((option, index) => ({
                label: String.fromCharCode(65 + index),
                body: option.body,
              imageUrl: option.imageUrl,
                isCorrect: index === question.correctIndex,
                sortOrder: index,
              })),
            },
            stat: { create: {} },
          },
          select: { id: true },
        });

        createdIds.push(created.id);
      }

      // --- Destinations ------------------------------------------------------
      // The questions above were created once. Each destination gets its own
      // link rows pointing at those same questions, which is what lets one
      // import fill a subject drill and a mock without duplicating anything.
      const attached: { testId: string; title: string; added: number; skipped: number }[] = [];

      for (const destination of input.destinations) {
        let testId: string;
        let title: string;

        if (destination.kind === 'NEW_TEST') {
          const base = destination.title!
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

          let slug = base;
          let suffix = 1;
          while (await tx.test.findUnique({ where: { slug }, select: { id: true } })) {
            suffix += 1;
            slug = `${base}-${suffix}`;
          }

          const test = await tx.test.create({
            data: {
              examId: exam.id,
              testSeriesId: destination.testSeriesId ?? null,
              title: destination.title!,
              slug,
              category: destination.category,
              mode: 'EXAM',
              // A newly imported test is never published automatically, even
              // when the questions are: an admin should look at it first.
              status: 'DRAFT',
              accessType: destination.accessType,
              durationMinutes: destination.durationMinutes,
              maxAttempts: destination.maxAttempts,
              negativeMarkingEnabled: input.negativeMarks > 0,
              randomizeOptions: false,
              showResultImmediately: true,
              createdById: admin.id,
            },
            select: { id: true, title: true },
          });
          testId = test.id;
          title = test.title;
        } else {
          const test = await tx.test.findUniqueOrThrow({
            where: { id: destination.testId! },
            select: { id: true, title: true },
          });
          testId = test.id;
          title = test.title;
        }

        // A question already on this test is left where it is. Re-importing a
        // corrected paper onto the same test should not print every question
        // twice, and the same destination picked twice is a slip, not a
        // request for duplicates.
        const already = new Set(
          (
            await tx.testQuestion.findMany({
              where: { testId, questionId: { in: createdIds } },
              select: { questionId: true },
            })
          ).map((row) => row.questionId),
        );

        const toAttach = createdIds.filter((id) => !already.has(id));
        const offset = await tx.testQuestion.count({ where: { testId } });

        if (toAttach.length > 0) {
          await tx.testQuestion.createMany({
            data: toAttach.map((questionId, index) => ({
              testId,
              questionId,
              sortOrder: offset + index + 1,
              marks: input.marks,
              negativeMarks: input.negativeMarks,
            })),
          });
        }

        attached.push({ testId, title, added: toAttach.length, skipped: already.size });
      }

      return { createdIds, attached };
    },
    // A 300-question import does a lot of inserts; the default 5s is not enough.
    { timeout: 120_000, maxWait: 20_000 },
  );

  // Totals are recomputed per destination, outside the transaction: each is an
  // independent aggregate and a slow recount should not hold the write lock.
  for (const row of result.attached) await refreshTestTotals(row.testId);

  await audit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: AUDIT_ACTIONS.QUESTION_IMPORTED,
    entityType: 'Question',
    meta: {
      count: result.createdIds.length,
      destinations: result.attached.map((row) => ({
        testId: row.testId,
        title: row.title,
        added: row.added,
        skipped: row.skipped,
      })),
      source: input.source,
      published: input.publish,
    },
    ipAddress: ip,
  });

  // Admins write English only. Queue the new questions for Kannada now,
  // stems then solutions, rather than waiting for the worker's next scan -
  // so a paper imported today reads in Kannada as soon as it is published.
  const worker = translationWorker();
  worker.request(result.createdIds.map((qid) => `stem:${qid}` as const));
  worker.request(result.createdIds.map((qid) => `solution:${qid}` as const));
  for (const row of result.attached) worker.request([`test:${row.testId}` as const]);

  const totalSkipped = result.attached.reduce((sum, row) => sum + row.skipped, 0);
  const places = result.attached.length;

  return {
    data: {
      created: result.createdIds.length,
      destinations: result.attached,
      // The first destination, so a caller that expects one still works.
      testId: result.attached[0]?.testId ?? null,
      status,
    },
    message:
      places === 0
        ? `Imported ${result.createdIds.length} questions into the bank.`
        : `Imported ${result.createdIds.length} questions into ${places} ${places === 1 ? 'test' : 'tests'}` +
          (totalSkipped > 0 ? `, skipping ${totalSkipped} already present.` : '.'),
    status: 201,
  };
});
