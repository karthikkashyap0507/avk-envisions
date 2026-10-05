'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  Save,
  Search,
  FileDown,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { InlineError } from '@/components/ui/states';
import { ApiClientError, api } from '@/lib/api-client';
import { TEST_OPENS_EARLY_MINUTES } from '@/lib/enums';
import { DeleteQuestion } from '@/features/admin/delete-question';
import { cn } from '@/lib/utils';

/**
 * Test builder.
 *
 * Two panes: the test's configuration, and the questions attached to it. The
 * attach flow searches the live bank rather than making the admin paste ids —
 * a test with the wrong question on it is indistinguishable from a correct one
 * until a student complains.
 */
export interface TestDraft {
  id?: string;
  examId: string;
  testSeriesId: string | null;
  title: string;
  slug: string;
  description: string | null;
  instructions: string | null;
  category: string;
  mode: string;
  status: string;
  accessType: string;
  durationMinutes: number;
  maxAttempts: number;
  passingMarks: number;
  /** ISO string, or null to open as soon as the paper is published. */
  startDate: string | null;
  /** ISO string, or null to stay open indefinitely. */
  endDate: string | null;
  negativeMarkingEnabled: boolean;
  defaultNegativeRatio: number;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  showResultImmediately: boolean;
}

export interface AttachedQuestion {
  rowId: string;
  questionId: string;
  code: string;
  body: string;
  type: string;
  difficulty: string;
  status: string;
  subject: string | null;
  marks: number;
  negativeMarks: number;
}

export interface BuilderProps {
  exams: { id: string; name: string; shortName: string }[];
  series: { id: string; name: string }[];
  initial?: TestDraft;
  attached?: AttachedQuestion[];
  /**
   * Choices a link made on the admin's behalf, for a new test only.
   *
   * "New quiz" arrives with the category and series already set, so making one
   * does not depend on remembering to change a form that defaults to a full
   * mock — get either wrong and the quiz never appears at /quiz.
   */
  preset?: { category?: string; testSeriesId?: string };
}

const CATEGORIES = [
  'FULL_MOCK',
  'SECTIONAL',
  'CHAPTER',
  'TOPIC',
  'PRACTICE',
  'PREVIOUS_YEAR',
  // A quiz is an ordinary test with this category, so it has to be selectable
  // here — otherwise /admin/quiz can link to "New quiz" and the form would
  // quietly create something else.
  'QUIZ',
  'CUSTOM',
] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function blank(exams: BuilderProps['exams']): TestDraft {
  return {
    examId: exams[0]?.id ?? '',
    testSeriesId: null,
    title: '',
    slug: '',
    description: null,
    instructions: null,
    category: 'FULL_MOCK',
    mode: 'EXAM',
    status: 'DRAFT',
    accessType: 'FREE',
    durationMinutes: 60,
    maxAttempts: 2,
    passingMarks: 0,
    startDate: null,
    endDate: null,
    negativeMarkingEnabled: true,
    defaultNegativeRatio: 0.25,
    randomizeQuestions: false,
    randomizeOptions: false,
    showResultImmediately: true,
  };
}

/**
 * An ISO instant as a `datetime-local` input wants it.
 *
 * `datetime-local` has no timezone: it shows and returns whatever the admin's
 * own clock reads. The database stores UTC, so the two must be converted
 * rather than passed straight through — writing the ISO string into the input
 * would show an Indian admin a time five and a half hours behind the one they
 * set, and reading it back raw would store the wrong instant.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

/** The reverse: what the admin typed, as an ISO instant. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function TestBuilder({ exams, series, initial, attached = [], preset }: BuilderProps) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [draft, setDraft] = React.useState<TestDraft>(() => {
    if (initial) return initial;
    const fresh = blank(exams);
    // A preset only seeds a new test; an existing one keeps what it has.
    if (preset?.category) fresh.category = preset.category;
    if (preset?.testSeriesId) fresh.testSeriesId = preset.testSeriesId;
    return fresh;
  });
  const [rows, setRows] = React.useState<AttachedQuestion[]>(attached);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const totalMarks = rows.reduce((sum, r) => sum + r.marks, 0);
  const unpublished = rows.filter((r) => r.status !== 'PUBLISHED').length;
  const [publishing, setPublishing] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);

  /** Publishes every attached question that is still a draft. */
  /**
   * Empties the paper.
   *
   * Confirmed in the browser rather than silently: this removes every question
   * at once and the only way back is to attach them again. The questions
   * survive in the bank, which the message says so nobody thinks their work is
   * destroyed.
   */
  async function clearAll() {
    const ok = window.confirm(
      `Remove all ${rows.length} question${rows.length === 1 ? '' : 's'} from this paper?

` +
        'The paper and its settings stay. The questions stay in the question bank and can be ' +
        'attached again.',
    );
    if (!ok) return;

    setClearing(true);
    try {
      await api.post(`/api/admin/tests/${initial?.id}/questions`, { action: 'clear' });
      setRows([]);
      toast.success('The paper is empty. Its questions are still in the bank.');
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : 'The paper could not be cleared.',
      );
    } finally {
      setClearing(false);
    }
  }

  async function publishAttached() {
    setPublishing(true);
    try {
      const ids = rows.filter((r) => r.status !== 'PUBLISHED').map((r) => r.questionId);
      await api.post(`/api/admin/tests/${initial?.id}/questions`, {
        action: 'publish',
        questionIds: ids,
      });
      toast.success(ids.length === 1 ? 'Question published.' : `${ids.length} questions published.`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : 'Those could not be published.',
      );
    } finally {
      setPublishing(false);
    }
  }

  function update<K extends keyof TestDraft>(key: K, value: TestDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  const blocker = (() => {
    if (!draft.title.trim()) return 'Give the test a title';
    if (!draft.slug.trim()) return 'Set a URL slug';
    if (!draft.examId) return 'Choose an exam';
    if (draft.status === 'PUBLISHED' && rows.length === 0) {
      return 'Attach at least one question before publishing';
    }
    return null;
  })();

  async function save() {
    if (blocker) return;
    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        await api.put(`/api/admin/tests/${draft.id}`, draft);
        toast.success('Test saved.');
        router.refresh();
      } else {
        const result = await api.post<{ id: string }>('/api/admin/tests', draft);
        toast.success('Test created.');
        router.push(`/admin/tests/${result.id}`);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? (Object.values(caught.fieldErrors ?? {})[0]?.[0] ?? caught.message)
          : 'We could not save this test.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function mutateQuestions(body: Record<string, unknown>, optimistic?: () => void) {
    if (!draft.id) return;
    optimistic?.();

    try {
      await api.post(`/api/admin/tests/${draft.id}/questions`, body);
      router.refresh();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not update the questions.',
      );
      router.refresh();
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;

    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    setRows(next);

    void mutateQuestions({ action: 'reorder', order: next.map((r) => r.rowId) });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/admin/tests">
              <ArrowLeft aria-hidden="true" />
              Tests
            </Link>
          </Button>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {isEdit ? draft.title || 'Edit test' : 'New test'}
          </h1>
        </div>

        <Button onClick={save} loading={saving} disabled={Boolean(blocker)}>
          <Save aria-hidden="true" />
          {isEdit ? 'Save changes' : 'Create test'}
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {draft.status === 'PUBLISHED' && rows.length === 0 && isEdit && (
        <InlineError message="This test is published but has no questions. Students who open it will hit a dead end." />
      )}

      {/* Configuration --------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Configuration</h2>

          <FormField label="Title" htmlFor="t-title" required>
            <Input
              value={draft.title}
              onChange={(event) => {
                const title = event.target.value;
                setDraft((previous) => ({
                  ...previous,
                  title,
                  // Only auto-fill the slug while creating; changing it later
                  // would break links students may already hold.
                  slug: !isEdit && !previous.slug ? slugify(title) : previous.slug,
                }));
              }}
              placeholder="e.g. KAS Prelims Full Mock Test 1"
            />
          </FormField>

          <FormField label="URL slug" htmlFor="t-slug" required hint="Lowercase, hyphens only">
            <Input
              value={draft.slug}
              onChange={(event) => update('slug', slugify(event.target.value))}
              placeholder="kas-prelims-full-mock-1"
              className="font-mono text-sm"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Exam" htmlFor="t-exam" required>
              <select
                id="t-exam"
                value={draft.examId}
                onChange={(event) => update('examId', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Test series" htmlFor="t-series" hint="Optional">
              <select
                id="t-series"
                value={draft.testSeriesId ?? ''}
                onChange={(event) => update('testSeriesId', event.target.value || null)}
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
          </div>

          <FormField label="Description" htmlFor="t-desc">
            <Textarea
              value={draft.description ?? ''}
              onChange={(event) => update('description', event.target.value)}
              rows={2}
            />
          </FormField>

          <FormField
            label="Instructions"
            htmlFor="t-inst"
            hint="Shown on the briefing screen before the timer starts"
          >
            <Textarea
              value={draft.instructions ?? ''}
              onChange={(event) => update('instructions', event.target.value)}
              rows={5}
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Rules ------------------------------------------------------------ */}
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">Rules</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Duration (minutes)" htmlFor="t-dur">
              <Input
                type="number"
                min={1}
                max={600}
                value={draft.durationMinutes}
                onChange={(event) => update('durationMinutes', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Max attempts" htmlFor="t-att" hint="0 = unlimited">
              <Input
                type="number"
                min={0}
                max={50}
                value={draft.maxAttempts}
                onChange={(event) => update('maxAttempts', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Passing marks" htmlFor="t-pass">
              <Input
                type="number"
                min={0}
                value={draft.passingMarks}
                onChange={(event) => update('passingMarks', Number(event.target.value))}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Opens on"
              htmlFor="t-start"
              hint={`Leave empty to open immediately. A scheduled paper lets students in ${TEST_OPENS_EARLY_MINUTES} minutes early.`}
            >
              <Input
                id="t-start"
                type="datetime-local"
                value={toLocalInput(draft.startDate)}
                onChange={(event) => update('startDate', fromLocalInput(event.target.value))}
              />
            </FormField>
            <FormField
              label="Closes on"
              htmlFor="t-end"
              hint="Leave empty to stay open indefinitely."
            >
              <Input
                id="t-end"
                type="datetime-local"
                value={toLocalInput(draft.endDate)}
                onChange={(event) => update('endDate', fromLocalInput(event.target.value))}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Category" htmlFor="t-cat">
              <select
                id="t-cat"
                value={draft.category}
                onChange={(event) => update('category', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Access" htmlFor="t-access">
              <select
                id="t-access"
                value={draft.accessType}
                onChange={(event) => update('accessType', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {['FREE', 'PAID', 'SUBSCRIPTION'].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status" htmlFor="t-status">
              <select
                id="t-status"
                value={draft.status}
                onChange={(event) => update('status', event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="space-y-2.5 border-t border-border pt-4">
            {(
              [
                ['negativeMarkingEnabled', 'Negative marking', 'Deduct marks for wrong answers'],
                ['randomizeQuestions', 'Shuffle questions', 'Each student sees a different order'],
                [
                  'randomizeOptions',
                  'Shuffle options',
                  'Turn off for questions keyed on option text, e.g. "A and B only"',
                ],
                ['showResultImmediately', 'Show result immediately', 'Otherwise results are held back'],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={draft[key] as boolean}
                  onChange={(event) => update(key, event.target.checked as never)}
                  className="mt-1 size-4 rounded border-input"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Questions -------------------------------------------------------- */}
      {isEdit ? (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold tracking-tight">Questions</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {rows.length} attached · {totalMarks} marks
                  {unpublished > 0 && ` · ${unpublished} not published`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* The paper as a printable page, answers and explanations
                    included, for proof-reading away from the screen. Opens in
                    a new tab; the browser's own print dialog saves the PDF. */}
                {isEdit && rows.length > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/admin/tests/${draft.id}/export`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileDown aria-hidden="true" />
                      Print / PDF
                    </a>
                  </Button>
                )}
                {/* The same paper in Kannada, from the translations students
                    take the test in. */}
                {isEdit && rows.length > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/admin/tests/${draft.id}/export?lang=kn`}
                      target="_blank"
                      rel="noreferrer"
                      lang="kn"
                    >
                      <FileDown aria-hidden="true" />
                      ಕನ್ನಡ PDF
                    </a>
                  </Button>
                )}

                {/* Emptying the whole paper, for when it is being rebuilt from
                    a corrected document. Removing a hundred questions one at a
                    time is not a workflow. */}
                {rows.length > 0 && (
                  <Button size="sm" variant="outline" onClick={clearAll} disabled={clearing}>
                    <Trash2 aria-hidden="true" />
                    {clearing ? 'Clearing…' : 'Clear all'}
                  </Button>
                )}
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  <Plus aria-hidden="true" />
                  Add questions
                </Button>
              </div>
            </div>

            {unpublished > 0 && (
              <div className="mt-3 flex flex-wrap items-start gap-3 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1">
                  {unpublished} attached {unpublished === 1 ? 'question is' : 'questions are'} not
                  published, so {unpublished === 1 ? 'it' : 'they'} will be skipped when a student
                  starts this test.
                </p>

                {/* Fixable where it is reported. Saying what is wrong and
                    leaving someone to find each question by hand is the slow
                    half of the problem. */}
                <Button size="sm" onClick={publishAttached} disabled={publishing}>
                  {publishing ? 'Publishing…' : `Publish ${unpublished === 1 ? 'it' : 'them'}`}
                </Button>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No questions attached yet. This test cannot be attempted until at least one is
                added.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {rows.map((row, index) => (
                  <li key={row.rowId} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5 w-7 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                        <StatusBadge status={row.status} />
                        {row.subject && (
                          <span className="text-xs text-muted-foreground">{row.subject}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          +{row.marks}
                          {row.negativeMarks > 0 && ` / −${row.negativeMarks}`}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed">{row.body}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label="Move up"
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, 1)}
                        disabled={index === rows.length - 1}
                        aria-label="Move down"
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      {/* Two different removals, and the difference matters:
                          this one takes the question off this paper and leaves
                          it in the bank for reuse. */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove from this paper"
                        title="Remove from this paper (stays in the bank)"
                        onClick={() =>
                          mutateQuestions(
                            { action: 'detach', questionIds: [row.questionId] },
                            () => setRows((previous) => previous.filter((r) => r.rowId !== row.rowId)),
                          )
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>

                      {/* And this one deletes it outright, everywhere. */}
                      <DeleteQuestion
                        questionId={row.questionId}
                        code={row.code ?? null}
                        attachedTo={0}
                        onDeleted={() =>
                          setRows((previous) => previous.filter((r) => r.rowId !== row.rowId))
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          Save the test first, then attach questions to it.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pb-8">
        <p className="text-sm text-muted-foreground">
          {blocker ? <span className="text-warning">{blocker}</span> : 'Ready to save.'}
        </p>
        <Button onClick={save} loading={saving} disabled={Boolean(blocker)}>
          <Save aria-hidden="true" />
          {isEdit ? 'Save changes' : 'Create test'}
        </Button>
      </div>

      {pickerOpen && draft.id && (
        <QuestionPicker
          testId={draft.id}
          attachedIds={new Set(rows.map((r) => r.questionId))}
          onClose={() => setPickerOpen(false)}
          onAttached={() => {
            setPickerOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Searches the published bank and attaches a selection.
 *
 * Already-attached questions are shown but disabled, so an admin can see that
 * the question they are looking for is already on the test rather than
 * wondering why nothing happened.
 */
function QuestionPicker({
  testId,
  attachedIds,
  onClose,
  onAttached,
}: {
  testId: string;
  attachedIds: Set<string>;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<
    { id: string; code: string; body: string; status: string; subject: string | null }[]
  >([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [attaching, setAttaching] = React.useState(false);

  const search = React.useCallback(async (term: string) => {
    setLoading(true);
    try {
      const data = await api.get<{
        rows: { id: string; code: string; body: string; status: string; subject: string | null }[];
      }>(`/api/admin/questions/search?q=${encodeURIComponent(term)}`);
      setResults(data.rows);
    } catch {
      toast.error('Search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const id = window.setTimeout(() => void search(query), 300);
    return () => window.clearTimeout(id);
  }, [query, search]);

  async function attach() {
    setAttaching(true);
    try {
      await api.post(`/api/admin/tests/${testId}/questions`, {
        action: 'attach',
        questionIds: [...selected],
      });
      toast.success(`Added ${selected.size} question${selected.size === 1 ? '' : 's'}.`);
      onAttached();
    } catch (caught) {
      toast.error(caught instanceof ApiClientError ? caught.message : 'Could not attach.');
      setAttaching(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />

      <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-float">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold tracking-tight">Add questions</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="border-b border-border p-4">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by question text or code…"
            startIcon={<Search />}
          />
        </div>

        <div className="scrollbar-slim flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {query ? 'No published questions match.' : 'Type to search the question bank.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((question) => {
                const already = attachedIds.has(question.id);
                const isSelected = selected.has(question.id);

                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (next.has(question.id)) next.delete(question.id);
                          else next.add(question.id);
                          return next;
                        })
                      }
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        already
                          ? 'cursor-not-allowed border-border opacity-50'
                          : isSelected
                            ? 'border-primary bg-primary-muted'
                            : 'border-transparent hover:bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                          isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                        aria-hidden="true"
                      >
                        {isSelected && '✓'}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {question.code}
                          </span>
                          {question.subject && (
                            <span className="text-xs text-muted-foreground">{question.subject}</span>
                          )}
                          {already && (
                            <Badge variant="muted" size="sm">
                              Already added
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-sm leading-relaxed">
                          {question.body}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={attach} loading={attaching} disabled={selected.size === 0}>
              Add {selected.size > 0 && selected.size}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
