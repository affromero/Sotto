CREATE TABLE "VocabularyPronunciation" (
  "id" TEXT PRIMARY KEY,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fingerprint" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'UNRESOLVED')),
  "audioUrl" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("courseId", "fingerprint")
);
CREATE INDEX "VocabularyPronunciation_courseId_idx" ON "VocabularyPronunciation"("courseId");
