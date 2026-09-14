/**
 * Publishes questions that are already attached to a published paper.
 *
 * A paper can show "50 questions · 100 marks" and still refuse to start with
 * "This test has no available questions right now." The two come from
 * different places: the count is `totalQuestions` on the test, while the
 * engine filters to questions whose own status is PUBLISHED. Import leaves a
 * question in DRAFT, so a paper filled by import and then published by hand
 * has every question attached and none of them attemptable.
 *
 * Nothing is attached or detached here and no content is touched. Only the
 * status of questions already sitting on a published, undeleted paper moves
 * from DRAFT or UNDER_REVIEW to PUBLISHED.
 *
 * ARCHIVED is left alone: that is a deliberate withdrawal, and republishing it
 * would put a question the content team pulled back in front of students.
 *
 *   npm run db:publish-questions -- --dry-run
 *   npm run db:publish-questions -- --test kas-50-days-01
 *
 * Run with: npm run db:publish-questions
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const only = argument('test');

  const papers = await db.test.findMany({
    where: {
      deletedAt: null,
      status: 'PUBLISHED',
      ...(only ? { slug: only } : {}),
    },
    select: {
      id: true,
      slug: true,
      totalQuestions: true,
      questions: {
        select: {
          question: { select: { id: true, status: true, deletedAt: true } },
        },
      },
    },
    orderBy: { slug: 'asc' },
  });

  const stuck: { slug: string; ids: string[]; attached: number; live: number }[] = [];

  for (const paper of papers) {
    const attached = paper.questions.filter((row) => row.question.deletedAt === null);
    const live = attached.filter((row) => row.question.status === 'PUBLISHED');

    // Only what can be safely promoted. ARCHIVED is a withdrawal, not a
    // half-finished draft, so it stays where it is.
    const promotable = attached
      .filter((row) => row.question.status === 'DRAFT' || row.question.status === 'UNDER_REVIEW')
      .map((row) => row.question.id);

    if (promotable.length === 0) continue;

    stuck.push({
      slug: paper.slug,
      ids: promotable,
      attached: attached.length,
      live: live.length,
    });
  }

  if (stuck.length === 0) {
    console.log('\nEvery question on every published paper is itself published.\n');
    return;
  }

  console.log(`\n${stuck.length} published paper(s) hold questions a student cannot yet see:\n`);
  for (const paper of stuck) {
    console.log(
      `  ${paper.slug.padEnd(30)} ${paper.attached} attached · ${paper.live} attemptable · ` +
        `${paper.ids.length} to publish`,
    );
  }

  if (DRY_RUN) {
    console.log('\nDry run: nothing was written.\n');
    return;
  }

  let published = 0;
  for (const paper of stuck) {
    const result = await db.question.updateMany({
      where: { id: { in: paper.ids }, status: { in: ['DRAFT', 'UNDER_REVIEW'] } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    published += result.count;
  }

  console.log(`\nPublished ${published} question(s). Those papers can now be attempted.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
