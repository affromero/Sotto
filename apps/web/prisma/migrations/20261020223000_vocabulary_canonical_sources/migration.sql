ALTER TABLE "MaterialVocabularyIndex" ADD COLUMN "sourceSnapshot" JSONB;
ALTER TABLE "VocabularyIndexChunk" ADD COLUMN "resultBytes" BYTEA;
ALTER TABLE "VocabularySourceOccurrence" ALTER COLUMN "quote" DROP NOT NULL;
ALTER TABLE "VocabularySourceOccurrence" ADD COLUMN "quoteBytes" BYTEA;
ALTER TABLE "VocabularySourceOccurrence" ADD CONSTRAINT "VocabularySourceOccurrence_exact_quote"
  CHECK ("quote" IS NOT NULL OR "quoteBytes" IS NOT NULL);
