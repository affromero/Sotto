CREATE TABLE "MaterialVocabularyIndex" (
  "id" TEXT PRIMARY KEY,
  "materialId" TEXT NOT NULL REFERENCES "CourseMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceFingerprint" TEXT NOT NULL,
  "textHash" TEXT NOT NULL,
  "textLength" INTEGER NOT NULL,
  "originalInput" JSONB NOT NULL,
  "materialCreatedAt" TIMESTAMP(3) NOT NULL,
  "nativeLang" TEXT NOT NULL,
  "targetLang" TEXT NOT NULL,
  "protocol" INTEGER NOT NULL DEFAULT 1,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'ACTIVE', 'COMPLETE', 'FAILED', 'NEEDS_TEXT', 'UNRESOLVED')),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("materialId", "sourceFingerprint")
);
CREATE INDEX "MaterialVocabularyIndex_courseId_idx" ON "MaterialVocabularyIndex"("courseId");
CREATE TABLE "VocabularyIndexChunk" (
  "id" TEXT PRIMARY KEY,
  "indexId" TEXT NOT NULL REFERENCES "MaterialVocabularyIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL CHECK ("endOffset" > "startOffset"),
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETE', 'FAILED', 'SPLIT', 'UNRESOLVED')),
  "operation" JSONB,
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("indexId", "startOffset", "endOffset")
);
CREATE INDEX "VocabularyIndexChunk_indexId_status_idx" ON "VocabularyIndexChunk"("indexId", "status");
CREATE TABLE "VocabularySourceOccurrence" (
  "id" TEXT PRIMARY KEY,
  "wordId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL REFERENCES "CourseMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "chunkId" TEXT NOT NULL REFERENCES "VocabularyIndexChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL CHECK ("endOffset" > "startOffset"),
  "quote" TEXT NOT NULL,
  "meaning" TEXT NOT NULL,
  FOREIGN KEY ("wordId", "courseId") REFERENCES "LearnerVocab"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("chunkId", "wordId", "startOffset", "endOffset")
);
CREATE INDEX "VocabularySourceOccurrence_wordId_idx" ON "VocabularySourceOccurrence"("wordId");
CREATE INDEX "VocabularySourceOccurrence_materialId_idx" ON "VocabularySourceOccurrence"("materialId");
