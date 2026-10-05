import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CoachChat } from '@/features/ai/coach-chat';
import { enforceStudent } from '@/server/auth/guards';
import { getAiAllowance, getCoachSuggestions } from '@/server/services/ai-coach-service';
import { getAnalyticsOverview } from '@/server/services/analytics-service';

export const metadata: Metadata = {
  title: 'AVK AI Coach',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * `/ai-coach` - always on. With an AI model connected it answers through the
 * model; without one, from its own built-in answers. Either way every figure
 * it gives comes from the student's own results.
 */
export default async function AiCoachPage() {
  const user = await enforceStudent('/ai-coach');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary-muted text-primary">
            <BrainCircuit className="size-5" aria-hidden="true" />
          </span>
          AVK AI Coach
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A study advisor that can see your actual results, not a generic chatbot.
        </p>
      </header>

      <EnabledCoach userId={user.id} />
    </div>
  );
}

async function EnabledCoach({ userId }: { userId: string }) {
  const [suggestions, allowance, overview] = await Promise.all([
    getCoachSuggestions(userId),
    getAiAllowance(userId),
    getAnalyticsOverview(userId),
  ]);

  return (
    <>
      {overview.questionsAnswered === 0 && (
        <Card variant="accent">
          <CardContent className="p-5">
            <p className="text-sm leading-relaxed">
              You have not answered any questions yet, so the coach has nothing about you to work
              from. It can still answer general preparation questions — but attempt a test or a
              quiz and its advice becomes specific to you.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/practice">Take a quiz</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <CoachChat suggestions={suggestions} allowance={allowance} />
    </>
  );
}
