-- DropIndex
DROP INDEX "tests_testSeriesId_sortOrder_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "chapterId" TEXT,
    "topicId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SINGLE_CORRECT',
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "passage" TEXT,
    "imageUrl" TEXT,
    "marks" REAL NOT NULL DEFAULT 2,
    "negativeMarks" REAL NOT NULL DEFAULT 0.5,
    "numericalAnswer" REAL,
    "numericalTolerance" REAL DEFAULT 0,
    "matchDataJson" TEXT,
    "explanation" TEXT,
    "detailedSolution" TEXT,
    "concept" TEXT,
    "source" TEXT,
    "examYear" INTEGER,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiBatchId" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "publishedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "questions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "questions_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "questions_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "questions_aiBatchId_fkey" FOREIGN KEY ("aiBatchId") REFERENCES "ai_generation_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "questions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "questions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_questions" ("aiBatchId", "body", "chapterId", "code", "concept", "createdAt", "createdById", "deletedAt", "detailedSolution", "difficulty", "examId", "examYear", "explanation", "id", "imageUrl", "isAiGenerated", "language", "marks", "matchDataJson", "negativeMarks", "numericalAnswer", "numericalTolerance", "passage", "publishedAt", "reviewNote", "reviewedAt", "reviewedById", "source", "status", "subjectId", "topicId", "type", "updatedAt") SELECT "aiBatchId", "body", "chapterId", "code", "concept", "createdAt", "createdById", "deletedAt", "detailedSolution", "difficulty", "examId", "examYear", "explanation", "id", "imageUrl", "isAiGenerated", "language", "marks", "matchDataJson", "negativeMarks", "numericalAnswer", "numericalTolerance", "passage", "publishedAt", "reviewNote", "reviewedAt", "reviewedById", "source", "status", "subjectId", "topicId", "type", "updatedAt" FROM "questions";
DROP TABLE "questions";
ALTER TABLE "new_questions" RENAME TO "questions";
CREATE UNIQUE INDEX "questions_code_key" ON "questions"("code");
CREATE INDEX "questions_examId_status_idx" ON "questions"("examId", "status");
CREATE INDEX "questions_subjectId_status_idx" ON "questions"("subjectId", "status");
CREATE INDEX "questions_chapterId_status_idx" ON "questions"("chapterId", "status");
CREATE INDEX "questions_topicId_status_idx" ON "questions"("topicId", "status");
CREATE INDEX "questions_status_difficulty_idx" ON "questions"("status", "difficulty");
CREATE INDEX "questions_type_idx" ON "questions"("type");
CREATE INDEX "questions_examYear_idx" ON "questions"("examYear");
CREATE INDEX "questions_deletedAt_idx" ON "questions"("deletedAt");
CREATE INDEX "questions_examId_subjectId_chapterId_topicId_difficulty_status_idx" ON "questions"("examId", "subjectId", "chapterId", "topicId", "difficulty", "status");
CREATE TABLE "new_test_series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "bannerUrl" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'MIXED',
    "track" TEXT NOT NULL DEFAULT 'PAID_SERIES',
    "examYear" INTEGER,
    "sessionLabel" TEXT,
    "synopsisFileName" TEXT,
    "tier1PriceInPaise" INTEGER,
    "tier1Limit" INTEGER,
    "tier2PriceInPaise" INTEGER,
    "tier2Limit" INTEGER,
    "offlineEnrolments" INTEGER NOT NULL DEFAULT 0,
    "iconName" TEXT,
    "accentHex" TEXT,
    "priceInPaise" INTEGER NOT NULL DEFAULT 0,
    "comparePriceInPaise" INTEGER NOT NULL DEFAULT 0,
    "accessDurationDays" INTEGER NOT NULL DEFAULT 365,
    "featuresJson" TEXT NOT NULL DEFAULT '[]',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_series_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_test_series" ("accentHex", "accessDurationDays", "bannerUrl", "comparePriceInPaise", "createdAt", "deletedAt", "description", "difficulty", "endDate", "examId", "examYear", "featuresJson", "iconName", "id", "isFeatured", "name", "priceInPaise", "seoDescription", "seoTitle", "sessionLabel", "slug", "sortOrder", "startDate", "status", "synopsisFileName", "tagline", "thumbnailUrl", "tier1Limit", "tier1PriceInPaise", "tier2Limit", "tier2PriceInPaise", "track", "updatedAt") SELECT "accentHex", "accessDurationDays", "bannerUrl", "comparePriceInPaise", "createdAt", "deletedAt", "description", "difficulty", "endDate", "examId", "examYear", "featuresJson", "iconName", "id", "isFeatured", "name", "priceInPaise", "seoDescription", "seoTitle", "sessionLabel", "slug", "sortOrder", "startDate", "status", "synopsisFileName", "tagline", "thumbnailUrl", "tier1Limit", "tier1PriceInPaise", "tier2Limit", "tier2PriceInPaise", "track", "updatedAt" FROM "test_series";
DROP TABLE "test_series";
ALTER TABLE "new_test_series" RENAME TO "test_series";
CREATE UNIQUE INDEX "test_series_slug_key" ON "test_series"("slug");
CREATE INDEX "test_series_examId_status_idx" ON "test_series"("examId", "status");
CREATE INDEX "test_series_status_isFeatured_sortOrder_idx" ON "test_series"("status", "isFeatured", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
