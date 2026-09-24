import 'server-only';

import { cache } from 'react';

import { FULL_LENGTH_SUBJECT_SLUGS } from '@/lib/enums';
import { labelValueArraySchema, parseJsonColumn, stringArraySchema } from '@/lib/json';
import { db } from '@/server/db';

/**
 * Read-only queries powering the public marketing site.
 *
 * Every function is wrapped in React `cache` so a page rendering several
 * sections issues one query per dataset, not one per component. All of them
 * degrade to an empty result rather than throwing, because a marketing page
 * must still render if a single content type has not been populated yet.
 */

export const getFeaturedExams = cache(async (limit = 8) => {
  const exams = await db.exam.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    take: limit,
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      description: true,
      category: true,
      colorHex: true,
      iconUrl: true,
      _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } }, testSeries: true } },
    },
  });

  return exams.map((exam) => ({
    ...exam,
    testCount: exam._count.tests,
    seriesCount: exam._count.testSeries,
  }));
});

export const getFeaturedTestSeries = cache(async (limit = 6) => {
  const series = await db.testSeries.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      thumbnailUrl: true,
      difficulty: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      featuresJson: true,
      exam: { select: { name: true, shortName: true, slug: true } },
      _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } } } },
    },
  });

  return series.map((s) => ({
    ...s,
    testCount: s._count.tests,
    features: parseJsonColumn(s.featuresJson, stringArraySchema, []),
    discountPercent:
      s.comparePriceInPaise > s.priceInPaise && s.comparePriceInPaise > 0
        ? Math.round(((s.comparePriceInPaise - s.priceInPaise) / s.comparePriceInPaise) * 100)
        : 0,
  }));
});

export const getPublishedPlans = cache(async () => {
  const plans = await db.subscriptionPlan.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { priceInPaise: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      durationDays: true,
      featuresJson: true,
      isFeatured: true,
      maxAiRequestsPerMonth: true,
    },
  });

  return plans.map((plan) => ({
    ...plan,
    features: parseJsonColumn(plan.featuresJson, stringArraySchema, []),
  }));
});

export const getTestimonials = cache(async (limit = 6) =>
  db.testimonial.findMany({
    where: { kind: 'TESTIMONIAL', isPublished: true },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
    take: limit,
    select: {
      id: true,
      studentName: true,
      avatarUrl: true,
      quote: true,
      examName: true,
      city: true,
      rating: true,
    },
  }),
);

export const getSuccessStories = cache(async (limit = 6) =>
  db.testimonial.findMany({
    where: { kind: 'SUCCESS_STORY', isPublished: true },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
    take: limit,
    select: {
      id: true,
      studentName: true,
      avatarUrl: true,
      quote: true,
      examName: true,
      achievement: true,
      rank: true,
      year: true,
      city: true,
    },
  }),
);

export const getFaqs = cache(async (category?: string, limit = 12) =>
  db.faq.findMany({
    where: {
      isPublished: true,
      testSeriesId: null,
      ...(category ? { category } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }],
    take: limit,
    select: { id: true, question: true, answer: true, category: true },
  }),
);

/**
 * Aggregate counters shown in the "trusted by" strip.
 *
 * These are real counts, not marketing figures. When the platform is new the
 * numbers are small — the homepage hides the strip below a threshold rather
 * than inventing impressive-looking values.
 */
export const getPlatformStats = cache(async () => {
  const [students, questions, tests, attempts] = await Promise.all([
    db.user.count({ where: { role: 'STUDENT', deletedAt: null } }),
    db.question.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    db.test.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    db.testAttempt.count({ where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } }),
  ]);

  return { students, questions, tests, attempts };
});

/** CMS-managed page sections, keyed for direct lookup by the renderer. */
export const getContentBlocks = cache(async (page: string) => {
  const blocks = await db.contentBlock.findMany({
    where: { page, isVisible: true },
    orderBy: { sortOrder: 'asc' },
  });

  return new Map(blocks.map((block) => [block.key, block]));
});

/** Full exam listing for /exams, grouped-ready and with content counts. */
export const getAllExams = cache(async () => {
  const exams = await db.exam.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      description: true,
      category: true,
      colorHex: true,
      _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } }, testSeries: true, subjects: true, questions: true } },
    },
  });

  return exams.map((exam) => ({
    ...exam,
    testCount: exam._count.tests,
    seriesCount: exam._count.testSeries,
    subjectCount: exam._count.subjects,
    questionCount: exam._count.questions,
  }));
});

/** Exam detail page, including the full syllabus tree. */
export const getExamBySlug = cache(async (slug: string) => {
  const exam = await db.exam.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      description: true,
      overview: true,
      category: true,
      colorHex: true,
      bannerUrl: true,
      seoTitle: true,
      seoDescription: true,
      highlightsJson: true,
      subjects: {
        // The full-length paper subjects are for filing mixed papers, not part
        // of the syllabus this page describes.
        where: { isActive: true, deletedAt: null, slug: { notIn: FULL_LENGTH_SUBJECT_SLUGS } },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          colorHex: true,
          chapters: {
            where: { isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              weightage: true,
              _count: { select: { topics: true, questions: true } },
            },
          },
          _count: { select: { questions: true } },
        },
      },
      testSeries: {
        where: { status: 'PUBLISHED', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          tagline: true,
          priceInPaise: true,
          comparePriceInPaise: true,
          _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } } } },
        },
      },
      _count: { select: { questions: true, tests: true } },
    },
  });

  if (!exam) return null;

  return {
    ...exam,
    highlights: parseJsonColumn(exam.highlightsJson, labelValueArraySchema, []),
    questionCount: exam._count.questions,
    testCount: exam._count.tests,
  };
});

/** Full test-series catalogue for /test-series. */
export const getAllTestSeries = cache(async () => {
  const series = await db.testSeries.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      thumbnailUrl: true,
      difficulty: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      featuresJson: true,
      isFeatured: true,
      exam: { select: { name: true, shortName: true, slug: true, colorHex: true } },
      _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } } } },
    },
  });

  return series.map((s) => ({
    ...s,
    testCount: s._count.tests,
    features: parseJsonColumn(s.featuresJson, stringArraySchema, []),
    discountPercent:
      s.comparePriceInPaise > s.priceInPaise && s.comparePriceInPaise > 0
        ? Math.round(((s.comparePriceInPaise - s.priceInPaise) / s.comparePriceInPaise) * 100)
        : 0,
  }));
});

/** Test-series sales page. */
export const getTestSeriesBySlug = cache(async (slug: string) => {
  const series = await db.testSeries.findFirst({
    where: { slug, status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      bannerUrl: true,
      thumbnailUrl: true,
      difficulty: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      accessDurationDays: true,
      featuresJson: true,
      seoTitle: true,
      seoDescription: true,
      exam: { select: { name: true, shortName: true, slug: true } },
      faqs: {
        where: { isPublished: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, question: true, answer: true },
      },
      tests: {
        // Every test, published or not. These series are sold on a published
        // timetable — a student is meant to see what falls on which date well
        // before those papers are written — and filtering to published ones
        // left a twelve-test series advertising nothing at all. Each row says
        // for itself whether it can be attempted.
        where: { deletedAt: null },
        // `sortOrder` is the seed's own numbering and is what a series means
        // by "test 3", so it leads. Date breaks a tie for series that carry
        // one. Slug is a last resort and never decides on its own: it sorts as
        // text, where "kas-free-10" lands before "kas-free-2" and the free
        // series listed its tenth test first.
        orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { slug: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          category: true,
          durationMinutes: true,
          totalQuestions: true,
          totalMarks: true,
          accessType: true,
          // A schedule needs to say whether a paper is open yet, and whether
          // its analysis exists, without a second query per row.
          startDate: true,
          synopsisFileName: true,
          paperNumber: true,
        },
      },
      _count: { select: { tests: { where: { status: 'PUBLISHED', deletedAt: null } } } },
    },
  });

  if (!series) return null;

  const totalQuestions = series.tests.reduce((sum, test) => sum + test.totalQuestions, 0);

  return {
    ...series,
    features: parseJsonColumn(series.featuresJson, stringArraySchema, []),
    testCount: series._count.tests,
    totalQuestions,
    discountPercent:
      series.comparePriceInPaise > series.priceInPaise && series.comparePriceInPaise > 0
        ? Math.round(
            ((series.comparePriceInPaise - series.priceInPaise) / series.comparePriceInPaise) * 100,
          )
        : 0,
  };
});

/** Paginated blog index. */
export const getBlogPosts = cache(async (page = 1, pageSize = 9) => {
  const where = {
    status: 'PUBLISHED',
    deletedAt: null,
    publishedAt: { lte: new Date() },
  } as const;

  const [posts, total] = await Promise.all([
    db.blogPost.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        coverImageUrl: true,
        readMinutes: true,
        publishedAt: true,
        isFeatured: true,
        author: { select: { name: true } },
        category: { select: { name: true, slug: true } },
      },
    }),
    db.blogPost.count({ where }),
  ]);

  return { posts, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), page };
});

/** Single blog post. Increments nothing — view counts are a background job. */
export const getBlogPostBySlug = cache(async (slug: string) =>
  db.blogPost.findFirst({
    where: { slug, status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      content: true,
      coverImageUrl: true,
      readMinutes: true,
      publishedAt: true,
      seoTitle: true,
      seoDescription: true,
      canonicalUrl: true,
      tagsJson: true,
      author: { select: { name: true } },
      category: { select: { name: true, slug: true } },
    },
  }),
);

/** Latest published posts for the blog teaser on the homepage. */
export const getLatestPosts = cache(async (limit = 3) =>
  db.blogPost.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      coverImageUrl: true,
      readMinutes: true,
      publishedAt: true,
      category: { select: { name: true, slug: true } },
    },
  }),
);
