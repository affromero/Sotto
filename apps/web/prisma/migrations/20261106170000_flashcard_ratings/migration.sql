CREATE TABLE "FlashcardRating" (
    "practiceSessionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlashcardRating_pkey" PRIMARY KEY ("practiceSessionId", "cardId"),
    CONSTRAINT "FlashcardRating_rating_check" CHECK ("rating" IN ('KNOWN', 'UNKNOWN')),
    CONSTRAINT "FlashcardRating_practiceSessionId_courseId_fkey" FOREIGN KEY ("practiceSessionId", "courseId")
        REFERENCES "PracticeSession"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "LearnerReviewEvent" DROP CONSTRAINT "LearnerReviewEvent_assessment_check";
ALTER TABLE "LearnerReviewEvent" ADD CONSTRAINT "LearnerReviewEvent_assessment_check"
    CHECK ("assessment" IN ('VOCAB_CHOICE', 'READING_VOCABULARY', 'SECTION_AGGREGATE',
        'MEANING_RECALL', 'WORD_RECALL', 'LISTENING_RECALL', 'FLASHCARD_SELF_ASSESSMENT'));

CREATE TABLE "FlashcardExample" (
    "practiceSessionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "examples" JSONB,
    CONSTRAINT "FlashcardExample_status_check" CHECK ("status" IN ('PENDING', 'PUBLISHING', 'READY', 'FAILED', 'UNRESOLVED')),
    CONSTRAINT "FlashcardExample_pkey" PRIMARY KEY ("practiceSessionId", "cardId"),
    CONSTRAINT "FlashcardExample_practiceSessionId_courseId_fkey" FOREIGN KEY ("practiceSessionId", "courseId")
        REFERENCES "PracticeSession"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "VocabularyRefill" (
    "courseId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "operationId" TEXT NOT NULL,
    "triggerSessionId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "added" INTEGER,
    "wordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "VocabularyRefill_pkey" PRIMARY KEY ("courseId"),
    CONSTRAINT "VocabularyRefill_operationId_key" UNIQUE ("operationId"),
    CONSTRAINT "VocabularyRefill_status_check" CHECK ("status" IN ('PENDING', 'PUBLISHING', 'READY', 'FAILED', 'UNRESOLVED')),
    CONSTRAINT "VocabularyRefill_courseId_fkey" FOREIGN KEY ("courseId")
        REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
