import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, FileText, Lock, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { AnalysisDocument } from '@/features/student/analysis-document';
import { formatPaise } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { checkSynopsisAccess } from '@/server/services/synopsis-service';
import { hasKannadaDocument } from '@/server/translation/document-translation';

export const metadata: Metadata = {
  title: 'Paper analysis',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * `/synopsis/[slug]` — the question-wise analysis for a previous-year paper.
 *
 * Every outcome other than "you may read this" is rendered as an explanation of
 * what is missing, rather than a 404 that leaves the student guessing.
 *
 * `?lang=kn` opens the Kannada copy, when there is one.
 */
export default async function SynopsisPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;
  const user = await enforceStudent(`/synopsis/${slug}`);
  const access = await checkSynopsisAccess(slug, user);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link href={`/pyq/${slug}`}>
        <ArrowLeft aria-hidden="true" />
        Back to the paper
      </Link>
    </Button>
  );

  if (access.state === 'NOT_PUBLISHED') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {back}
        <EmptyState
          icon={FileText}
          title="No analysis yet"
          description="The question-wise analysis for this paper has not been published. It will appear here once it is ready."
        />
      </div>
    );
  }

  if (access.state === 'PURCHASE_REQUIRED') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {back}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                The analysis is part of {access.seriesName}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Unlock the paper to read the full question-wise analysis — every question with its
                answer, the reasoning, the core concept and the likely future angle.
              </p>
            </div>
            <Button asChild size="lg" variant="brand">
              <Link href={`/pyq/${slug}`}>Unlock for {formatPaise(access.priceInPaise)}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (access.state === 'ATTEMPT_REQUIRED') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {back}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <ShieldAlert className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Attempt the paper first</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                The analysis contains every answer. Sit {access.seriesName} first — it is worth far
                more once you know which questions you actually got wrong.
              </p>
            </div>
            <Button asChild size="lg" variant="brand">
              <Link href={`/pyq/${slug}`}>Go to the paper</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const kannada = await hasKannadaDocument(access.fileName);

  return (
    <AnalysisDocument
      src={`/api/synopsis/${slug}`}
      backHref={`/pyq/${slug}`}
      kannada={kannada}
      initialLanguage={lang === 'kn' ? 'kn' : lang === 'en' ? 'en' : null}
      text={{
        en: {
          title: `${access.seriesName} — Analysis`,
          description:
            'Question-wise analysis: answer, reasoning, core concept and future angle for all 100 questions. Reading only — this document is not available for download.',
          back: 'Back to the paper',
        },
        kn: {
          title: `${access.seriesName} — ವಿಶ್ಲೇಷಣೆ`,
          description:
            'ಪ್ರಶ್ನಾವಾರು ವಿಶ್ಲೇಷಣೆ: ಎಲ್ಲಾ 100 ಪ್ರಶ್ನೆಗಳ ಉತ್ತರ, ತರ್ಕ, ಮೂಲ ಪರಿಕಲ್ಪನೆ ಮತ್ತು ಭವಿಷ್ಯದ ದೃಷ್ಟಿಕೋನ. ಓದಲು ಮಾತ್ರ — ಈ ದಾಖಲೆಯನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.',
          back: 'ಪತ್ರಿಕೆಗೆ ಹಿಂತಿರುಗಿ',
        },
      }}
    />
  );
}
