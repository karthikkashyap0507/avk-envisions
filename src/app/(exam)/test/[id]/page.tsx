import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ExamEngine } from '@/features/exam/exam-engine';
import { StartScreen } from '@/features/exam/start-screen';
import { TERMINAL_ATTEMPT_STATUSES } from '@/lib/enums';
import { currentUser, enforceStudent } from '@/server/auth/guards';
import { db } from '@/server/db';
import { getAttemptState } from '@/server/services/attempt-service';

export const metadata: Metadata = {
  title: 'Test',
  robots: { index: false, follow: false },
};

/** Never cache: an in-flight attempt's state and clock must always be live. */
export const dynamic = 'force-dynamic';

/**
 * `/test/[id]` accepts either identifier and routes accordingly:
 *
 *   • a **Test** id     → the pre-test briefing screen
 *   • an **Attempt** id → the live engine, or a redirect to the result if the
 *                         attempt is already finished
 *
 * Accepting both is what lets "Resume test" on the dashboard and "Start test"
 * in the catalogue share one URL shape, and means a student who bookmarks the
 * page mid-attempt lands somewhere sensible afterwards.
 */
export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const language = query.lang === 'kn' ? 'kn' : undefined;

  // A signed-out visitor heading for a free test is offered the guest route —
  // name and phone number — rather than a login wall. Anything else (a paid
  // test, or an attempt id that is not theirs) still falls through to sign-in.
  if (!(await currentUser())) {
    const freeTest = await db.test.findFirst({
      where: { id, deletedAt: null, status: 'PUBLISHED', accessType: 'FREE' },
      select: { id: true },
    });
    if (freeTest) redirect(`/start/${freeTest.id}`);
  }

  const user = await enforceStudent(`/test/${id}`);

  // --- Attempt? ----------------------------------------------------------
  const attempt = await db.testAttempt.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true, expiresAt: true },
  });

  if (attempt) {
    if (TERMINAL_ATTEMPT_STATUSES.includes(attempt.status as never)) {
      redirect(`/test/${attempt.id}/result`);
    }

    // Expired but not yet finalised: send it to the result route, which
    // finalises before rendering rather than reopening a dead paper.
    if (attempt.expiresAt.getTime() <= Date.now()) {
      redirect(`/test/${attempt.id}/result`);
    }

    const state = await getAttemptState(attempt.id, user.id);

    return (
      <ExamEngine
        attemptId={state.attemptId}
        title={state.title}
        mode={state.mode}
        navigationMode={state.navigationMode}
        totalMarks={state.totalMarks}
        sections={state.sections.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder }))}
        questions={state.questions}
        initialAnswers={state.answers}
        serverTime={state.serverTime}
        expiresAt={state.expiresAt}
        initialLanguage={language}
      />
    );
  }

  // --- Test? -------------------------------------------------------------
  const test = await db.test.findFirst({
    where: { id, deletedAt: null, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      description: true,
      instructions: true,
      durationMinutes: true,
      totalQuestions: true,
      totalMarks: true,
      negativeMarkingEnabled: true,
      maxAttempts: true,
      exam: { select: { name: true } },
    },
  });

  if (!test) notFound();

  const attemptsUsed = await db.testAttempt.count({
    where: {
      testId: test.id,
      userId: user.id,
      status: { in: [...TERMINAL_ATTEMPT_STATUSES] },
    },
  });

  return (
    <StartScreen
      test={{
        id: test.id,
        title: test.title,
        description: test.description,
        instructions: test.instructions,
        durationMinutes: test.durationMinutes,
        totalQuestions: test.totalQuestions,
        totalMarks: test.totalMarks,
        negativeMarkingEnabled: test.negativeMarkingEnabled,
        maxAttempts: test.maxAttempts,
        examName: test.exam.name,
      }}
      attemptsUsed={attemptsUsed}
    />
  );
}
