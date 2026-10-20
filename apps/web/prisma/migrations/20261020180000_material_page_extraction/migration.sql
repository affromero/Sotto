-- CreateTable
ALTER TABLE "CourseMaterial" ADD COLUMN "optimizationReceipt" JSONB;

CREATE TABLE "MaterialExtractionRun" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "processingRevision" INTEGER NOT NULL,
    "runKey" TEXT NOT NULL,
    "requestId" TEXT,
    "originalSha256" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "rendererVersion" TEXT NOT NULL,
    "recognitionPolicy" JSONB NOT NULL,
    "providerSelection" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pageCount" INTEGER,
    "coverage" JSONB,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "rotation" INTEGER,
    "pageImageSha256" TEXT,
    "renderIdentity" JSONB,
    "embeddedText" JSONB NOT NULL,
    "visualCoverage" JSONB NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPageText" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,

    CONSTRAINT "MaterialPageText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialTextChunk" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "codePointStart" INTEGER NOT NULL,
    "codePointEnd" INTEGER NOT NULL,
    "utf8ByteStart" INTEGER NOT NULL,
    "utf8ByteEnd" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "textBytes" BYTEA NOT NULL,

    CONSTRAINT "MaterialTextChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialExtractionRun_runKey_key" ON "MaterialExtractionRun"("runKey");

-- CreateIndex
CREATE INDEX "MaterialExtractionRun_status_createdAt_idx" ON "MaterialExtractionRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialExtractionRun_materialId_processingRevision_key" ON "MaterialExtractionRun"("materialId", "processingRevision");
CREATE UNIQUE INDEX "MaterialExtractionRun_materialId_requestId_key" ON "MaterialExtractionRun"("materialId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPage_runId_pageNumber_key" ON "MaterialPage"("runId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPageText_pageId_origin_key" ON "MaterialPageText"("pageId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialTextChunk_streamId_index_key" ON "MaterialTextChunk"("streamId", "index");

-- AddForeignKey
ALTER TABLE "MaterialExtractionRun" ADD CONSTRAINT "MaterialExtractionRun_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "CourseMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPage" ADD CONSTRAINT "MaterialPage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MaterialExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPageText" ADD CONSTRAINT "MaterialPageText_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MaterialPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTextChunk" ADD CONSTRAINT "MaterialTextChunk_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "MaterialPageText"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialExtractionRun" ADD CONSTRAINT "MaterialExtractionRun_identity_check" CHECK ("processingRevision" > 0 AND "originalSha256" ~ '^[a-f0-9]{64}$' AND ("pageCount" IS NULL OR "pageCount" > 0));
ALTER TABLE "MaterialExtractionRun" ADD CONSTRAINT "MaterialExtractionRun_status_check" CHECK ("status" IN ('PENDING', 'EXTRACTING', 'COMPLETE', 'PARTIAL', 'FAILED', 'RECOVERY_REQUIRED'));
ALTER TABLE "MaterialPage" ADD CONSTRAINT "MaterialPage_number_check" CHECK ("pageNumber" > 0);
ALTER TABLE "MaterialPageText" ADD CONSTRAINT "MaterialPageText_origin_check" CHECK ("origin" IN ('EMBEDDED_TEXT', 'VISUAL_RECOGNITION'));
ALTER TABLE "MaterialTextChunk" ADD CONSTRAINT "MaterialTextChunk_bounds_check" CHECK ("index" >= 0 AND "codePointStart" >= 0 AND "codePointEnd" > "codePointStart" AND "codePointEnd" - "codePointStart" <= 16000 AND "utf8ByteStart" >= 0 AND "utf8ByteEnd" > "utf8ByteStart" AND "utf8ByteEnd" - "utf8ByteStart" <= 64000 AND octet_length("textBytes") = "utf8ByteEnd" - "utf8ByteStart" AND "sha256" ~ '^[a-f0-9]{64}$');
