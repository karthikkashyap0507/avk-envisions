import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/states';
import { PdfImport } from '@/features/admin/pdf-import';
import { enforceAdminArea } from '@/server/auth/guards';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'Import from PDF',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ testId?: string }>;
}) {
  await enforceAdminArea('/admin/import');
  const { testId: fromTestId } = await searchParams;

  const [exams, series, tests] = await Promise.all([
    db.exam.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        // Picks the marking scheme: an FDA paper is +1 / −0.25, KAS +2 / −0.5.
        slug: true,
        subjects: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true },
        },
      },
    }),
    db.testSeries.findMany({
      where: { deletedAt: null },
      orderBy: [{ track: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, track: true, examId: true },
    }),
    // Every live test, so an import can be sent to several at once. Archived
    // ones are left out: they are retired, and offering them invites filling a
    // paper nobody can reach.
    db.test.findMany({
      where: { deletedAt: null, status: { not: 'ARCHIVED' } },
      // By the series' own order, not by title. Titles are text, so "Day 10"
      // sorts before "Day 2" and a fifty-day series read 1, 10, 11, 12 — which
      // makes picking day 7 out of the list a hunt. `sortOrder` is what the
      // series itself says the order is; slug breaks ties for anything that
      // shares a position, and title is the last resort.
      orderBy: [
        { testSeriesId: 'asc' },
        { sortOrder: 'asc' },
        { startDate: 'asc' },
        { slug: 'asc' },
      ],
      select: {
        id: true,
        title: true,
        status: true,
        accessType: true,
        totalQuestions: true,
        testSeriesId: true,
        testSeries: { select: { id: true, name: true } },
        // Questions belong to an exam, and are marked the way it is marked,
        // so a paper may only receive questions from its own exam.
        examId: true,
        subjectId: true,
      },
    }),
  ]);

  // Grouped by series, which is how the catalogue is organised and how an
  // admin looks for a paper. Tests belonging to no series are gathered under
  // one heading rather than dropped.
  const groups = (() => {
    const bySeries = new Map<string, { id: string | null; name: string; tests: typeof tests }>();
    for (const test of tests) {
      const key = test.testSeries?.id ?? '__standalone';
      const name = test.testSeries?.name ?? 'Standalone tests';
      if (!bySeries.has(key)) bySeries.set(key, { id: test.testSeries?.id ?? null, name, tests: [] });
      bySeries.get(key)!.tests.push(test);
    }

    return [...bySeries.values()]
      .map((group) => ({
        id: group.id,
        name: group.name,
        tests: group.tests.map((test) => ({
          id: test.id,
          title: test.title,
          questionCount: test.totalQuestions,
          status: test.status,
          accessType: test.accessType,
          examId: test.examId,
        })),
      }))
      // Standalone last: it is a catch-all, not a series someone looks for.
      .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
  })();

  const usable = exams.filter((exam) => exam.subjects.length > 0);

  // Opened from a paper — "Import PDF" on the FDA / SDA page, say. That paper
  // is chosen as the destination, and the exam, subject and marks follow it,
  // so the admin starts from the right place rather than from KAS defaults.
  const from = fromTestId ? tests.find((test) => test.id === fromTestId) : undefined;
  const initial = from
    ? {
        examId: from.examId,
        subjectId:
          from.subjectId &&
          usable.find((e) => e.id === from.examId)?.subjects.some((s) => s.id === from.subjectId)
            ? from.subjectId
            : '',
        testIds: [from.id],
      }
    : undefined;

  if (usable.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No subjects to import into"
          description="Imported questions need an exam and a subject to be filed under. Create at least one subject first."
          action={{ label: 'Manage exams', href: '/admin/exams' }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Import from PDF</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a question paper. Everything is shown for review before a single question is saved.
        </p>
      </header>

      <PdfImport
        exams={usable}
        series={series}
        tests={tests}
        groups={groups}
        initial={initial}
      />
    </div>
  );
}
