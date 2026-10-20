ALTER TABLE "CourseMaterial"
ADD COLUMN "originalSha256" TEXT,
ADD COLUMN "optimizedUrl" TEXT,
ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "processingRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "processingError" TEXT;

CREATE TABLE "MaterialUploadBatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialUploadBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialUploadBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MaterialUploadBatch_userId_requestId_key" ON "MaterialUploadBatch"("userId", "requestId");
CREATE INDEX "MaterialUploadBatch_userId_expiresAt_idx" ON "MaterialUploadBatch"("userId", "expiresAt");

CREATE TABLE "MaterialUpload" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "expectedSha256" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UPLOADING',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "finalizationOperationId" TEXT,
  "failureReason" TEXT,
  "cleanupJobIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialUpload_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialUploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaterialUpload_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "CourseMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaterialUpload_status_check" CHECK ("status" IN ('UPLOADING', 'FINALIZING', 'COMPLETE', 'CANCELLED', 'EXPIRED', 'FAILED')),
  CONSTRAINT "MaterialUpload_completion_check" CHECK (("status" = 'COMPLETE') = ("completedAt" IS NOT NULL)),
  CONSTRAINT "MaterialUpload_revision_check" CHECK ("revision" >= 0)
);
CREATE UNIQUE INDEX "MaterialUpload_materialId_key" ON "MaterialUpload"("materialId");
CREATE UNIQUE INDEX "MaterialUpload_batchId_clientId_key" ON "MaterialUpload"("batchId", "clientId");
CREATE INDEX "MaterialUpload_status_expiresAt_idx" ON "MaterialUpload"("status", "expiresAt");

CREATE TABLE "MaterialUploadPart" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "offset" INTEGER NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "writeToken" TEXT NOT NULL,
  "originalUrl" TEXT,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialUploadPart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialUploadPart_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "MaterialUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaterialUploadPart_bounds_check" CHECK ("index" >= 0 AND "offset" >= 0 AND "byteSize" > 0 AND "byteSize" <= 4194304),
  CONSTRAINT "MaterialUploadPart_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "MaterialUploadPart_receipt_check" CHECK (("originalUrl" IS NOT NULL) = ("committedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "MaterialUploadPart_uploadId_index_key" ON "MaterialUploadPart"("uploadId", "index");
