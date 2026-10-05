import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PracticeRunner } from '@/features/practice/practice-runner';
import { enforceStudent } from '@/server/auth/guards';
import { getPracticeSession } from '@/server/services/practice-service';

export const metadata: Metadata = {
  title: 'Quiz',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await enforceStudent(`/practice/${id}`);

  const session = await getPracticeSession(id, user.id).catch(() => null);
  if (!session) notFound();

  // A closed session belongs on the summary, not back in the runner.
  if (session.status !== 'IN_PROGRESS') redirect(`/practice/${id}/summary`);

  if (session.questions.length === 0) notFound();

  return (
    <PracticeRunner
      sessionId={session.id}
      scope={session.scope}
      source={session.source}
      questions={session.questions}
      initialCorrect={session.correctCount}
      initialAttempted={session.attemptedCount}
    />
  );
}
