BEGIN;
LOCK TABLE "CourseClass", "ClassSection", "WritingPrompt", "WritingResponse" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "WritingPrompt" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "WritingResponse" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "WritingPrompt_incarnationId_key" ON "WritingPrompt"("incarnationId");
CREATE UNIQUE INDEX "WritingResponse_incarnationId_key" ON "WritingResponse"("incarnationId");
CREATE FUNCTION "guardWritingIncarnation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."incarnationId" := gen_random_uuid();
  ELSIF OLD."incarnationId" IS DISTINCT FROM NEW."incarnationId" THEN
    RAISE EXCEPTION 'Writing incarnation cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WritingPrompt_incarnation_guard" BEFORE INSERT OR UPDATE ON "WritingPrompt"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();
CREATE TRIGGER "WritingResponse_incarnation_guard" BEFORE INSERT OR UPDATE ON "WritingResponse"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();
CREATE TABLE "ClassWritingStage" (
  "sectionId" TEXT NOT NULL,
  "operationId" UUID NOT NULL,
  "incarnationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "materialHash" TEXT NOT NULL,
  CONSTRAINT "ClassWritingStage_pkey" PRIMARY KEY ("sectionId"),
  CONSTRAINT "ClassWritingStage_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassWritingStage_version_check" CHECK ("version" = 1),
  CONSTRAINT "ClassWritingStage_sourceHash_check" CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassWritingStage_materialHash_check" CHECK ("materialHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "ClassWritingStage_operationId_key" ON "ClassWritingStage"("operationId");
CREATE FUNCTION "guardClassWritingStage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ClassSection" WHERE id = NEW."sectionId"
      AND "incarnationId" = NEW."incarnationId" AND skill = 'WRITING' AND withdrawn = true
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Writing stage requires its withdrawn section';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassWritingStage_guard" BEFORE INSERT OR UPDATE ON "ClassWritingStage"
  FOR EACH ROW EXECUTE FUNCTION "guardClassWritingStage"();
CREATE FUNCTION "guardStagedWritingActivation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawn = false AND EXISTS (
    SELECT 1 FROM "ClassWritingStage" WHERE "sectionId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Staged writing must be released before activation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_staged_writing_guard" BEFORE UPDATE OF withdrawn ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "guardStagedWritingActivation"();
COMMIT;
