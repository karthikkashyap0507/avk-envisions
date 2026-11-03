import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FilePlus2, FileText, FileUp, Landmark, Settings2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { SynopsisManager } from '@/features/admin/synopsis-manager';
import { FDA_SDA_SERIES_HREF, FDA_SDA_SERIES_SLUG } from '@/lib/enums';
import { FDA_SDA_MARKING } from '@/lib/marking';
import { formatDate } from '@/lib/utils';
import { enforceAdminArea } from '@/server/auth/guards';
import { db } from '@/server/db';
import { synopsisStatus } from '@/server/services/synopsis-service';

export const metadata: Metadata = {
  title: 'KEA FDA / SDA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** What every paper is planned to hold, from the published pattern. */
const PLANNED_QUESTIONS = 100;

/**
 * Running the KEA FDA / SDA Test Series.
 *
 * One row per paper, in timetable order, with what a student would meet: its
 * date, how full it is, whether it is live. Each row leads to the same tools
 * used for every other series — the PDF importer and the question editor,
 * opened on that paper — rather than a parallel set that would need keeping in
 * step. Both arrive with the FDA marking already filled in.
 *
 * The one thing this page adds is a marks check. The importer and editor
 * default to +1 / −0.25 here, but either can be overridden, and a paper keyed
 * at KAS marks scores out of 200 without anyone noticing.
 */
export default async function AdminFdaSdaPage() {
  await enforceAdminArea('/admin/kea-fda-sda');

  const series = await db.testSeries.findFirst({
    where: { slug: FDA_SDA_SERIES_SLUG, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      synopsisFileName: true,
      tests: {
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          status: true,
          startDate: true,
          totalQuestions: true,
          totalMarks: true,
          durationMinutes: true,
          synopsisFileName: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }],
      },
    },
  });

  if (!series) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={Landmark}
          title="The series has not been created yet"
          description="It is laid out on every deploy. To create it now, run “npm run db:fda-sda” on the server."
        />
      </div>
    );
  }

  const testIds = series.tests.map((t) => t.id);

  // Questions on each paper not marked the FDA way, and drafts that a student
  // would skip — both are invisible from the totals alone.
  const [offScheme, drafts] = await Promise.all([
    db.testQuestion.groupBy({
      by: ['testId'],
      where: {
        testId: { in: testIds },
        OR: [
          { marks: { not: FDA_SDA_MARKING.marks } },
          { negativeMarks: { not: FDA_SDA_MARKING.negativeMarks } },
        ],
      },
      _count: { _all: true },
    }),
    db.testQuestion.groupBy({
      by: ['testId'],
      where: { testId: { in: testIds }, question: { status: { not: 'PUBLISHED' } } },
      _count: { _all: true },
    }),
  ]);
  const offSchemeBy = new Map(offScheme.map((row) => [row.testId, row._count._all]));
  const draftsBy = new Map(drafts.map((row) => [row.testId, row._count._all]));

  const rows = await Promise.all(
    series.tests.map(async (test) => ({
      ...test,
      pdf: await synopsisStatus(test.synopsisFileName),
      offScheme: offSchemeBy.get(test.id) ?? 0,
      draftQuestions: draftsBy.get(test.id) ?? 0,
    })),
  );

  const seriesPdf = await synopsisStatus(series.synopsisFileName);
  const ready = rows.filter((t) => t.totalQuestions > 0).length;
  const live = rows.filter((t) => t.status === 'PUBLISHED' && t.totalQuestions > 0).length;

  const sections = [
    { title: 'Sectional tests', tests: rows.filter((t) => t.category !== 'FULL_MOCK') },
    {
      title: 'Full-length mock tests',
      hint: 'Paper 1 in the morning, Paper 2 in the afternoon',
      tests: rows.filter((t) => t.category === 'FULL_MOCK'),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{series.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ready} of {rows.length} tests have questions · {live} live for students
            {series.status !== 'PUBLISHED' && ' · the series itself is a draft'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={FDA_SDA_SERIES_HREF} target="_blank">
              <ExternalLink aria-hidden="true" />
              Public page
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/admin/test-series">Series settings</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">How these papers are marked</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {PLANNED_QUESTIONS} questions in 2 hours: +{FDA_SDA_MARKING.marks} for a correct answer,
              −{FDA_SDA_MARKING.negativeMarks} for a wrong one, 0 for a blank — out of{' '}
              {PLANNED_QUESTIONS * FDA_SDA_MARKING.marks}. Import and Add question below open with
              these marks filled in. A paper opens to students on its date once it is published and
              its questions are.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="text-xs text-muted-foreground">Series analysis PDF</span>
            <SynopsisManager
              kind="series"
              id={series.id}
              fileName={series.synopsisFileName}
              sizeBytes={seriesPdf.sizeBytes}
              present={seriesPdf.present}
            />
          </div>
        </CardContent>
      </Card>

      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
            <span className="font-normal normal-case tracking-normal">
              {section.tests.length} test{section.tests.length === 1 ? '' : 's'}
              {section.hint && ` · ${section.hint}`}
            </span>
          </h2>

          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {section.tests.map((test) => (
                  <li key={test.id} className="flex flex-wrap items-center gap-3 p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-sm font-semibold tabular-nums text-primary">
                      {test.sortOrder}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{test.title}</span>
                        {test.totalQuestions === 0 ? (
                          <Badge variant="danger" size="sm">
                            no questions
                          </Badge>
                        ) : test.status !== 'PUBLISHED' ? (
                          <Badge variant="warning" size="sm">
                            draft — publish in Settings
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">
                            live
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {test.startDate ? `Opens ${formatDate(test.startDate)}` : 'No date set'}
                        {test.description && ` · ${test.description}`} ·{' '}
                        <span
                          className={
                            test.totalQuestions > 0 && test.totalQuestions !== PLANNED_QUESTIONS
                              ? 'font-medium text-warning'
                              : undefined
                          }
                        >
                          {test.totalQuestions}/{PLANNED_QUESTIONS} questions
                        </span>{' '}
                        · {test.totalMarks} marks · {test.durationMinutes} min
                      </p>

                      {(test.offScheme > 0 || test.draftQuestions > 0) && (
                        <ul className="mt-1.5 space-y-1">
                          {test.offScheme > 0 && (
                            <li className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                              {test.offScheme} question{test.offScheme === 1 ? ' is' : 's are'} not
                              marked +{FDA_SDA_MARKING.marks} / −{FDA_SDA_MARKING.negativeMarks}
                            </li>
                          )}
                          {test.draftQuestions > 0 && (
                            <li className="flex items-start gap-1.5 text-xs font-medium text-warning">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                              {test.draftQuestions} draft question
                              {test.draftQuestions === 1 ? '' : 's'} — skipped until published
                            </li>
                          )}
                        </ul>
                      )}
                    </div>

                    <SynopsisManager
                      kind="test"
                      id={test.id}
                      fileName={test.synopsisFileName}
                      sizeBytes={test.pdf.sizeBytes}
                      present={test.pdf.present}
                    />

                    <div className="flex flex-wrap gap-1.5">
                      <Button asChild size="sm" className="h-8 text-xs">
                        <Link href={`/admin/import?testId=${test.id}`}>
                          <FileUp className="size-3.5" aria-hidden="true" />
                          Import PDF
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                        <Link href={`/admin/questions/new?testId=${test.id}`}>
                          <FilePlus2 className="size-3.5" aria-hidden="true" />
                          Add question
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
                        <Link href={`/admin/questions?testId=${test.id}`}>
                          <FileText className="size-3.5" aria-hidden="true" />
                          Questions
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
                        <Link href={`/admin/tests/${test.id}`}>
                          <Settings2 className="size-3.5" aria-hidden="true" />
                          Settings
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
