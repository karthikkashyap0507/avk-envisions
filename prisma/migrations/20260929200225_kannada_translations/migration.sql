-- CreateTable
CREATE TABLE "content_translations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "translation_memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "language" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "content_translations_language_entityType_idx" ON "content_translations"("language", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "content_translations_entityType_entityId_language_key" ON "content_translations"("entityType", "entityId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "translation_memory_language_sourceHash_key" ON "translation_memory"("language", "sourceHash");
