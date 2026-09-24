'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileUp,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { InlineError } from '@/components/ui/states';
import { ApiClientError, api } from '@/lib/api-client';
import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '@/lib/marking';
import { cn } from '@/lib/utils';
import { DestinationPicker, type PickerGroup } from '@/features/admin/destination-picker';

/**
 * PDF import.
 *
 * Three steps, and the middle one is the point of the whole feature: upload →
 * **review** → commit. A parser working on arbitrary PDFs will get things
 * wrong, and a wrong answer key is invisible until a student is marked
 * incorrectly. So nothing is written until a human has looked at every
 * question, and any question whose key could not be resolved blocks the import
 * until it is set by hand.
 */
/**
 * Whether a question's wording depends on something it has to show.
 *
 * Used only to warn: a question saying "in the figure below" with no figure is
 * unanswerable, and that is invisible in a text-only import. Over-matching
 * costs a dismissible warning, so this errs towards asking.
 */
function needsFigure(body: string): boolean {
  return /(figure|diagram|map|graph|chart|image|picture|given below|shown above|following pattern)/i.test(
    body,
  );
}

interface ParsedOption {
  marker: string;
  body: string;
}

interface ParsedQuestion {
  number: number;
  body: string;
  options: ParsedOption[];
  correctIndex: number | null;
  rawAnswer: string | null;
  /** The worked explanation, where the paper printed one. */
  explanation?: string | null;
  warnings: string[];
  /** The diagram this question needs, if the parser found one. */
  imageUrl?: string;
}

interface ParsedFigure {
  questionNumber: number | null;
  page: number;
  url: string;
  width: number;
  height: number;
}

interface ParseResponse {
  fileName: string;
  pageCount: number;
  questions: ParsedQuestion[];
  stats: { found: number; withAnswer: number; withoutAnswer: number; withWarnings: number };
  documentWarnings: string[];
  extractedText: string;
  figures: ParsedFigure[];
  figureWarnings: string[];
}

export interface ImportTarget {
  exams: {
    id: string;
    name: string;
    shortName: string;
    subjects: { id: string; name: string }[];
  }[];
  series: { id: string; name: string; track: string }[];
  tests: { id: string; title: string }[];
  /** Existing tests grouped by series, for the destination picker. */
  groups: PickerGroup[];
}

interface CommitResponse {
  created: number;
  testId: string | null;
  destinations: { testId: string; title: string; added: number; skipped: number }[];
}

type Step = 'upload' | 'review' | 'done';

export function PdfImport({ exams, series, tests, groups }: ImportTarget) {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>('upload');
  const [parsing, setParsing] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<ParseResponse | null>(null);
  const [questions, setQuestions] = React.useState<ParsedQuestion[]>([]);
  const [showText, setShowText] = React.useState(false);
  const [result, setResult] = React.useState<CommitResponse | null>(null);

  // --- Destination -------------------------------------------------------
  const [examId, setExamId] = React.useState(exams[0]?.id ?? '');
  // Starts empty on purpose. It used to default to the exam's first subject,
  // Indian Polity, so every paper imported without touching this dropdown had
  // all its questions filed under Polity — history, geography and economy
  // included — and printed that way on every exported PDF.
  const [subjectId, setSubjectId] = React.useState('');
  const [target, setTarget] = React.useState<'NEW_TEST' | 'EXISTING_TEST' | 'BANK_ONLY'>('NEW_TEST');
  /**
   * Existing tests this import should also fill.
   *
   * Independent of `target`: a paper can create a new test *and* land in three
   * existing ones in the same commit, because the questions are created once
   * and linked to each.
   */
  const [pickedTestIds, setPickedTestIds] = React.useState<string[]>([]);
  const [testId, setTestId] = React.useState(tests[0]?.id ?? '');
  const [title, setTitle] = React.useState('');
  const [testSeriesId, setTestSeriesId] = React.useState('');
  const [category, setCategory] = React.useState('PREVIOUS_YEAR');
  const [accessType, setAccessType] = React.useState('FREE');
  const [durationMinutes, setDurationMinutes] = React.useState(120);
  const [marks, setMarks] = React.useState(MARKS_PER_QUESTION);
  const [negativeMarks, setNegativeMarks] = React.useState(NEGATIVE_MARKS_PER_QUESTION);
  const [source, setSource] = React.useState('');
  const [examYear, setExamYear] = React.useState<string>('');
  const [publish, setPublish] = React.useState(false);

  const exam = exams.find((e) => e.id === examId);

  // Sending one paper to a free and a paid test publishes the paid content for
  // nothing. Worth saying out loud rather than refusing: an admin may well
  // intend a sample paper to overlap with the free tier.
  const mixedAccess = React.useMemo(() => {
    const chosen = groups.flatMap((g) => g.tests).filter((t) => pickedTestIds.includes(t.id));
    const kinds = new Set(chosen.map((t) => t.accessType));
    if (target === 'NEW_TEST') kinds.add(accessType);
    return kinds.has('FREE') && (kinds.has('PAID') || kinds.has('SUBSCRIPTION'));
  }, [groups, pickedTestIds, target, accessType]);

  // A figure leaves this list as soon as some question is showing it, so
  // assigning one from the tray makes it disappear from the tray.
  const unassignedFigures = React.useMemo(() => {
    const used = new Set(questions.map((q) => q.imageUrl).filter(Boolean));
    return (parsed?.figures ?? []).filter((figure) => !used.has(figure.url));
  }, [parsed, questions]);

  const unresolved = questions.filter((q) => q.correctIndex === null).length;
  const invalid = questions.filter((q) => q.options.length < 2 || !q.body.trim()).length;

  /**
   * Why Import cannot be pressed yet, or null when it can.
   *
   * The button and the message beside it both read this, so it is never
   * disabled without saying why. It used to be: the subject became required
   * and the bar still read "30 questions ready to import" over a greyed-out
   * button, with the missing dropdown a long scroll above.
   */
  const blocker: string | null =
    questions.length === 0
      ? 'There are no questions to import'
      : !subjectId
        ? 'Choose a subject for these questions'
        : unresolved > 0
          ? `${unresolved} question${unresolved === 1 ? '' : 's'} still need${unresolved === 1 ? 's' : ''} an answer`
          : invalid > 0
            ? `${invalid} question${invalid === 1 ? ' is' : 's are'} incomplete`
            : target === 'NEW_TEST' && title.trim().length < 3
              ? 'Give the new test a title'
              : null;

  // --- Upload ------------------------------------------------------------
  async function upload(file: File) {
    setParsing(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);

    try {
      // Not `api.post` — this is multipart, so the JSON content-type must not
      // be set; the browser supplies the boundary.
      const response = await fetch('/api/admin/import/parse', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const payload = await response.json();

      if (!payload.success) {
        setError(payload.error?.message ?? 'That file could not be read.');
        return;
      }

      const data = payload.data as ParseResponse;
      setParsed(data);

      // Hand each figure to the question it was printed under, so the admin
      // reviews the question and its diagram together rather than matching them
      // up afterwards. Where a page carries several, the first wins and the
      // rest stay in the unassigned list to be placed by hand.
      const byQuestion = new Map<number, string>();
      for (const figure of data.figures) {
        if (figure.questionNumber === null) continue;
        if (!byQuestion.has(figure.questionNumber)) {
          byQuestion.set(figure.questionNumber, figure.url);
        }
      }

      setQuestions(
        data.questions.map((question) => {
          const url = byQuestion.get(question.number);
          return url ? { ...question, imageUrl: url } : question;
        }),
      );
      if (!title) setTitle(data.fileName.replace(/\.pdf$/i, ''));
      if (!source) setSource(data.fileName.replace(/\.pdf$/i, ''));
      setStep('review');
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setParsing(false);
    }
  }

  // --- Review editing ----------------------------------------------------
  function updateQuestion(index: number, patch: Partial<ParsedQuestion>) {
    setQuestions((previous) =>
      previous.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    );
  }

  function updateOption(qIndex: number, oIndex: number, body: string) {
    setQuestions((previous) =>
      previous.map((question, i) =>
        i === qIndex
          ? {
              ...question,
              options: question.options.map((option, j) =>
                j === oIndex ? { ...option, body } : option,
              ),
            }
          : question,
      ),
    );
  }

  function removeQuestion(index: number) {
    setQuestions((previous) => previous.filter((_, i) => i !== index));
  }

  // --- Commit ------------------------------------------------------------
  async function commit() {
    if (blocker) return;

    setCommitting(true);
    setError(null);

    // One list, whatever the admin picked: a new test if they asked for one,
    // plus every existing test they ticked. Empty means the bank only.
    const destinations = [
      ...(target === 'NEW_TEST'
        ? [
            {
              kind: 'NEW_TEST' as const,
              title,
              ...(testSeriesId ? { testSeriesId } : {}),
              category,
              accessType,
              durationMinutes,
            },
          ]
        : []),
      ...pickedTestIds.map((id) => ({ kind: 'EXISTING_TEST' as const, testId: id })),
    ];

    try {
      const data = await api.post<CommitResponse>(
        '/api/admin/import/commit',
        {
          examId,
          subjectId,
          destinations,
          marks,
          negativeMarks,
          ...(source ? { source } : {}),
          ...(examYear ? { examYear: Number(examYear) } : {}),
          publish,
          questions: questions.map((q) => ({
            number: q.number,
            body: q.body,
            options: q.options.map((o) => ({ body: o.body })),
            correctIndex: q.correctIndex!,
            ...(q.explanation?.trim() ? { explanation: q.explanation.trim() } : {}),
            ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}),
          })),
        },
      );

      setResult(data);
      setStep('done');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? (Object.values(caught.fieldErrors ?? {})[0]?.[0] ?? caught.message)
          : 'The import failed. Nothing was saved.',
      );
    } finally {
      setCommitting(false);
    }
  }

  // =======================================================================
  if (step === 'done' && result) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">
            Imported {result.created} question{result.created === 1 ? '' : 's'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            {publish
              ? 'The questions are published.'
              : 'The questions were created as drafts — publish them when you are happy.'}
            {result.destinations.length === 0 && ' They are in the question bank, not yet on a test.'}
          </p>

          {/* Every place they landed, and anything skipped because it was
              already there — silence would look like the import missed them. */}
          {result.destinations.length > 0 && (
            <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left">
              {result.destinations.map((row) => (
                <li
                  key={row.testId}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    +{row.added}
                    {row.skipped > 0 && ` · ${row.skipped} already there`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {result.testId && (
              <Button asChild>
                <a href={`/admin/tests/${result.testId}`}>Open the test</a>
              </Button>
            )}
            <Button asChild variant="outline">
              <a href="/admin/questions">View question bank</a>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep('upload');
                setParsed(null);
                setQuestions([]);
                setResult(null);
              }}
            >
              Import another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // =======================================================================
  if (step === 'upload') {
    return (
      <div className="space-y-5">
        {error && <InlineError message={error} />}

        <Card>
          <CardContent className="p-6">
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-14 text-center transition-colors',
                'hover:border-primary/50 hover:bg-muted/30',
                parsing && 'pointer-events-none opacity-60',
              )}
            >
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={parsing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />

              {parsing ? (
                <>
                  <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
                  <p className="mt-3 font-medium">Reading the PDF…</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A 100-question paper takes a few seconds.
                  </p>
                </>
              ) : (
                <>
                  <span className="flex size-14 items-center justify-center rounded-full bg-primary-muted text-primary">
                    <FileUp className="size-6" aria-hidden="true" />
                  </span>
                  <p className="mt-4 font-medium">Choose a question paper PDF</p>
                  <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                    Questions, options and the answer key are extracted. You review everything
                    before anything is saved.
                  </p>
                </>
              )}
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">What the parser understands</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Question markers
                </p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                  <li>Q1. / Q.1 / Question 1</li>
                  <li>1. / 1)</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Option markers
                </p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                  <li>1. 2. 3. 4.</li>
                  <li>(a) (b) (c) (d)</li>
                  <li>A) B) C) D)</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Answer lines
                </p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                  <li>CORRECT ANSWER: 1</li>
                  <li>Answer: A / Ans: (a)</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Not supported
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  <li>Scanned PDFs — they hold images, not text, and need OCR first</li>
                  <li>Diagrams and images inside questions</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =======================================================================
  return (
    <div className="space-y-5">
      {error && <InlineError message={error} />}

      {/* Parse summary --------------------------------------------------- */}
      <Card variant={unresolved > 0 ? 'accent' : 'default'}>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold tracking-tight">{parsed?.fileName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {parsed?.pageCount} pages · {questions.length} questions to import
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{questions.length - unresolved} keyed</Badge>
              {unresolved > 0 && <Badge variant="danger">{unresolved} need an answer</Badge>}
              {parsed && parsed.stats.withWarnings > 0 && (
                <Badge variant="warning">{parsed.stats.withWarnings} with warnings</Badge>
              )}
            </div>
          </div>

          {parsed && [...parsed.documentWarnings, ...parsed.figureWarnings].length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {[...parsed.documentWarnings, ...parsed.figureWarnings].map((warning) => (
                <li
                  key={warning}
                  className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          )}

          {unassignedFigures.length > 0 && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3.5">
              <p className="text-sm font-medium">
                {unassignedFigures.length} diagram
                {unassignedFigures.length === 1 ? '' : 's'} not matched to a question
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pick the question each one belongs to. Anything left here is discarded.
              </p>

              <ul className="mt-3 flex flex-wrap gap-3">
                {unassignedFigures.map((figure) => (
                  <li
                    key={figure.url}
                    className="w-44 rounded-lg border border-border bg-card p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={figure.url}
                      alt={`Unassigned diagram from page ${figure.page}`}
                      className="h-24 w-full rounded border border-border bg-white object-contain"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">Page {figure.page}</p>
                    <select
                      value=""
                      onChange={(event) => {
                        const index = Number(event.target.value);
                        if (Number.isInteger(index)) {
                          updateQuestion(index, { imageUrl: figure.url });
                        }
                      }}
                      aria-label={`Assign the diagram from page ${figure.page} to a question`}
                      className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
                    >
                      <option value="">Assign to…</option>
                      {questions.map((question, index) => (
                        <option key={question.number} value={index}>
                          Q{question.number}
                          {question.imageUrl ? ' (replace)' : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unresolved > 0 && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {unresolved} question{unresolved === 1 ? '' : 's'} still {unresolved === 1 ? 'has' : 'have'} no
              correct answer set. The parser will not guess one — set them below, or remove those
              questions, before importing.
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => setShowText((v) => !v)}
          >
            {showText ? 'Hide' : 'Show'} extracted text
          </Button>

          {showText && (
            <pre className="scrollbar-slim mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {parsed?.extractedText}
            </pre>
          )}
        </CardContent>
      </Card>

      {/* Destination ------------------------------------------------------ */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Where do these go?</h2>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['NEW_TEST', 'Create a new test', 'Best for a PYQ paper'],
                ['EXISTING_TEST', 'Existing tests only', 'Pick them below'],
                ['BANK_ONLY', 'Question bank only', 'Attach to a test later'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTarget(value)}
                aria-pressed={target === value}
                className={cn(
                  'rounded-xl border p-3.5 text-left transition-colors',
                  target === value ? 'border-primary bg-primary-muted' : 'border-border hover:bg-muted/50',
                )}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Exam" htmlFor="i-exam" required>
              <select
                id="i-exam"
                value={examId}
                onChange={(event) => {
                  const next = exams.find((e) => e.id === event.target.value);
                  setExamId(event.target.value);
                  setSubjectId('');
                }}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {exams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Subject"
              htmlFor="i-subject"
              required
              hint="Every question in this import is filed under the subject you pick. For a mixed paper, choose the main one and correct the rest in review."
            >
              <select
                id="i-subject"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Choose a subject
                </option>
                {(exam?.subjects ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {target === 'NEW_TEST' && (
            <>
              <FormField label="Test title" htmlFor="i-title" required>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Test series" htmlFor="i-series" hint="Optional">
                  <select
                    id="i-series"
                    value={testSeriesId}
                    onChange={(event) => setTestSeriesId(event.target.value)}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Standalone</option>
                    {series.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Category" htmlFor="i-cat">
                  <select
                    id="i-cat"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    {['PREVIOUS_YEAR', 'FULL_MOCK', 'SECTIONAL', 'TOPIC', 'CUSTOM'].map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Duration (min)" htmlFor="i-dur">
                  <Input
                    type="number"
                    min={1}
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  />
                </FormField>
              </div>

              <FormField label="Access" htmlFor="i-access">
                <select
                  id="i-access"
                  value={accessType}
                  onChange={(event) => setAccessType(event.target.value)}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {['FREE', 'PAID', 'SUBSCRIPTION'].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}

          {/* Existing tests, any number of them. The questions are created
              once and linked to each, so filling a subject drill and a mock
              from one paper costs nothing extra and keeps them in step. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {target === 'NEW_TEST' ? 'Also add to existing tests' : 'Add to existing tests'}
                <span className="ml-1.5 font-normal text-muted-foreground">optional</span>
              </p>
              {pickedTestIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPickedTestIds([])}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  Clear {pickedTestIds.length} selected
                </button>
              )}
            </div>

            <DestinationPicker groups={groups} selected={pickedTestIds} onChange={setPickedTestIds} />

            {mixedAccess && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                These questions are going to both free and paid tests. Anyone can read them in the
                free one, so the paid papers gain nothing they could not already see.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Marks" htmlFor="i-marks">
              <Input
                type="number"
                step="0.25"
                min={0.25}
                value={marks}
                onChange={(event) => setMarks(Number(event.target.value))}
              />
            </FormField>
            <FormField label="Negative" htmlFor="i-neg">
              <Input
                type="number"
                step="0.25"
                min={0}
                value={negativeMarks}
                onChange={(event) => setNegativeMarks(Number(event.target.value))}
              />
            </FormField>
            <FormField label="Source" htmlFor="i-source">
              <Input value={source} onChange={(event) => setSource(event.target.value)} />
            </FormField>
            <FormField label="Exam year" htmlFor="i-year">
              <Input
                type="number"
                min={1950}
                max={2100}
                value={examYear}
                onChange={(event) => setExamYear(event.target.value)}
              />
            </FormField>
          </div>

          <label className="flex items-start gap-3 border-t border-border pt-4">
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
              className="mt-1 size-4 rounded border-input"
            />
            <span>
              <span className="block text-sm font-medium">Publish the questions immediately</span>
              <span className="block text-xs text-muted-foreground">
                Off by default. Drafts let you check the import before students can see anything.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Review ----------------------------------------------------------- */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Review every question
        </h2>

        <ul className="mt-3 space-y-3">
          {questions.map((question, qIndex) => {
            const needsKey = question.correctIndex === null;

            return (
              <li
                key={`${question.number}-${qIndex}`}
                className={cn(
                  'rounded-xl border bg-card p-4',
                  needsKey ? 'border-destructive/40' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Q{question.number}
                  </span>
                  {needsKey ? (
                    <Badge variant="danger" size="sm">
                      Set the correct answer
                    </Badge>
                  ) : (
                    <Badge variant="success" size="sm">
                      Answer: {String.fromCharCode(65 + question.correctIndex!)}
                    </Badge>
                  )}
                  {question.rawAnswer && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {question.rawAnswer}
                    </span>
                  )}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => removeQuestion(qIndex)}
                    aria-label={`Remove question ${question.number} from this import`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>

                {question.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {question.warnings.map((warning) => (
                      <li key={warning} className="flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}

                <Textarea
                  value={question.body}
                  onChange={(event) => updateQuestion(qIndex, { body: event.target.value })}
                  rows={2}
                  className="mt-3"
                  aria-label={`Question ${question.number} text`}
                />

                {question.imageUrl ? (
                  <div className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="text-xs text-muted-foreground">
                        Diagram shown with this question
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => updateQuestion(qIndex, { imageUrl: undefined })}
                      >
                        Remove
                      </Button>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={question.imageUrl}
                      alt={`Diagram for question ${question.number}`}
                      className="mt-2 max-h-56 rounded border border-border bg-white"
                    />
                  </div>
                ) : (
                  needsFigure(question.body) && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      This question refers to a figure but has none. Assign one below, or add it
                      later from the question editor.
                    </p>
                  )
                )}

                <ul className="mt-2.5 space-y-2">
                  {question.options.map((option, oIndex) => (
                    <li key={oIndex} className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => updateQuestion(qIndex, { correctIndex: oIndex })}
                        aria-pressed={question.correctIndex === oIndex}
                        aria-label={`Mark option ${String.fromCharCode(65 + oIndex)} correct`}
                        className={cn(
                          'mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          question.correctIndex === oIndex
                            ? 'border-success bg-success text-white'
                            : 'border-input text-muted-foreground hover:border-success/50',
                        )}
                      >
                        {question.correctIndex === oIndex ? (
                          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                        ) : (
                          String.fromCharCode(65 + oIndex)
                        )}
                      </button>

                      <Textarea
                        value={option.body}
                        onChange={(event) => updateOption(qIndex, oIndex, event.target.value)}
                        rows={1}
                        className="min-h-[40px] flex-1 text-sm"
                        aria-label={`Option ${String.fromCharCode(65 + oIndex)}`}
                      />
                    </li>
                  ))}
                </ul>

                {/* Shown so a reviewer can see what will be stored and correct
                    it. A paper that prints no explanation leaves this empty,
                    and nothing is invented to fill it. */}
                <div className="mt-3">
                  <label
                    htmlFor={`explanation-${qIndex}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Explanation{' '}
                    {question.explanation ? (
                      <span className="text-success">· read from the paper</span>
                    ) : (
                      <span>· none printed; optional</span>
                    )}
                  </label>
                  <Textarea
                    id={`explanation-${qIndex}`}
                    value={question.explanation ?? ''}
                    onChange={(event) =>
                      updateQuestion(qIndex, { explanation: event.target.value })
                    }
                    rows={2}
                    className="mt-1 text-sm"
                    placeholder="Why this answer is right — shown to a student after they finish."
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Commit ------------------------------------------------------------ */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 p-4 shadow-elevated backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {blocker ? (
            <span className="font-medium text-destructive" role="status">
              {blocker}
            </span>
          ) : (
            <span className="text-muted-foreground" role="status">
              {questions.length} questions ready to import
            </span>
          )}

          {/* The subject, offered right here when it is what is missing, so the
              fix is beside the button rather than above thirty questions. It
              is the same state as the dropdown in "Where do these go?". */}
          {!subjectId && questions.length > 0 && (
            <select
              aria-label="Subject for these questions"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              className="h-9 rounded-lg border border-destructive/60 bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Choose a subject…
              </option>
              {(exam?.subjects ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep('upload')} disabled={committing}>
            Start over
          </Button>
          <Button
            onClick={commit}
            loading={committing}
            loadingText="Importing…"
            disabled={blocker !== null}
          >
            <Upload aria-hidden="true" />
            Import {questions.length}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
