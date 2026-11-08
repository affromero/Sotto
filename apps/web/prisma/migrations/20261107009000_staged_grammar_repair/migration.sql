BEGIN;
LOCK TABLE "CourseClass", "ClassSection", "LessonQuestion", "ClassSubmission", "SectionAnswer" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "ClassGrammarStage" (
  "sectionId" TEXT NOT NULL,
  "operationId" UUID NOT NULL,
  "incarnationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "materialHash" TEXT NOT NULL,
  CONSTRAINT "ClassGrammarStage_pkey" PRIMARY KEY ("sectionId"),
  CONSTRAINT "ClassGrammarStage_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassGrammarStage_sourceHash_check" CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassGrammarStage_materialHash_check" CHECK ("materialHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ClassGrammarStage_version_check" CHECK ("version" = 1)
);
CREATE UNIQUE INDEX "ClassGrammarStage_operationId_key" ON "ClassGrammarStage"("operationId");

CREATE FUNCTION "guardClassGrammarStage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ClassSection"
    WHERE id = NEW."sectionId" AND "incarnationId" = NEW."incarnationId"
      AND skill = 'GRAMMAR' AND withdrawn = true
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Grammar stage requires its withdrawn section';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassGrammarStage_guard" BEFORE INSERT OR UPDATE ON "ClassGrammarStage"
  FOR EACH ROW EXECUTE FUNCTION "guardClassGrammarStage"();

CREATE FUNCTION "guardStagedGrammarActivation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdrawn = false AND EXISTS (
    SELECT 1 FROM "ClassGrammarStage" WHERE "sectionId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Staged grammar must be released before activation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_staged_grammar_guard" BEFORE UPDATE OF withdrawn ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "guardStagedGrammarActivation"();

ALTER TABLE "ClassSubmission" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "SectionAnswer" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "ClassSubmission_incarnationId_key" ON "ClassSubmission"("incarnationId");
CREATE UNIQUE INDEX "SectionAnswer_incarnationId_key" ON "SectionAnswer"("incarnationId");
CREATE INDEX "SectionAnswer_questionId_idx" ON "SectionAnswer"("questionId");
CREATE TRIGGER "ClassSubmission_incarnation_guard" BEFORE INSERT OR UPDATE ON "ClassSubmission"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();
CREATE TRIGGER "SectionAnswer_incarnation_guard" BEFORE INSERT OR UPDATE ON "SectionAnswer"
  FOR EACH ROW EXECUTE FUNCTION "guardWritingIncarnation"();

CREATE FUNCTION "touchClassSubmissionStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM (
      SELECT "classId" FROM old_rows UNION SELECT "classId" FROM new_rows
    ) changed;
  END IF;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;
CREATE TRIGGER "ClassSubmission_formative_insert" AFTER INSERT ON "ClassSubmission"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchClassSubmissionStatement"();
CREATE TRIGGER "ClassSubmission_formative_update" AFTER UPDATE ON "ClassSubmission"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchClassSubmissionStatement"();
CREATE TRIGGER "ClassSubmission_formative_delete" AFTER DELETE ON "ClassSubmission"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchClassSubmissionStatement"();

CREATE FUNCTION "touchSectionAnswerStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[]; rows_query TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    rows_query := 'SELECT "submissionId", "sectionId", "questionId" FROM new_rows';
  ELSIF TG_OP = 'DELETE' THEN
    rows_query := 'SELECT "submissionId", "sectionId", "questionId" FROM old_rows';
  ELSE
    rows_query := 'SELECT "submissionId", "sectionId", "questionId" FROM old_rows UNION ALL SELECT "submissionId", "sectionId", "questionId" FROM new_rows';
  END IF;
  EXECUTE format(
    'SELECT array_agg(DISTINCT class_id) FROM (
       SELECT s."classId" AS class_id FROM (%1$s) a JOIN "ClassSubmission" s ON s.id = a."submissionId"
       UNION SELECT s."classId" FROM (%1$s) a JOIN "ClassSection" s ON s.id = a."sectionId"
       UNION SELECT s."classId" FROM (%1$s) a JOIN "LessonQuestion" q ON q.id = a."questionId" JOIN "ClassSection" s ON s.id = q."sectionId"
     ) affected', rows_query
  ) INTO class_ids;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;
CREATE TRIGGER "SectionAnswer_formative_insert" AFTER INSERT ON "SectionAnswer"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchSectionAnswerStatement"();
CREATE TRIGGER "SectionAnswer_formative_update" AFTER UPDATE ON "SectionAnswer"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchSectionAnswerStatement"();
CREATE TRIGGER "SectionAnswer_formative_delete" AFTER DELETE ON "SectionAnswer"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchSectionAnswerStatement"();
COMMIT;
