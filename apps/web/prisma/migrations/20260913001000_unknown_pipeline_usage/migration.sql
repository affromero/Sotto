-- Preserve historical measurements. Missing future measurements remain unknown.
ALTER TABLE "ResearchDossier"
  ALTER COLUMN "totalInputTokens" DROP NOT NULL,
  ALTER COLUMN "totalInputTokens" DROP DEFAULT,
  ALTER COLUMN "totalOutputTokens" DROP NOT NULL,
  ALTER COLUMN "totalOutputTokens" DROP DEFAULT;

ALTER TABLE "CreativeOutline"
  ALTER COLUMN "inputTokens" DROP NOT NULL,
  ALTER COLUMN "inputTokens" DROP DEFAULT,
  ALTER COLUMN "outputTokens" DROP NOT NULL,
  ALTER COLUMN "outputTokens" DROP DEFAULT;
