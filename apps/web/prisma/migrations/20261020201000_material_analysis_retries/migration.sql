ALTER TABLE "MaterialAnalysis" ADD COLUMN "retryOfAnalysisId" TEXT;
ALTER TABLE "MaterialAnalysis" ADD COLUMN "retryCounts" JSONB;
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_retryOfAnalysisId_fkey"
  FOREIGN KEY ("retryOfAnalysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "MaterialAnalysis_userId_identityDigest_key";
CREATE INDEX "MaterialAnalysis_userId_identityDigest_idx" ON "MaterialAnalysis"("userId", "identityDigest");

ALTER TABLE "MaterialAnalysisSource" ADD COLUMN "sourceId" TEXT;
UPDATE "MaterialAnalysisSource" SET "sourceId" = COALESCE("materialId", "id");
ALTER TABLE "MaterialAnalysisSource" ALTER COLUMN "sourceId" SET NOT NULL;
CREATE UNIQUE INDEX "MaterialAnalysisSource_analysisId_sourceId_key" ON "MaterialAnalysisSource"("analysisId", "sourceId");

ALTER TABLE "MaterialAnalysisUnit" ALTER COLUMN "grant" DROP NOT NULL;
ALTER TABLE "MaterialAnalysisUnit" ADD COLUMN "reuse" JSONB;
