-- Each inserted row receives a new identity even when a caller supplies a
-- previously used ID and timestamp. Existing rows are backfilled atomically.
BEGIN;
LOCK TABLE "CourseClass", "ClassSection", "LessonQuestion" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "ClassSection" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "LessonQuestion" ADD COLUMN "incarnationId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "ClassSection_incarnationId_key" ON "ClassSection"("incarnationId");
CREATE UNIQUE INDEX "LessonQuestion_incarnationId_key" ON "LessonQuestion"("incarnationId");

CREATE FUNCTION "guardClassQuizIncarnation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."incarnationId" := gen_random_uuid();
  ELSIF OLD."incarnationId" IS DISTINCT FROM NEW."incarnationId" THEN
    RAISE EXCEPTION 'Class quiz incarnation cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassSection_incarnation_guard" BEFORE INSERT OR UPDATE ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "guardClassQuizIncarnation"();
CREATE TRIGGER "LessonQuestion_incarnation_guard" BEFORE INSERT OR UPDATE ON "LessonQuestion"
  FOR EACH ROW EXECUTE FUNCTION "guardClassQuizIncarnation"();
COMMIT;
