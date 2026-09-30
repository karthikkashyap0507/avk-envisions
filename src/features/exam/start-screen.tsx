'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Clock, FileQuestion, Languages, Loader2, Target, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { Logo } from '@/components/site/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiClientError, api } from '@/lib/api-client';
import { cn, formatDuration } from '@/lib/utils';

import {
  START_TEXT,
  TAKE_IN_KANNADA,
  kannadaProgress,
  rememberLanguage,
  storedLanguage,
  useStartTranslation,
  type ExamLanguage,
} from './exam-language';

/**
 * Pre-test briefing.
 *
 * The last screen before a timed attempt begins, so it states the marking
 * scheme and the recovery behaviour plainly. A student should never discover
 * mid-paper that wrong answers carry a penalty, or worry that a dropped
 * connection has cost them their work.
 *
 * It is also where a student chooses to take the test in Kannada. Choosing it
 * starts the paper translating straight away, so most of it is ready by the
 * time they press Start; the rest follows while they work.
 */
export interface StartScreenProps {
  test: {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    durationMinutes: number;
    totalQuestions: number;
    totalMarks: number;
    negativeMarkingEnabled: boolean;
    maxAttempts: number;
    examName: string;
  };
  /** Attempts already used, for the allowance notice. */
  attemptsUsed: number;
}

export function StartScreen({ test, attemptsUsed }: StartScreenProps) {
  const router = useRouter();
  const [starting, setStarting] = React.useState<ExamLanguage | null>(null);
  const [language, setLanguage] = React.useState<ExamLanguage>('en');

  React.useEffect(() => {
    const remembered = storedLanguage();
    if (remembered) setLanguage(remembered);
  }, []);

  const s = START_TEXT[language];
  const kannada = useStartTranslation(test.id, language);
  const shown = language === 'kn' && kannada?.test ? kannada.test : null;

  const attemptsLeft = test.maxAttempts === 0 ? null : test.maxAttempts - attemptsUsed;
  const exhausted = attemptsLeft !== null && attemptsLeft <= 0;

  function choose(next: ExamLanguage) {
    setLanguage(next);
    rememberLanguage(next);
  }

  async function start(paperLanguage: ExamLanguage) {
    choose(paperLanguage);
    setStarting(paperLanguage);
    try {
      const result = await api.post<{ attemptId: string; resumed: boolean }>('/api/attempts', {
        testId: test.id,
      });
      if (result.resumed) toast.info(START_TEXT[paperLanguage].resuming);
      router.replace(`/test/${result.attemptId}${paperLanguage === 'kn' ? '?lang=kn' : ''}`);
    } catch (error) {
      setStarting(null);
      toast.error(error instanceof ApiClientError ? error.message : START_TEXT[paperLanguage].startFailed);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Logo />
          <div className="flex items-center gap-2">
            <div
              className="flex items-center rounded-lg border border-border p-0.5 text-xs font-semibold"
              role="group"
              aria-label="Language / ಭಾಷೆ"
            >
              <Languages className="mx-1 size-3.5 text-muted-foreground" aria-hidden="true" />
              {(['en', 'kn'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  aria-pressed={language === option}
                  className={cn(
                    'rounded-md px-2 py-1 transition-colors',
                    language === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {option === 'en' ? 'EN' : 'ಕನ್ನಡ'}
                </button>
              ))}
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/my-tests">
                <ArrowLeft aria-hidden="true" />
                <span className="hidden sm:inline">{s.myTests}</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="container flex-1 py-10">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {test.examName}
          </p>
          <h1 className="mt-2 text-balance text-display-sm" lang={shown ? 'kn' : undefined}>
            {shown?.title ?? test.title}
          </h1>
          {test.description && (
            <p className="mt-3 text-pretty leading-relaxed text-muted-foreground" lang={shown?.description ? 'kn' : undefined}>
              {shown?.description ?? test.description}
            </p>
          )}

          {language === 'kn' && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-muted/50 px-3 py-2 text-sm" role="status" lang="kn">
              {kannada === null || (kannada.engineAvailable && kannada.questionsReady < kannada.questionsTotal) ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <Languages className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              <span>
                {kannada === null
                  ? 'ಕನ್ನಡ ಅನುವಾದವನ್ನು ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ…'
                  : !kannada.engineAvailable
                    ? 'ಕನ್ನಡ ಅನುವಾದ ಸದ್ಯಕ್ಕೆ ಲಭ್ಯವಿಲ್ಲ; ಪರೀಕ್ಷೆ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತದೆ. · Kannada is unavailable right now.'
                    : kannadaProgress(kannada.questionsReady, kannada.questionsTotal)}
              </span>
            </p>
          )}

          <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: s.duration, value: formatDuration(test.durationMinutes * 60), icon: Clock },
              { label: s.questions, value: test.totalQuestions, icon: FileQuestion },
              { label: s.totalMarks, value: test.totalMarks, icon: Trophy },
              {
                label: s.attemptsLeft,
                value: attemptsLeft === null ? s.unlimited : attemptsLeft,
                icon: Target,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <Card className="mt-7">
            <CardContent className="p-6">
              <h2 className="font-semibold tracking-tight">{s.beforeYouBegin}</h2>

              {test.instructions ? (
                <p
                  className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
                  lang={shown?.instructions ? 'kn' : undefined}
                >
                  {shown?.instructions ?? test.instructions}
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  <li>{s.defaultMarks}</li>
                  {test.negativeMarkingEnabled && <li>{s.defaultPenalty}</li>}
                  <li>{s.defaultNavigation}</li>
                </ul>
              )}

              <div className="mt-5 space-y-2.5 border-t border-border pt-5 text-sm">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{s.timerNote}</span>
                </p>
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Target className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{s.saveNote}</span>
                </p>
              </div>
            </CardContent>
          </Card>

          {exhausted ? (
            <div className="mt-7 flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{s.exhausted(test.maxAttempts)}</span>
            </div>
          ) : (
            <div className="mt-7 space-y-3">
              <Button
                size="xl"
                variant="brand"
                fullWidth
                onClick={() => void start(language)}
                loading={starting === language}
                disabled={starting !== null}
                loadingText={s.preparing}
              >
                {s.start}
              </Button>

              {/* The other language, one tap away. In English this is the
                  "Take Test in Kannada" button, labelled in both scripts. */}
              {language === 'en' ? (
                <Button
                  size="lg"
                  variant="outline"
                  fullWidth
                  onClick={() => void start('kn')}
                  loading={starting === 'kn'}
                  disabled={starting !== null}
                  loadingText={START_TEXT.kn.preparing}
                  className="border-primary/40"
                >
                  <Languages aria-hidden="true" />
                  <span lang="kn">{TAKE_IN_KANNADA.kn}</span>
                  <span className="text-muted-foreground">· {TAKE_IN_KANNADA.en}</span>
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="ghost"
                  fullWidth
                  onClick={() => void start('en')}
                  loading={starting === 'en'}
                  disabled={starting !== null}
                  loadingText={START_TEXT.en.preparing}
                >
                  Take the test in English instead
                </Button>
              )}
            </div>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">{s.noPause}</p>
        </div>
      </main>
    </div>
  );
}
