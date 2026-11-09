BEGIN;
LOCK TABLE "CourseClass", "ClassSection", "SpeakingPrompt", "SpeakingRecording" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "SpeakingPrompt" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "SpeakingPrompt" ADD COLUMN "referenceEncryption" JSONB;
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_referenceEncryption_requires_reference"
  CHECK ("referenceEncryption" IS NULL OR "referenceTtsUrl" IS NOT NULL);
ALTER TABLE "SpeakingRecording" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "SpeakingPrompt_incarnationId_key" ON "SpeakingPrompt"("incarnationId");
CREATE UNIQUE INDEX "SpeakingRecording_incarnationId_key" ON "SpeakingRecording"("incarnationId");
CREATE TRIGGER "SpeakingPrompt_incarnation_guard" BEFORE INSERT OR UPDATE ON "SpeakingPrompt"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();
CREATE TRIGGER "SpeakingRecording_incarnation_guard" BEFORE INSERT OR UPDATE ON "SpeakingRecording"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();
CREATE TABLE "ClassSpeakingStage" (
  "sectionId" TEXT NOT NULL,
  "operationId" UUID NOT NULL,
  "incarnationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "materialHash" TEXT NOT NULL,
  "sealedHash" TEXT,
  CONSTRAINT "ClassSpeakingStage_pkey" PRIMARY KEY ("sectionId"),
  CONSTRAINT "ClassSpeakingStage_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassSpeakingStage_version_check" CHECK ("version" = 1),
  CONSTRAINT "ClassSpeakingStage_sourceHash_check" CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassSpeakingStage_materialHash_check" CHECK ("materialHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassSpeakingStage_sealedHash_check" CHECK ("sealedHash" IS NULL OR "sealedHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "ClassSpeakingStage_operationId_key" ON "ClassSpeakingStage"("operationId");
CREATE FUNCTION "guardClassSpeakingStage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ClassSection" WHERE id = NEW."sectionId"
      AND "incarnationId" = NEW."incarnationId" AND skill = 'SPEAKING' AND withdrawn = true
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Speaking stage requires its withdrawn section';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSpeakingStage_guard" BEFORE INSERT OR UPDATE ON "ClassSpeakingStage"
  FOR EACH ROW EXECUTE FUNCTION "guardClassSpeakingStage"();
CREATE FUNCTION "guardStagedSpeakingActivation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawn = false AND EXISTS (
    SELECT 1 FROM "ClassSpeakingStage" WHERE "sectionId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Staged speaking must be released before activation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_staged_speaking_guard" BEFORE UPDATE OF withdrawn ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "guardStagedSpeakingActivation"();
COMMIT;
