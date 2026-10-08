import { describe, expect, it } from 'vitest';

import { boughtCourses } from './purchased-service';

const NOW = new Date('2026-10-08T12:00:00Z');
const LATER = new Date('2027-10-08T12:00:00Z');
const EARLIER = new Date('2026-01-01T00:00:00Z');

function row(slug: string, name: string, sourceType = 'PURCHASE', expiresAt: Date | null = null) {
  return { sourceType, expiresAt, testSeries: { slug, name } };
}

describe('boughtCourses', () => {
  it('names each course the way it is sold, oldest purchase first', () => {
    const courses = boughtCourses(
      [
        row('kas-prelims-paid-test-series', 'KPSC KAS Prelims — Paid Test Series'),
        row('kas-pyq-all-years', 'KAS Previous Year Question Papers', 'PURCHASE', LATER),
        row('kas-50-questions-50-days', 'KAS 50 Questions · 50 Days', 'PURCHASE', LATER),
      ],
      NOW,
    );

    expect(courses).toEqual([
      { name: 'KAS Full Length Tests', givenByAdmin: false, expired: false },
      { name: 'KAS PYQ Tests', givenByAdmin: false, expired: false },
      { name: 'KAS-50 (Daily tests)', givenByAdmin: false, expired: false },
    ]);
  });

  it('shows the combo as the one course paid for, not the three it opens', () => {
    const courses = boughtCourses([row('kas-complete-practice-combo', 'KAS Complete Practice Combo')], NOW);
    expect(courses.map((c) => c.name)).toEqual(['KAS Complete Practice Combo']);
  });

  it('keeps a single previous-year paper under its own name, not the bundle', () => {
    const courses = boughtCourses([row('kas-pyq-2011', '2011 KAS Prelims', 'ADMIN_GRANT')], NOW);
    expect(courses.map((c) => c.name)).toEqual(['2011 KAS Prelims']);
  });

  it('falls back to the catalogue name for a series added later', () => {
    const courses = boughtCourses([row('kas-mains-essay', 'KAS Mains Essay Series')], NOW);
    expect(courses.map((c) => c.name)).toEqual(['KAS Mains Essay Series']);
  });

  it('marks access given by hand for a payment taken outside the site', () => {
    const [course] = boughtCourses(
      [row('kas-prelims-paid-test-series', 'Paid Test Series', 'ADMIN_GRANT')],
      NOW,
    );
    expect(course).toEqual({ name: 'KAS Full Length Tests', givenByAdmin: true, expired: false });
  });

  it('keeps expired access listed, marked expired', () => {
    const courses = boughtCourses(
      [
        row('kas-50-questions-50-days', 'KAS 50', 'PURCHASE', EARLIER),
        row('kas-pyq-all-years', 'KAS PYQ', 'PURCHASE', NOW),
      ],
      NOW,
    );
    expect(courses.map((c) => [c.name, c.expired])).toEqual([
      ['KAS-50 (Daily tests)', true],
      ['KAS PYQ Tests', true],
    ]);
  });

  it('lists a course held twice once: bought if either was, live if either is', () => {
    const courses = boughtCourses(
      [
        row('kas-pyq-all-years', 'KAS PYQ', 'ADMIN_GRANT', null),
        row('kas-pyq-all-years', 'KAS PYQ', 'PURCHASE', EARLIER),
      ],
      NOW,
    );
    expect(courses).toEqual([{ name: 'KAS PYQ Tests', givenByAdmin: false, expired: false }]);
  });

  it('skips access whose series no longer exists, and is empty for a non-buyer', () => {
    expect(boughtCourses([{ sourceType: 'PURCHASE', expiresAt: null, testSeries: null }], NOW)).toEqual([]);
    expect(boughtCourses([], NOW)).toEqual([]);
  });
});
