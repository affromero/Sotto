CREATE UNIQUE INDEX "CourseClass_id_courseId_key" ON "CourseClass"("id", "courseId");
CREATE UNIQUE INDEX "PracticeSession_id_courseId_key" ON "PracticeSession"("id", "courseId");
CREATE UNIQUE INDEX "LearnerVocab_id_courseId_key" ON "LearnerVocab"("id", "courseId");
CREATE UNIQUE INDEX "LearnerGrammar_id_courseId_key" ON "LearnerGrammar"("id", "courseId");

CREATE TABLE "LearnerReviewEvent" (
  "sequence" BIGSERIAL PRIMARY KEY,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "vocabId" TEXT,
  "grammarId" TEXT,
  "classId" TEXT,
  "practiceSessionId" TEXT,
  "sourceAttempt" INTEGER NOT NULL CHECK ("sourceAttempt" > 0),
  "assessment" TEXT NOT NULL CHECK ("assessment" IN ('VOCAB_CHOICE', 'READING_VOCABULARY', 'SECTION_AGGREGATE')),
  "questionIds" TEXT[] NOT NULL,
  "quality" DOUBLE PRECISION NOT NULL CHECK ("quality" >= 0 AND "quality" <= 1),
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "schedulerVersion" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  CONSTRAINT "LearnerReviewEvent_target_check" CHECK (num_nonnulls("vocabId", "grammarId") = 1),
  CONSTRAINT "LearnerReviewEvent_source_check" CHECK (num_nonnulls("classId", "practiceSessionId") = 1),
  CONSTRAINT "LearnerReviewEvent_vocabId_courseId_fkey" FOREIGN KEY ("vocabId", "courseId") REFERENCES "LearnerVocab"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearnerReviewEvent_grammarId_courseId_fkey" FOREIGN KEY ("grammarId", "courseId") REFERENCES "LearnerGrammar"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearnerReviewEvent_classId_courseId_fkey" FOREIGN KEY ("classId", "courseId") REFERENCES "CourseClass"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearnerReviewEvent_practiceSessionId_courseId_fkey" FOREIGN KEY ("practiceSessionId", "courseId") REFERENCES "PracticeSession"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LearnerReviewEvent_courseId_reviewedAt_sequence_idx" ON "LearnerReviewEvent"("courseId", "reviewedAt", "sequence");
CREATE INDEX "LearnerReviewEvent_vocabId_sequence_idx" ON "LearnerReviewEvent"("vocabId", "sequence");
CREATE INDEX "LearnerReviewEvent_grammarId_sequence_idx" ON "LearnerReviewEvent"("grammarId", "sequence");
CREATE INDEX "LearnerReviewEvent_classId_idx" ON "LearnerReviewEvent"("classId");
CREATE INDEX "LearnerReviewEvent_practiceSessionId_idx" ON "LearnerReviewEvent"("practiceSessionId");
