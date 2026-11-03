/**
 * Lays out the fifty-day challenge from the published schedule PDF.
 *
 * The timetable is the source of truth: the same document students read from
 * `/50-days/syllabus` is what creates the days, so the table and the PDF cannot
 * drift apart. Each row gives the day, its date, the paper, the subject, the
 * key focus and the topics — which is exactly what the schedule table renders.
 *
 * Days are created empty and unpublished. A paper appears on the site only once
 * an admin attaches its questions, which is the same rule the free series
 * follows; laying out fifty published papers with nothing in them would put
 * fifty dead rows in front of a student.
 *
 * Safe to re-run: a day that already has questions keeps them, and only its
 * schedule details are brought back into line.
 *
 *   npm run db:50days:schedule -- --dry-run
 *
 * Run with: npm run db:50days:schedule
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { getDocumentProxy } from 'unpdf';

import { DAILY_CHALLENGE_SLUG, DAILY_CHALLENGE_TEST_PREFIX } from '../src/lib/enums';
import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const QUESTIONS_PER_DAY = 50;
const MINUTES_PER_DAY = 60;

/** Where the committed schedule lives. */
const SCHEDULE = path.resolve('prisma/assets/kas-50-days-schedule.pdf');

/**
 * Column boundaries, in PDF points.
 *
 * Reading the text as lines does not work here: the six columns extract with a
 * single space between them and no delimiter, so focus and topics run
 * together and every rule for splitting them guessed wrong on some rows. The
 * PDF does carry each cell's x-position, and the columns are cleanly
 * separated, so the layout itself is the reliable signal.
 */
const COLUMN_X = { day: 0, date: 55, paper: 118, subject: 168, focus: 250, topics: 372 };

/** Subject names as printed, mapped to the catalogue's own names. */
const SUBJECT_ALIASES: Record<string, string> = {
  'Polity & Governance': 'Indian Polity',
  'History & Culture': 'History',
  Geography: 'Geography',
  'Economy & Development': 'Indian Economy',
  Economy: 'Indian Economy',
  'Environment & Ecology': 'Environment',
  Environment: 'Environment',
  'Science & Technology': 'Science & Technology',
  'Current Affairs': 'Current Affairs',
  CSAT: 'Mental Ability',
  'Mental Ability': 'Mental Ability',
};

interface Row {
  day: number;
  date: Date;
  paper: number;
  subject: string;
  focus: string;
  topics: string;
}

interface Cell {
  x: number;
  y: number;
  text: string;
}

/** Which column an x-position falls in. */
function columnOf(x: number): keyof typeof COLUMN_X {
  if (x >= COLUMN_X.topics) return 'topics';
  if (x >= COLUMN_X.focus) return 'focus';
  if (x >= COLUMN_X.subject) return 'subject';
  if (x >= COLUMN_X.paper) return 'paper';
  if (x >= COLUMN_X.date) return 'date';
  return 'day';
}

/**
 * Groups cells into rows by their vertical position, then reads each column.
 *
 * A row's focus and topics wrap onto further lines, which appear as later cells
 * in the same column with a lower y. Those are appended to whichever row is
 * open, so a wrapped phrase is rejoined rather than truncated.
 */
function parseCells(cells: Cell[]): Row[] {
  const rows: Row[] = [];

  // Group by proximity rather than an exact rounded y. A tall row puts its day
  // number on a different baseline from its date — the number is centred while
  // the text wraps — so keying on the exact value split half the rows in two
  // and lost the day number from each.
  const sorted = [...cells].sort((a, b) => b.y - a.y);
  const lines: Cell[][] = [];

  for (const cell of sorted) {
    const open = lines[lines.length - 1];
    const anchor = open?.[0]?.y;

    if (open && anchor !== undefined && Math.abs(anchor - cell.y) <= 6) {
      open.push(cell);
    } else {
      lines.push([cell]);
    }
  }

  for (const line of lines) {
    const columns: Record<string, string> = {};
    for (const cell of line.sort((a, b) => a.x - b.x)) {
      const column = columnOf(cell.x);
      columns[column] = `${columns[column] ?? ''} ${cell.text}`.trim();
    }

    const day = Number(columns.day ?? '');
    const dateText = columns.date ?? '';
    const paperText = columns.paper ?? '';

    // A line that opens a row has a day number, a date and a paper.
    if (Number.isInteger(day) && day >= 1 && day <= 50 && /\d{4}/.test(dateText) && /[12]/.test(paperText)) {
      rows.push({
        day,
        date: new Date(`${dateText} 00:00:00`),
        paper: Number(/([12])/.exec(paperText)?.[1] ?? 1),
        subject: columns.subject ?? '',
        focus: columns.focus ?? '',
        topics: columns.topics ?? '',
      });
      continue;
    }

    // Otherwise it continues the row above, column by column.
    const open = rows[rows.length - 1];
    if (!open) continue;
    if (columns.focus) open.focus = `${open.focus} ${columns.focus}`.trim();
    if (columns.topics) open.topics = `${open.topics} ${columns.topics}`.trim();
    if (columns.subject && !open.subject) open.subject = columns.subject;
  }

  return rows.sort((a, b) => a.day - b.day);
}

async function readSchedule(): Promise<Row[]> {
  const doc = await getDocumentProxy(new Uint8Array(await readFile(SCHEDULE)));
  const cells: Cell[] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();

    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[] };
      const text = (item.str ?? '').trim();
      if (text === '') continue;

      cells.push({
        x: item.transform?.[4] ?? 0,
        // Offset per page so page 2's rows sort below page 1's rather than
        // interleaving with them.
        y: (item.transform?.[5] ?? 0) - pageNo * 10_000,
        text,
      });
    }
  }

  return parseCells(cells);
}

async function main() {
  console.log(`\nLaying out the fifty days from the schedule${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const rows = await readSchedule();
  console.log(`  read ${rows.length} day(s) from the schedule\n`);

  if (rows.length < 40) {
    throw new Error(
      `Only ${rows.length} days parsed. The schedule layout is not what this expects.`,
    );
  }

  for (const row of rows.slice(0, 5)) {
    console.log(
      `  ${String(row.day).padStart(2)} ${row.date.toDateString().slice(4, 11)} P${row.paper} ` +
        `${row.subject.padEnd(20)} ${row.focus.slice(0, 34)}`,
    );
  }
  console.log(`  … and ${rows.length - 5} more\n`);

  if (DRY_RUN) {
    console.log('  Nothing written.\n');
    return;
  }

  const series = await db.testSeries.findFirst({
    where: { slug: DAILY_CHALLENGE_SLUG, deletedAt: null },
    select: { id: true, examId: true },
  });
  if (!series) throw new Error('The challenge series is missing. Run the catalogue seed first.');

  // This exam's subjects only: KEA FDA / SDA shares names such as "Geography".
  const subjects = await db.subject.findMany({
    where: { examId: series.examId },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  let created = 0;
  let updated = 0;
  let withContent = 0;

  for (const row of rows) {
    const slug = `${DAILY_CHALLENGE_TEST_PREFIX}${String(row.day).padStart(2, '0')}`;
    const existing = await db.test.findFirst({
      where: { slug },
      select: { id: true, totalQuestions: true },
    });

    const schedule = {
      testSeriesId: series.id,
      title: row.focus,
      description: row.topics || null,
      paperNumber: row.paper,
      subjectId: subjectId.get(SUBJECT_ALIASES[row.subject] ?? '') ?? null,
      startDate: row.date,
      sortOrder: row.day,
      durationMinutes: MINUTES_PER_DAY,
    };

    if (existing) {
      // Content is never touched: a rerun must not undo the work of attaching
      // questions. Only the schedule details are refreshed.
      await db.test.update({ where: { id: existing.id }, data: schedule });
      if (existing.totalQuestions > 0) withContent += 1;
      updated += 1;
      continue;
    }

    await db.test.create({
      data: {
        ...schedule,
        examId: series.examId,
        slug,
        category: 'PRACTICE',
        accessType: 'PAID',
        // Draft until it has questions, so a day appears to students only when
        // there is something behind it.
        status: 'DRAFT',
        mode: 'EXAM',
        maxAttempts: 2,
        totalQuestions: 0,
        totalMarks: QUESTIONS_PER_DAY * MARKS_PER_QUESTION,
        passingMarks: Math.round(QUESTIONS_PER_DAY * MARKS_PER_QUESTION * 0.35),
        negativeMarkingEnabled: true,
        defaultNegativeRatio: NEGATIVE_MARKS_PER_QUESTION / MARKS_PER_QUESTION,
      },
    });
    created += 1;
  }

  console.log(
    `  ${created} created, ${updated} rescheduled (${withContent} already have questions).` +
      `\n  Add questions at /admin/50-days, then publish each day.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
