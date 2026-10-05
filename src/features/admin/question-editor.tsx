'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { InlineError } from '@/components/ui/states';
import { ApiClientError, api } from '@/lib/api-client';
import { DeleteQuestion } from '@/features/admin/delete-question';
import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '@/lib/marking';

import { FigurePicker } from './figure-picker';
import { cn } from '@/lib/utils';

/**
 * Question editor.
 *
 * The correct-answer control is the most important thing on this screen, so it
 * is a large, unmissable toggle on each option rather than a radio in a corner.
 * Saving is blocked client-side when no option is marked correct — the server
 * enforces the same rule, but discovering it after a long form is filled in is
 * a bad way to learn it.
 */
export interface TaxonomyExam {
  id: string;
  name: string;
  shortName: string;
  subjects: {
    id: string;
    name: string;
    chapters: { id: string; name: string; topics: { id: string; name: string }[] }[];
  }[];
}

export interface QuestionDraft {
  id?: string;
  code?: string;
  examId: string;
  subjectId: string;
  chapterId: string | null;
  topicId: string | null;
  type: string;
  difficulty: string;
  status: string;
  body: string;
  passage: string | null;
  imageUrl: string | null;
  marks: number;
  negativeMarks: number;
  numericalAnswer: number | null;
  numericalTolerance: number | null;
  explanation: string | null;
  detailedSolution: string | null;
  concept: string | null;
  source: string | null;
  examYear: number | null;
  reviewNote: string | null;
  options: { body: string; isCorrect: boolean; imageUrl?: string | null }[];
}

const TYPES = [
  { value: 'SINGLE_CORRECT', label: 'Single correct' },
  { value: 'MULTIPLE_CORRECT', label: 'Multiple correct' },
  { value: 'TRUE_FALSE', label: 'True / False' },
  { value: 'NUMERICAL', label: 'Numerical' },
] as const;

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
const STATUSES = ['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;

function blankDraft(exams: TaxonomyExam[]): QuestionDraft {
  const exam = exams[0];
  return {
    examId: exam?.id ?? '',
    subjectId: exam?.subjects[0]?.id ?? '',
    chapterId: null,
    topicId: null,
    type: 'SINGLE_CORRECT',
    difficulty: 'MEDIUM',
    // Published by default.
    //
    // A draft is attached to its paper but skipped when a student sits it, so
    // defaulting to DRAFT meant someone could write a question, save it, see it
    // listed on the test, and have it silently not count. Anyone deliberately
    // parking a half-finished question can still choose Draft from the status
    // field; the common case is a question meant to be used.
    status: 'PUBLISHED',
    body: '',
    passage: null,
    imageUrl: null,
    marks: MARKS_PER_QUESTION,
    negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
    numericalAnswer: null,
    numericalTolerance: 0.01,
    explanation: null,
    detailedSolution: null,
    concept: null,
    source: null,
    examYear: null,
    reviewNote: null,
    options: [
      { body: '', isCorrect: false },
      { body: '', isCorrect: false },
      { body: '', isCorrect: false },
      { body: '', isCorrect: false },
    ],
  };
}

export function QuestionEditor({
  exams,
  initial,
  returnTo,
  attachToTestId,
}: {
  exams: TaxonomyExam[];
  initial?: QuestionDraft;
  /**
   * Where saving and the back link go.
   *
   * Someone correcting a paper works through it question by question, and
   * returning to the unfiltered bank each time meant re-selecting the paper for
   * every single correction — a hundred round trips through the picker to edit
   * a hundred questions.
   */
  returnTo?: string;
  /** Attach a newly created question to this paper as well as the bank. */
  attachToTestId?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  // Only a path on this site: `returnTo` arrives from the query string, so an
  // absolute URL here would let a crafted admin link bounce someone off-site
  // after saving.
  const back =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/admin/questions';

  const [draft, setDraft] = React.useState<QuestionDraft>(initial ?? blankDraft(exams));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const exam = exams.find((e) => e.id === draft.examId);
  const subject = exam?.subjects.find((s) => s.id === draft.subjectId);
  const chapter = subject?.chapters.find((c) => c.id === draft.chapterId);

  const isNumerical = draft.type === 'NUMERICAL';
  const isMulti = draft.type === 'MULTIPLE_CORRECT';

  const correctCount = draft.options.filter((o) => o.isCorrect && o.body.trim()).length;
  const filledOptions = draft.options.filter((o) => o.body.trim()).length;

  /** Mirrors the server rules so the button explains itself before submission. */
  const blocker = (() => {
    if (!draft.body.trim()) return 'Write the question text';
    if (!draft.examId || !draft.subjectId) return 'Choose an exam and subject';
    if (isNumerical) {
      return draft.numericalAnswer === null ? 'Enter the expected numerical answer' : null;
    }
    if (filledOptions < 2) return 'Add at least two options';
    if (correctCount === 0) return 'Mark the correct option';
    if (!isMulti && correctCount > 1) return 'Only one option can be correct for this type';
    return null;
  })();

  function update<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function setOption(index: number, patch: Partial<{ body: string; isCorrect: boolean }>) {
    setDraft((previous) => {
      const options = previous.options.map((option, i) =>
        i === index ? { ...option, ...patch } : option,
      );

      // For single-correct types, marking one option unmarks the rest — the
      // alternative is letting the admin build a question the server rejects.
      if (patch.isCorrect && previous.type !== 'MULTIPLE_CORRECT') {
        return {
          ...previous,
          options: options.map((option, i) => ({ ...option, isCorrect: i === index })),
        };
      }
      return { ...previous, options };
    });
  }

  function changeType(type: string) {
    setDraft((previous) => {
      if (type === 'TRUE_FALSE') {
        return {
          ...previous,
          type,
          options: [
            { body: 'True', isCorrect: false },
            { body: 'False', isCorrect: false },
          ],
        };
      }
      if (type === 'NUMERICAL') return { ...previous, type, options: [] };

      const options =
        previous.options.length >= 2
          ? previous.options
          : [
              { body: '', isCorrect: false },
              { body: '', isCorrect: false },
              { body: '', isCorrect: false },
              { body: '', isCorrect: false },
            ];

      // Collapsing multi -> single must not leave two correct answers behind.
      if (type !== 'MULTIPLE_CORRECT') {
        let seen = false;
        return {
          ...previous,
          type,
          options: options.map((option) => {
            if (option.isCorrect && !seen) {
              seen = true;
              return option;
            }
            return { ...option, isCorrect: false };
          }),
        };
      }
      return { ...previous, type, options };
    });
  }

  async function save() {
    if (blocker) return;
    setSaving(true);
    setError(null);

    const payload = {
      ...draft,
      options: draft.options.filter((o) => o.body.trim()),
      // Empty strings must become null, not fail URL/number validation.
      passage: draft.passage || null,
      imageUrl: draft.imageUrl || null,
      explanation: draft.explanation || null,
      detailedSolution: draft.detailedSolution || null,
      concept: draft.concept || null,
      source: draft.source || null,
      reviewNote: draft.reviewNote || null,
      ...(attachToTestId && !isEdit ? { attachToTestId } : {}),
    };

    try {
      const result = isEdit
        ? await api.put<{ id: string; code: string }>(`/api/admin/questions/${draft.id}`, payload)
        : await api.post<{ id: string; code: string }>('/api/admin/questions', payload);

      toast.success(isEdit ? `Saved ${result.code}.` : `Created ${result.code}.`);
      if (isEdit) {
        // An edit stays on this page: someone working through a list of
        // flagged questions fixes one, checks it, and moves on with Back -
        // being sent to the question bank lost their place every time.
        setSaving(false);
        router.refresh();
      } else {
        router.push(back);
        router.refresh();
      }
    } catch (caught) {
      const message =
        caught instanceof ApiClientError
          ? (Object.values(caught.fieldErrors ?? {})[0]?.[0] ?? caught.message)
          : 'We could not save this question.';
      setError(message);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href={back}>
              <ArrowLeft aria-hidden="true" />
              {back === '/admin/questions'
                ? 'Question bank'
                : back.startsWith('/admin/questions?testId=') && !back.includes('&')
                  ? 'Back to the paper'
                  : 'Back to the list'}
            </Link>
          </Button>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {isEdit ? `Edit ${draft.code ?? 'question'}` : 'New question'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Only when editing: there is nothing to delete until the question
              exists. Sits beside Save because this is where someone is when
              they decide a question should not be there at all. */}
          {isEdit && draft.id && (
            <DeleteQuestion
              questionId={draft.id}
              code={draft.code ?? null}
              attachedTo={0}
              variant="button"
              onDeleted={() => router.push(back)}
            />
          )}

          <Button onClick={save} loading={saving} disabled={Boolean(blocker)}>
            <Save aria-hidden="true" />
            {isEdit ? 'Save changes' : 'Create question'}
          </Button>
        </div>
      </div>

      {error && <InlineError message={error} />}

      {/* Placement ------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Placement</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Exam" htmlFor="q-exam" required>
              <select
                id="q-exam"
                value={draft.examId}
                onChange={(event) => {
                  const nextExam = exams.find((e) => e.id === event.target.value);
                  setDraft((previous) => ({
                    ...previous,
                    examId: event.target.value,
                    subjectId: nextExam?.subjects[0]?.id ?? '',
                    chapterId: null,
                    topicId: null,
                  }));
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

            <FormField label="Subject" htmlFor="q-subject" required>
              <select
                id="q-subject"
                value={draft.subjectId}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    subjectId: event.target.value,
                    chapterId: null,
                    topicId: null,
                  }))
                }
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {(exam?.subjects ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Chapter" htmlFor="q-chapter" hint="Optional">
              <select
                id="q-chapter"
                value={draft.chapterId ?? ''}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    chapterId: event.target.value || null,
                    topicId: null,
                  }))
                }
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">None</option>
                {(subject?.chapters ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Topic" htmlFor="q-topic" hint="Drives weak-topic analytics">
              <select
                id="q-topic"
                value={draft.topicId ?? ''}
                onChange={(event) => update('topicId', event.target.value || null)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">None</option>
                {(chapter?.topics ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Question -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold tracking-tight">Question</h2>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => changeType(item.value)}
                  aria-pressed={draft.type === item.value}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    draft.type === item.value
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <FormField label="Passage" htmlFor="q-passage" hint="Optional shared context">
            <Textarea
              value={draft.passage ?? ''}
              onChange={(event) => update('passage', event.target.value)}
              rows={3}
              placeholder="Statements or a comprehension passage, if the question needs one"
            />
          </FormField>

          <FormField
            label="Figure"
            htmlFor="q-image"
            hint="Optional. A map, diagram or chart shown above the options"
          >
            <FigurePicker
              value={draft.imageUrl}
              onChange={(url) => update('imageUrl', url)}
            />
          </FormField>

          <FormField label="Question text" htmlFor="q-body" required>
            <Textarea
              value={draft.body}
              onChange={(event) => update('body', event.target.value)}
              rows={5}
              placeholder="Write the question exactly as the student should see it"
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Answer ---------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold tracking-tight">Answer</h2>
            {!isNumerical && (
              <Badge variant={correctCount === 0 ? 'danger' : 'success'} size="sm">
                {correctCount === 0
                  ? 'No correct option marked'
                  : `${correctCount} correct`}
              </Badge>
            )}
          </div>

          {isNumerical ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Expected answer" htmlFor="q-num" required>
                <Input
                  type="number"
                  step="any"
                  value={draft.numericalAnswer ?? ''}
                  onChange={(event) =>
                    update('numericalAnswer', event.target.value === '' ? null : Number(event.target.value))
                  }
                />
              </FormField>
              <FormField
                label="Tolerance"
                htmlFor="q-tol"
                hint="Answers within ± this value are accepted"
              >
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={draft.numericalTolerance ?? 0}
                  onChange={(event) => update('numericalTolerance', Number(event.target.value))}
                />
              </FormField>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {isMulti
                  ? 'Mark every correct option. A student must select all of them exactly.'
                  : 'Mark exactly one option as correct.'}
              </p>

              <ul className="space-y-2.5">
                {draft.options.map((option, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => setOption(index, { isCorrect: !option.isCorrect })}
                      aria-pressed={option.isCorrect}
                      aria-label={`Mark option ${String.fromCharCode(65 + index)} as correct`}
                      className={cn(
                        'mt-1 flex size-8 shrink-0 items-center justify-center border text-sm font-semibold transition-colors',
                        isMulti ? 'rounded-md' : 'rounded-full',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        option.isCorrect
                          ? 'border-success bg-success text-white'
                          : 'border-input text-muted-foreground hover:border-success/50',
                      )}
                    >
                      {option.isCorrect ? (
                        <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                      ) : (
                        String.fromCharCode(65 + index)
                      )}
                    </button>

                    <Textarea
                      value={option.body}
                      onChange={(event) => setOption(index, { body: event.target.value })}
                      rows={1}
                      placeholder={`Option ${String.fromCharCode(65 + index)}`}
                      className="min-h-[44px] flex-1"
                    />

                    {draft.type !== 'TRUE_FALSE' && (
                      <div className="mt-1 shrink-0">
                        <FigurePicker
                          label={`Option ${String.fromCharCode(65 + index)} image`}
                          value={option.imageUrl ?? null}
                          onChange={(url) =>
                            update(
                              'options',
                              draft.options.map((o, i) =>
                                i === index ? { ...o, imageUrl: url } : o,
                              ),
                            )
                          }
                        />
                      </div>
                    )}

                    {draft.options.length > 2 && draft.type !== 'TRUE_FALSE' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          update(
                            'options',
                            draft.options.filter((_, i) => i !== index),
                          )
                        }
                        aria-label={`Remove option ${String.fromCharCode(65 + index)}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              {draft.options.length < 6 && draft.type !== 'TRUE_FALSE' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update('options', [...draft.options, { body: '', isCorrect: false }])
                  }
                >
                  <Plus aria-hidden="true" />
                  Add option
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Solution -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Solution</h2>

          <FormField
            label="Short explanation"
            htmlFor="q-exp"
            hint="Shown in practice mode the moment the student answers"
          >
            <Textarea
              value={draft.explanation ?? ''}
              onChange={(event) => update('explanation', event.target.value)}
              rows={3}
            />
          </FormField>

          <FormField
            label="Detailed solution"
            htmlFor="q-sol"
            hint="HTML is allowed — headings, lists and emphasis render on the result page"
          >
            <Textarea
              value={draft.detailedSolution ?? ''}
              onChange={(event) => update('detailedSolution', event.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Metadata -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Scoring &amp; metadata</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Marks" htmlFor="q-marks">
              <Input
                type="number"
                step="0.25"
                min={0.25}
                value={draft.marks}
                onChange={(event) => update('marks', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Negative marks" htmlFor="q-neg" hint="0 for no penalty">
              <Input
                type="number"
                step="0.25"
                min={0}
                value={draft.negativeMarks}
                onChange={(event) => update('negativeMarks', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Difficulty" htmlFor="q-diff">
              <select
                id="q-diff"
                value={draft.difficulty}
                onChange={(event) => update('difficulty', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d.charAt(0) + d.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Source" htmlFor="q-source" hint="e.g. KAS Prelims 2011">
              <Input
                value={draft.source ?? ''}
                onChange={(event) => update('source', event.target.value)}
              />
            </FormField>
            <FormField label="Exam year" htmlFor="q-year">
              <Input
                type="number"
                min={1950}
                max={2100}
                value={draft.examYear ?? ''}
                onChange={(event) =>
                  update('examYear', event.target.value === '' ? null : Number(event.target.value))
                }
              />
            </FormField>
            <FormField label="Status" htmlFor="q-status">
              <select
                id="q-status"
                value={draft.status}
                onChange={(event) => update('status', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField
            label="Internal review note"
            htmlFor="q-note"
            hint="Never shown to students. Use it to flag a disputed key."
          >
            <Textarea
              value={draft.reviewNote ?? ''}
              onChange={(event) => update('reviewNote', event.target.value)}
              rows={2}
            />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 pb-8">
        <p className="text-sm text-muted-foreground">
          {blocker ? (
            <span className="text-warning">{blocker}</span>
          ) : (
            'Ready to save.'
          )}
        </p>
        <Button onClick={save} loading={saving} disabled={Boolean(blocker)}>
          <Save aria-hidden="true" />
          {isEdit ? 'Save changes' : 'Create question'}
        </Button>
      </div>
    </div>
  );
}
