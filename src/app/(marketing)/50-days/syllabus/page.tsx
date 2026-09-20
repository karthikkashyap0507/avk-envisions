import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { SynopsisViewer } from '@/features/student/synopsis-viewer';

export const metadata: Metadata = {
  title: 'KAS-50 (Daily tests) — Syllabus & Schedule',
  description:
    'The complete fifty-day timetable: what each day covers, the subject bands and the run-up to the KAS Prelims.',
};

/**
 * `/50-days/syllabus` — the timetable, rendered in the browser.
 *
 * Open to everyone. The schedule is what tells someone whether the series is
 * worth joining, so putting it behind the paywall would hide the reason to buy
 * — unlike a paper's analysis, which contains the answers.
 *
 * Uses the same canvas viewer as the analyses rather than an `<object>` or
 * `<iframe>`: mobile browsers largely refuse to render a PDF in those, so every
 * phone visitor would have met the fallback instead of the document.
 */
export default function FiftyDaysSyllabusPage() {
  return (
    <div className="container max-w-5xl py-8 sm:py-10">
      <Link
        href="/50-days"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the schedule
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
        KAS-50 (Daily tests) — Syllabus &amp; Schedule
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The complete fifty-day plan: what each day covers, subject by subject, up to the Prelims.
      </p>

      <div className="mt-6">
        <SynopsisViewer src="/api/schedule/50-days" title="KAS-50 (Daily tests) schedule" />
      </div>
    </div>
  );
}
