CREATE TABLE "MaterialRecognitionOperation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "identityDigest" TEXT NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "pageImageSha256" TEXT NOT NULL,
  "identity" JSONB NOT NULL,
  "grant" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "attemptId" TEXT,
  "attemptFingerprint" TEXT,
  "admittedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialRecognitionOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialRecognitionOperation_mode_check" CHECK ("mode" IN ('HTTP', 'CLI')),
  CONSTRAINT "MaterialRecognitionOperation_identity_check" CHECK (
    "pageNumber" > 0 AND "identityDigest" ~ '^[a-f0-9]{64}$' AND "inputDigest" ~ '^[a-f0-9]{64}$'
    AND "originalSha256" ~ '^[a-f0-9]{64}$' AND "pageImageSha256" ~ '^[a-f0-9]{64}$'
    AND octet_length("identity"::text) <= 131072 AND octet_length("grant"::text) <= 16384),
  CONSTRAINT "MaterialRecognitionOperation_status_check" CHECK (
    ("status" = 'READY' AND "attemptId" IS NULL AND "attemptFingerprint" IS NULL AND "admittedAt" IS NULL AND "settledAt" IS NULL)
    OR ("status" = 'DISPATCHING' AND "attemptId" IS NOT NULL AND "attemptFingerprint" IS NOT NULL AND "attemptFingerprint" ~ '^[a-f0-9]{64}$' AND "admittedAt" IS NOT NULL AND "settledAt" IS NULL)
    OR ("status" IN ('SUCCEEDED', 'FAILED', 'UNKNOWN') AND "attemptId" IS NOT NULL AND "attemptFingerprint" IS NOT NULL AND "attemptFingerprint" ~ '^[a-f0-9]{64}$' AND "admittedAt" IS NOT NULL AND "settledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "MaterialRecognitionOperation_attemptId_key" ON "MaterialRecognitionOperation"("attemptId");
CREATE UNIQUE INDEX "MaterialRecognitionOperation_runId_identityDigest_key" ON "MaterialRecognitionOperation"("runId", "identityDigest");
CREATE INDEX "MaterialRecognitionOperation_status_updatedAt_idx" ON "MaterialRecognitionOperation"("status", "updatedAt");
ALTER TABLE "MaterialRecognitionOperation" ADD CONSTRAINT "MaterialRecognitionOperation_runId_pageNumber_fkey"
  FOREIGN KEY ("runId", "pageNumber") REFERENCES "MaterialPage"("runId", "pageNumber") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MaterialRecognitionResponse" (
  "operationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "body" BYTEA NOT NULL,
  "bodySha256" TEXT NOT NULL,
  "bodyBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialRecognitionResponse_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "MaterialRecognitionResponse_bounds_check" CHECK (
    "kind" IN ('HTTP', 'CLI') AND "bodySha256" ~ '^[a-f0-9]{64}$' AND "bodyBytes" BETWEEN 0 AND 524288
    AND octet_length("body") = "bodyBytes" AND octet_length("metadata"::text) <= 32768)
);
ALTER TABLE "MaterialRecognitionResponse" ADD CONSTRAINT "MaterialRecognitionResponse_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "MaterialRecognitionOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
