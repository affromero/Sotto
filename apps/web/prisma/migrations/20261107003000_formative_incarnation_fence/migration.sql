-- A retained material digest may bind row creation times as incarnation IDs.
-- Touch each affected class when those times change, so an older Serializable
-- snapshot cannot publish against a replaced or modified incarnation.
BEGIN;
LOCK TABLE "CourseClass", "ClassAssessment", "ClassSection", "LessonQuestion",
  "SpeakingPrompt", "WritingPrompt" IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION "touchFormativeSectionStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT id) INTO class_ids FROM (
      SELECT o."classId" AS id FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - ARRAY['score','passed','generatedAt','updatedAt'])
            IS DISTINCT FROM (to_jsonb(n) - ARRAY['score','passed','generatedAt','updatedAt'])
      UNION
      SELECT n."classId" AS id FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - ARRAY['score','passed','generatedAt','updatedAt'])
            IS DISTINCT FROM (to_jsonb(n) - ARRAY['score','passed','generatedAt','updatedAt'])
    ) changed WHERE id IS NOT NULL;
  END IF;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "touchFormativeChildStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT s."classId") INTO class_ids
      FROM new_rows n JOIN "ClassSection" s ON s.id = n."sectionId";
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT s."classId") INTO class_ids
      FROM old_rows o JOIN "ClassSection" s ON s.id = o."sectionId";
  ELSE
    SELECT array_agg(DISTINCT s."classId") INTO class_ids FROM old_rows o
      FULL JOIN new_rows n ON o.id = n.id
      JOIN "ClassSection" s ON s.id IN (o."sectionId", n."sectionId")
      WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n);
  END IF;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;
-- The same incarnation fields are part of frozen assessment source identity.
CREATE OR REPLACE FUNCTION "guardAudioFrozenFormativeWrite"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_class TEXT; new_class TEXT; class_id TEXT; changed BOOLEAN := TRUE;
BEGIN
  IF TG_TABLE_NAME = 'ClassSection' THEN
    IF TG_OP = 'UPDATE' THEN
      old_class := OLD."classId";
      changed := (OLD.id, OLD."classId", OLD.skill, OLD.attempt, OLD.status, OLD."passThreshold", OLD.seed, OLD.spec, OLD."createdAt")
        IS DISTINCT FROM (NEW.id, NEW."classId", NEW.skill, NEW.attempt, NEW.status, NEW."passThreshold", NEW.seed, NEW.spec, NEW."createdAt")
        OR (OLD."episodeId" IS DISTINCT FROM NEW."episodeId" AND NOT (
          NEW."episodeId" IS NULL AND NOT EXISTS (SELECT 1 FROM "Episode" WHERE id = OLD."episodeId")
        ));
    END IF;
    new_class := NEW."classId";
  ELSE
    IF TG_OP = 'UPDATE' AND OLD."sectionId" IS NOT NULL THEN
      SELECT "classId" INTO old_class FROM "ClassSection" WHERE id = OLD."sectionId";
    END IF;
    IF NEW."sectionId" IS NOT NULL THEN
      SELECT "classId" INTO new_class FROM "ClassSection" WHERE id = NEW."sectionId";
    END IF;
    IF TG_OP = 'UPDATE' THEN
      changed := to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW);
    END IF;
  END IF;
  IF NOT changed THEN RETURN NEW; END IF;
  FOR class_id IN SELECT id FROM "CourseClass" WHERE id IN (old_class, new_class) ORDER BY id FOR UPDATE LOOP
    UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
    IF "assessmentAudioSourceFrozen"(class_id) THEN
      RAISE EXCEPTION 'Class teaching is frozen by admitted assessment audio';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
COMMIT;
