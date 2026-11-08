ALTER TYPE "SpeakingGradeStatus" ADD VALUE IF NOT EXISTS 'UNRESOLVED';

ALTER TABLE "SpeakingRecording" ADD COLUMN "gradingOperationId" TEXT;

ALTER TABLE "SpeakingRecording" ADD COLUMN "gradingAcknowledgedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "SpeakingRecording_gradingOperationId_key" ON "SpeakingRecording"("gradingOperationId");
