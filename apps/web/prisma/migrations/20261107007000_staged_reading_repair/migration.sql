CREATE TABLE "ClassReadingStage" (
  "sectionId" TEXT NOT NULL,
  "operationId" UUID NOT NULL,
  "incarnationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "source" JSONB NOT NULL,
  "vocabulary" JSONB NOT NULL,
  "materialHash" TEXT NOT NULL,
  CONSTRAINT "ClassReadingStage_pkey" PRIMARY KEY ("sectionId"),
  CONSTRAINT "ClassReadingStage_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassReadingStage_materialHash_check" CHECK ("materialHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassReadingStage_version_check" CHECK ("version" = 1)
);
CREATE UNIQUE INDEX "ClassReadingStage_operationId_key" ON "ClassReadingStage"("operationId");

CREATE FUNCTION "guardClassReadingStage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ClassSection"
    WHERE id = NEW."sectionId" AND "incarnationId" = NEW."incarnationId"
      AND skill = 'READING' AND withdrawn = true
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Reading stage requires its withdrawn section';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassReadingStage_guard" BEFORE INSERT OR UPDATE ON "ClassReadingStage"
  FOR EACH ROW EXECUTE FUNCTION "guardClassReadingStage"();

CREATE FUNCTION "guardStagedReadingActivation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawn = false AND EXISTS (
    SELECT 1 FROM "ClassReadingStage" WHERE "sectionId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Staged reading must be released before activation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_staged_reading_guard" BEFORE UPDATE OF withdrawn ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "guardStagedReadingActivation"();
