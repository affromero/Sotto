ALTER TABLE "CourseClass" ADD COLUMN "skillRequirements" JSONB;
ALTER TABLE "CourseClass" ADD COLUMN "learnerAnswers" JSONB;
ALTER TABLE "CourseClass" ADD COLUMN "writingDrafts" JSONB;
ALTER TABLE "CourseClass" ADD COLUMN "progressRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PracticeSession" ADD COLUMN "skillRequirements" JSONB;
ALTER TABLE "PracticeSession" ADD COLUMN "learnerAnswers" JSONB;
ALTER TABLE "PracticeSession" ADD COLUMN "writingDrafts" JSONB;
ALTER TABLE "PracticeSession" ADD COLUMN "progressRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PracticeSession" ADD COLUMN "submissionResult" JSONB;
ALTER TABLE "SpeakingRecording" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SpeakingRecording" ADD COLUMN "sttProvider" TEXT;
ALTER TABLE "SpeakingRecording" ADD COLUMN "sttSelection" JSONB;
ALTER TABLE "CourseClass" ADD COLUMN "readingVocabulary" JSONB;
ALTER TABLE "PracticeSession" ADD COLUMN "readingVocabulary" JSONB;
ALTER TABLE "ClassSubmission" ADD COLUMN "receipt" JSONB;
ALTER TABLE "ClassSubmission" ADD COLUMN "history" JSONB;
ALTER TYPE "PracticeStatus" ADD VALUE 'GENERATING';
ALTER TYPE "PracticeStatus" ADD VALUE 'FAILED';
ALTER TYPE "PracticeStatus" ADD VALUE 'CANCELLED';
ALTER TABLE "PracticeSession" ADD COLUMN "generationSpec" JSONB;
ALTER TABLE "PracticeSession" ADD COLUMN "generationState" JSONB;
ALTER TABLE "WritingResponse" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "PracticeRequestReceipt" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeRequestReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeRequestReceipt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeRequestReceipt_courseId_idx" ON "PracticeRequestReceipt"("courseId");
ALTER TABLE "ClassSubmission" ADD COLUMN "attempt" INTEGER;

ALTER TABLE "WritingResponse" ADD COLUMN "gradingState" JSONB;

ALTER TABLE "PracticeSession" ADD COLUMN "listeningScriptHash" TEXT;
