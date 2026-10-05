'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rememberLanguage, storedLanguage, type ExamLanguage } from '@/features/exam/exam-language';
import { SynopsisViewer } from '@/features/student/synopsis-viewer';
import { cn } from '@/lib/utils';

export interface AnalysisText {
  title: string;
  description: string;
  back: string;
}

/**
 * A paper's analysis PDF, in English or in Kannada.
 *
 * The switch appears only when the Kannada copy exists and is current: it is
 * made in the background from the English the moment an admin uploads it, so
 * a student never meets a half-made one or a "being prepared" notice. The
 * choice is the same one the test screen remembers, so a student who sits
 * papers in Kannada opens their analyses in Kannada too.
 */
export function AnalysisDocument({
  src,
  backHref,
  kannada,
  initialLanguage,
  text,
}: {
  /** The English document's address; the Kannada copy is the same with `?lang=kn`. */
  src: string;
  backHref: string;
  /** Whether a current Kannada copy exists. */
  kannada: boolean;
  /** From `?lang=` in the address, when the link chose the language. */
  initialLanguage: ExamLanguage | null;
  text: Record<ExamLanguage, AnalysisText>;
}) {
  const [language, setLanguage] = React.useState<ExamLanguage>(kannada && initialLanguage === 'kn' ? 'kn' : 'en');

  // No language in the address: the one this student last chose anywhere.
  React.useEffect(() => {
    if (kannada && !initialLanguage && storedLanguage() === 'kn') setLanguage('kn');
  }, [kannada, initialLanguage]);

  function choose(next: ExamLanguage) {
    setLanguage(next);
    rememberLanguage(next);
    const url = new URL(window.location.href);
    if (next === 'kn') url.searchParams.set('lang', 'kn');
    else url.searchParams.delete('lang');
    window.history.replaceState(window.history.state, '', url);
  }

  const shown: ExamLanguage = kannada ? language : 'en';
  const copy = text[shown];

  return (
    <div className="mx-auto max-w-5xl space-y-4" lang={shown}>
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href={backHref}>
          <ArrowLeft aria-hidden="true" />
          {copy.back}
        </Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>

        {kannada && (
          <div
            className="flex shrink-0 items-center rounded-lg border border-border bg-card p-1 text-sm font-semibold shadow-subtle"
            role="group"
            aria-label="Language / ಭಾಷೆ"
            data-testid="analysis-language"
          >
            <Languages className="mx-1.5 size-4 text-muted-foreground" aria-hidden="true" />
            {(['en', 'kn'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => choose(option)}
                aria-pressed={shown === option}
                className={cn(
                  'rounded-md px-3 py-1.5 transition-colors',
                  shown === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {option === 'en' ? 'English' : 'ಕನ್ನಡ'}
              </button>
            ))}
          </div>
        )}
      </header>

      <SynopsisViewer
        key={shown}
        src={shown === 'kn' ? `${src}?lang=kn` : src}
        title={copy.title}
        language={shown}
      />
    </div>
  );
}
