-- CreateTable
CREATE TABLE "MaterialAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGeneration" BIGINT NOT NULL,
    "nativeLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "intendedCourseId" TEXT,
    "attachedCourseId" TEXT,
    "purpose" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "admissionDigest" TEXT NOT NULL,
    "sourceSetDigest" TEXT NOT NULL,
    "catalogRevisionId" TEXT,
    "policy" JSONB NOT NULL,
    "identity" JSONB,
    "identityDigest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING_SOURCE',
    "coverage" JSONB,
    "summary" JSONB,
    "resultBytes" BYTEA,
    "resultDigest" TEXT,
    "acceptedReceiptId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialAnalysisRequest" (
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "intentDigest" TEXT NOT NULL,

    CONSTRAINT "MaterialAnalysisRequest_pkey" PRIMARY KEY ("userId","requestId")
);

-- CreateTable
CREATE TABLE "MaterialAnalysisSource" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "materialId" TEXT,
    "materialGeneration" BIGINT,
    "runId" TEXT,
    "processingRevision" INTEGER,
    "originalSha256" TEXT,
    "snapshotBytes" BYTEA,
    "snapshotSha256" TEXT,
    "noteId" TEXT,
    "noteGeneration" BIGINT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "inventory" JSONB,
    "inventoryDigest" TEXT,

    CONSTRAINT "MaterialAnalysisSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialAnalysisUnit" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "identityDigest" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "grant" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "attemptId" TEXT,
    "attemptFingerprint" TEXT,
    "responseKind" TEXT,
    "responseMetadata" JSONB,
    "responseBytes" BYTEA,
    "responseSha256" TEXT,
    "outputBytes" BYTEA,
    "outputSha256" TEXT,
    "admittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialAnalysisUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSourceFocus" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "localKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "level" "CefrLevel",
    "objectiveIds" JSONB NOT NULL,
    "detailsBytes" BYTEA NOT NULL,
    "detailsSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialSourceFocus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementSession" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "semanticDigest" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "grant" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "attemptId" TEXT,
    "attemptFingerprint" TEXT,
    "responseKind" TEXT,
    "responseMetadata" JSONB,
    "responseBytes" BYTEA,
    "responseSha256" TEXT,
    "admittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "userId" TEXT NOT NULL,
    "userGeneration" BIGINT NOT NULL,
    "nativeLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "analysisId" TEXT,
    "analysisRevision" INTEGER,
    "analysisDigest" TEXT,
    "questionsBytes" BYTEA NOT NULL,
    "questionsDigest" TEXT NOT NULL,
    "scoringVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "acceptedReceiptId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementConfirmationReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "analysisId" TEXT,
    "sessionId" TEXT,
    "intentDigest" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementConfirmationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysis_acceptedReceiptId_key" ON "MaterialAnalysis"("acceptedReceiptId");

-- CreateIndex
CREATE INDEX "MaterialAnalysis_userId_nativeLang_targetLang_status_idx" ON "MaterialAnalysis"("userId", "nativeLang", "targetLang", "status");

-- CreateIndex
CREATE INDEX "MaterialAnalysis_status_updatedAt_idx" ON "MaterialAnalysis"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MaterialAnalysis_userId_sourceSetDigest_idx" ON "MaterialAnalysis"("userId", "sourceSetDigest");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysis_userId_requestId_key" ON "MaterialAnalysis"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysis_userId_admissionDigest_key" ON "MaterialAnalysis"("userId", "admissionDigest");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysis_userId_identityDigest_key" ON "MaterialAnalysis"("userId", "identityDigest");

-- CreateIndex
CREATE INDEX "MaterialAnalysisSource_materialId_idx" ON "MaterialAnalysisSource"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysisSource_analysisId_order_key" ON "MaterialAnalysisSource"("analysisId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysisSource_analysisId_materialId_key" ON "MaterialAnalysisSource"("analysisId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysisUnit_attemptId_key" ON "MaterialAnalysisUnit"("attemptId");

-- CreateIndex
CREATE INDEX "MaterialAnalysisUnit_status_updatedAt_idx" ON "MaterialAnalysisUnit"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAnalysisUnit_analysisId_stage_unitKey_key" ON "MaterialAnalysisUnit"("analysisId", "stage", "unitKey");

-- CreateIndex
CREATE INDEX "MaterialSourceFocus_analysisId_order_id_idx" ON "MaterialSourceFocus"("analysisId", "order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSourceFocus_analysisId_localKey_key" ON "MaterialSourceFocus"("analysisId", "localKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementSession_attemptId_key" ON "PlacementSession"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementSession_acceptedReceiptId_key" ON "PlacementSession"("acceptedReceiptId");

-- CreateIndex
CREATE INDEX "PlacementSession_userId_createdAt_idx" ON "PlacementSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PlacementSession_userId_semanticDigest_status_idx" ON "PlacementSession"("userId", "semanticDigest", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementSession_userId_requestId_key" ON "PlacementSession"("userId", "requestId");

-- CreateIndex
CREATE INDEX "PlacementConfirmationReceipt_courseId_idx" ON "PlacementConfirmationReceipt"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementConfirmationReceipt_userId_requestId_key" ON "PlacementConfirmationReceipt"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_intendedCourseId_fkey" FOREIGN KEY ("intendedCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_attachedCourseId_fkey" FOREIGN KEY ("attachedCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_catalogRevisionId_fkey" FOREIGN KEY ("catalogRevisionId") REFERENCES "LearningMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisRequest" ADD CONSTRAINT "MaterialAnalysisRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisRequest" ADD CONSTRAINT "MaterialAnalysisRequest_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisSource" ADD CONSTRAINT "MaterialAnalysisSource_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisSource" ADD CONSTRAINT "MaterialAnalysisSource_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "CourseMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisSource" ADD CONSTRAINT "MaterialAnalysisSource_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MaterialExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAnalysisUnit" ADD CONSTRAINT "MaterialAnalysisUnit_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSourceFocus" ADD CONSTRAINT "MaterialSourceFocus_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementConfirmationReceipt" ADD CONSTRAINT "PlacementConfirmationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementConfirmationReceipt" ADD CONSTRAINT "PlacementConfirmationReceipt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementConfirmationReceipt" ADD CONSTRAINT "PlacementConfirmationReceipt_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "MaterialAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementConfirmationReceipt" ADD CONSTRAINT "PlacementConfirmationReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlacementSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_identity_check" CHECK (
  "revision" > 0 AND "userGeneration" > 0 AND "nativeLang" ~ '^[a-z]{2}$' AND "targetLang" ~ '^[a-z]{2}$'
  AND "nativeLang" <> "targetLang" AND "admissionDigest" ~ '^[a-f0-9]{64}$' AND "sourceSetDigest" ~ '^[a-f0-9]{64}$'
  AND ("identityDigest" IS NULL OR "identityDigest" ~ '^[a-f0-9]{64}$')
  AND (("resultBytes" IS NULL AND "resultDigest" IS NULL) OR ("resultBytes" IS NOT NULL AND "resultDigest" ~ '^[a-f0-9]{64}$' AND octet_length("resultBytes") <= 33554432)));
ALTER TABLE "MaterialAnalysis" ADD CONSTRAINT "MaterialAnalysis_status_check" CHECK (
  "status" IN ('WAITING_SOURCE','RUNNING','COMPLETE','PARTIAL','INSUFFICIENT_SOURCE','FAILED','RECOVERY_REQUIRED','CANCELLING','CANCELLED','SUPERSEDED'));
ALTER TABLE "MaterialAnalysisSource" ADD CONSTRAINT "MaterialAnalysisSource_kind_check" CHECK (
  "order" >= 0 AND "revision" > 0 AND (
    ("kind" = 'MATERIAL' AND "materialId" IS NOT NULL AND "materialGeneration" > 0 AND "runId" IS NOT NULL AND "processingRevision" > 0 AND "originalSha256" ~ '^[a-f0-9]{64}$' AND "snapshotBytes" IS NULL AND "snapshotSha256" IS NULL)
    OR ("kind" IN ('PASTE','COURSE_NOTE') AND "materialId" IS NULL AND "runId" IS NULL AND "snapshotBytes" IS NOT NULL AND octet_length("snapshotBytes") <= 131072 AND "snapshotSha256" ~ '^[a-f0-9]{64}$')));
ALTER TABLE "MaterialAnalysisSource" ADD CONSTRAINT "MaterialAnalysisSource_note_check" CHECK (
  ("kind" = 'COURSE_NOTE' AND "noteId" IS NOT NULL AND "noteGeneration" > 0)
  OR ("kind" <> 'COURSE_NOTE' AND "noteId" IS NULL AND "noteGeneration" IS NULL));
ALTER TABLE "MaterialAnalysisUnit" ADD CONSTRAINT "MaterialAnalysisUnit_bounds_check" CHECK (
  "stage" = 'DISCOVERY' AND "mode" IN ('HTTP','CLI') AND "identityDigest" ~ '^[a-f0-9]{64}$' AND "inputDigest" ~ '^[a-f0-9]{64}$'
  AND "status" IN ('READY','DISPATCHING','SUCCEEDED','FAILED','UNKNOWN','ANALYZED','OUTPUT_INVALID')
  AND octet_length("identity"::text) <= 131072 AND octet_length("grant"::text) <= 16384
  AND ("responseMetadata" IS NULL OR octet_length("responseMetadata"::text) <= 32768)
  AND ("responseBytes" IS NULL OR (octet_length("responseBytes") <= 524288 AND "responseSha256" ~ '^[a-f0-9]{64}$'))
  AND ("outputBytes" IS NULL OR (octet_length("outputBytes") <= 524288 AND "outputSha256" ~ '^[a-f0-9]{64}$')));
ALTER TABLE "MaterialSourceFocus" ADD CONSTRAINT "MaterialSourceFocus_bounds_check" CHECK (
  "order" >= 0 AND "detailsSha256" ~ '^[a-f0-9]{64}$' AND octet_length("detailsBytes") <= 1048576);
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_bounds_check" CHECK (
  "userGeneration" > 0 AND "scoringVersion" = 1 AND "semanticDigest" ~ '^[a-f0-9]{64}$' AND "inputDigest" ~ '^[a-f0-9]{64}$'
  AND "questionsDigest" ~ '^[a-f0-9]{64}$' AND octet_length("questionsBytes") <= 1048576
  AND octet_length("input"::text) <= 262144 AND octet_length("grant"::text) <= 16384
  AND ("responseBytes" IS NULL OR (octet_length("responseBytes") <= 524288 AND "responseSha256" ~ '^[a-f0-9]{64}$'))
  AND ("responseMetadata" IS NULL OR octet_length("responseMetadata"::text) <= 32768));
