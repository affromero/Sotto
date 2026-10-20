CREATE TYPE "VocabularySupport" AS ENUM ('MEANING_RECALL', 'WORD_RECALL', 'LISTENING_RECOGNITION');

ALTER TABLE "Course" ADD COLUMN "vocabularySupport" "VocabularySupport";
