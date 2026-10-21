ALTER TABLE "MaterialAnalysisUnit" ADD COLUMN "cancellationVerifiedAt" TIMESTAMP(3);
CREATE INDEX "MaterialAnalysisUnit_cancellation_verification_idx"
  ON "MaterialAnalysisUnit"("analysisId", "cancellationVerifiedAt", "id");
