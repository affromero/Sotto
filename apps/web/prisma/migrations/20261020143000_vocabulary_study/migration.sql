ALTER TABLE "LearnerVocab"
  ADD COLUMN "acceptedMeanings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "introducedAt" TIMESTAMP(3);

ALTER TABLE "PracticeSession" ADD COLUMN "vocabularyStudy" JSONB;

ALTER TABLE "LearnerReviewEvent" DROP CONSTRAINT "LearnerReviewEvent_assessment_check";
ALTER TABLE "LearnerReviewEvent" ADD CONSTRAINT "LearnerReviewEvent_assessment_check"
  CHECK ("assessment" IN ('VOCAB_CHOICE', 'READING_VOCABULARY', 'SECTION_AGGREGATE',
    'MEANING_RECALL', 'WORD_RECALL', 'LISTENING_RECALL'));
