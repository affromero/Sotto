-- An admitted audio job fixes the held-out material it was prepared against.
-- The assessment row is touched on activation so an older Serializable writer
-- cannot miss the newly committed freeze after acquiring that parent lock.
BEGIN;
LOCK TABLE "Course", "Lesson", "CourseClass", "ClassAssessment", "Episode", "ClassAssessmentSection",
  "ClassAssessmentQuestion", "ClassSection", "LessonQuestion", "SpeakingPrompt",
  "WritingPrompt", "Script" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "AssessmentAudioSourceFreeze" (
  "assessmentId" TEXT NOT NULL PRIMARY KEY,
  "classId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL UNIQUE
);
CREATE INDEX "AssessmentAudioSourceFreeze_classId_idx" ON "AssessmentAudioSourceFreeze"("classId");

CREATE FUNCTION "guardAssessmentAudioSourceFreeze"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Assessment audio freeze cannot change'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "CourseClass" WHERE id = OLD."classId") OR
       EXISTS (SELECT 1 FROM "ClassAssessment" WHERE id = OLD."assessmentId") OR
       EXISTS (SELECT 1 FROM "Episode" WHERE id = OLD."episodeId") THEN
      RAISE EXCEPTION 'Assessment audio freeze must remain until cleanup completes';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ClassAssessment" a
      JOIN "ClassAssessmentSection" s ON s."assessmentId" = a.id
      JOIN "Episode" e ON e.id = NEW."episodeId"
      JOIN "CourseClass" c ON c.id = a."classId"
    WHERE a.id = NEW."assessmentId" AND c.id = NEW."classId"
      AND e."assessmentAudioAssessmentId" = a.id
      AND e."assessmentAudioSectionId" = s.id AND s."episodeId" = e.id
      AND e."assessmentAudioOperationId" = a."generationOperationId"
      AND s."audioReservationOperationId" = a."generationOperationId"
      AND s."audioReservationEpisodeId" = e.id
      AND e."userId" = a."userId" AND e."audioGenerationKey" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Assessment audio freeze binding is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentAudioSourceFreeze_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentAudioSourceFreeze"
  FOR EACH ROW EXECUTE FUNCTION "guardAssessmentAudioSourceFreeze"();

CREATE TABLE "AssessmentAudioProtectedMedia" (
  "assessmentId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  PRIMARY KEY ("assessmentId", "episodeId")
);
CREATE INDEX "AssessmentAudioProtectedMedia_episodeId_idx" ON "AssessmentAudioProtectedMedia"("episodeId");

CREATE FUNCTION "guardAssessmentAudioProtectedMedia"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Protected assessment media cannot change'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "CourseClass" WHERE id = OLD."classId") OR
       EXISTS (SELECT 1 FROM "ClassAssessment" WHERE id = OLD."assessmentId") OR
       EXISTS (SELECT 1 FROM "AssessmentAudioSourceFreeze" f JOIN "Episode" e ON e.id = f."episodeId" WHERE f."assessmentId" = OLD."assessmentId") THEN
      RAISE EXCEPTION 'Protected assessment media must remain until cleanup completes';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "AssessmentAudioSourceFreeze" f
      JOIN "ClassAssessment" a ON a.id = f."assessmentId"
      JOIN "ClassSection" s ON s."classId" = f."classId"
      JOIN "Episode" e ON e.id = s."episodeId"
    WHERE f."assessmentId" = NEW."assessmentId" AND f."classId" = NEW."classId"
      AND e.id = NEW."episodeId" AND e."userId" = a."userId"
      AND NOT EXISTS (SELECT 1 FROM "ClassSection" newer WHERE newer."classId" = s."classId" AND newer.skill = s.skill AND newer.attempt > s.attempt)
  ) THEN RAISE EXCEPTION 'Protected assessment media binding is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentAudioProtectedMedia_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentAudioProtectedMedia"
  FOR EACH ROW EXECUTE FUNCTION "guardAssessmentAudioProtectedMedia"();

CREATE FUNCTION "recordAssessmentAudioProtectedMedia"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_episode TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM "ClassAssessment" WHERE id = NEW."assessmentId" AND "sealedAt" IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ClassSection" s WHERE s."classId" = NEW."classId"
      AND NOT EXISTS (SELECT 1 FROM "ClassSection" newer WHERE newer."classId" = s."classId" AND newer.skill = s.skill AND newer.attempt > s.attempt)
    GROUP BY s.skill HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Current class sections are ambiguous'; END IF;
  FOR source_episode IN
    SELECT DISTINCT s."episodeId" FROM "ClassSection" s
    WHERE s."classId" = NEW."classId" AND s."episodeId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ClassSection" newer WHERE newer."classId" = s."classId" AND newer.skill = s.skill AND newer.attempt > s.attempt)
    ORDER BY s."episodeId"
  LOOP
    UPDATE "Episode" SET "updatedAt" = "updatedAt" WHERE id = source_episode;
    UPDATE "Script" SET "updatedAt" = "updatedAt" WHERE "episodeId" = source_episode;
    INSERT INTO "AssessmentAudioProtectedMedia" ("assessmentId", "classId", "episodeId")
      VALUES (NEW."assessmentId", NEW."classId", source_episode);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentAudioSourceFreeze_record_media" AFTER INSERT ON "AssessmentAudioSourceFreeze"
  FOR EACH ROW EXECUTE FUNCTION "recordAssessmentAudioProtectedMedia"();

-- Refuse an incomplete preexisting binding instead of silently omitting it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Episode" e LEFT JOIN "ClassAssessment" a ON a.id = e."assessmentAudioAssessmentId"
    WHERE e."assessmentAudioAssessmentId" IS NOT NULL AND e."audioGenerationKey" IS NOT NULL AND a.id IS NULL
  ) THEN RAISE EXCEPTION 'Existing assessment audio freeze binding is missing'; END IF;
END $$;
INSERT INTO "AssessmentAudioSourceFreeze" ("assessmentId", "classId", "episodeId")
  SELECT a.id, a."classId", e.id FROM "Episode" e
    JOIN "ClassAssessment" a ON a.id = e."assessmentAudioAssessmentId"
  WHERE e."audioGenerationKey" IS NOT NULL;
-- Invalidate snapshots taken before backfill, including readers that held no
-- conflicting table lock while the migration installed its guards.
UPDATE "CourseClass" SET "updatedAt" = "updatedAt"
  WHERE id IN (SELECT "classId" FROM "AssessmentAudioSourceFreeze");
UPDATE "Course" SET "updatedAt" = "updatedAt"
  WHERE id IN (SELECT c."courseId" FROM "CourseClass" c JOIN "AssessmentAudioSourceFreeze" f ON f."classId" = c.id);
UPDATE "Lesson" SET "updatedAt" = "updatedAt"
  WHERE id IN (SELECT c."lessonId" FROM "CourseClass" c JOIN "AssessmentAudioSourceFreeze" f ON f."classId" = c.id);
UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt"
  WHERE id IN (SELECT "assessmentId" FROM "AssessmentAudioSourceFreeze");

CREATE FUNCTION "guardAssessmentAudioInitialKey"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assessmentAudioAssessmentId" IS NOT NULL AND NEW."audioGenerationKey" IS NOT NULL THEN
    RAISE EXCEPTION 'Assessment audio must be admitted after creation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Episode_assessment_audio_initial_key"
  BEFORE INSERT ON "Episode" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentAudioInitialKey"();

CREATE FUNCTION "freezeAssessmentOnAudioAdmission"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT; class_id TEXT; course_id TEXT; lesson_id TEXT;
BEGIN
  IF OLD."assessmentAudioAssessmentId" IS NULL OR
     OLD."audioGenerationKey" IS NOT DISTINCT FROM NEW."audioGenerationKey" THEN
    RETURN NEW;
  END IF;
  IF OLD."audioGenerationKey" IS NOT NULL OR NEW."audioGenerationKey" IS NULL THEN
    RAISE EXCEPTION 'Assessment audio generation identity cannot change';
  END IF;
  SELECT a.id, a."classId" INTO assessment_id, class_id FROM "ClassAssessment" a
    JOIN "ClassAssessmentSection" s ON s."assessmentId" = a.id
    WHERE a.id = OLD."assessmentAudioAssessmentId"
      AND s.id = OLD."assessmentAudioSectionId"
      AND s."episodeId" = OLD.id
      AND s."audioReservationOperationId" = OLD."assessmentAudioOperationId"
      AND a."generationOperationId" = OLD."assessmentAudioOperationId"
    FOR UPDATE OF a;
  IF assessment_id IS NULL THEN RAISE EXCEPTION 'Assessment audio reservation changed'; END IF;
  UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
  SELECT "courseId", "lessonId" INTO course_id, lesson_id FROM "CourseClass" WHERE id = class_id;
  IF course_id IS NULL OR lesson_id IS NULL THEN RAISE EXCEPTION 'Assessment class is missing'; END IF;
  UPDATE "Course" SET "updatedAt" = "updatedAt" WHERE id = course_id;
  UPDATE "Lesson" SET "updatedAt" = "updatedAt" WHERE id = lesson_id;
  UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = assessment_id;
  RETURN NEW;
END $$;
CREATE TRIGGER "Episode_assessment_audio_freeze"
  BEFORE UPDATE OF "audioGenerationKey" ON "Episode"
  FOR EACH ROW EXECUTE FUNCTION "freezeAssessmentOnAudioAdmission"();

CREATE FUNCTION "recordAssessmentAudioSourceFreeze"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."assessmentAudioAssessmentId" IS NOT NULL AND OLD."audioGenerationKey" IS NULL
     AND NEW."audioGenerationKey" IS NOT NULL THEN
    INSERT INTO "AssessmentAudioSourceFreeze" ("assessmentId", "classId", "episodeId")
      SELECT a.id, a."classId", NEW.id FROM "ClassAssessment" a
      WHERE a.id = NEW."assessmentAudioAssessmentId";
    IF NOT FOUND THEN RAISE EXCEPTION 'Assessment audio freeze binding is missing'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Episode_assessment_audio_freeze_record"
  AFTER UPDATE OF "audioGenerationKey" ON "Episode"
  FOR EACH ROW EXECUTE FUNCTION "recordAssessmentAudioSourceFreeze"();

CREATE FUNCTION "guardFrozenAssessmentEpisodeDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."assessmentAudioAssessmentId" IS NOT NULL AND OLD."audioGenerationKey" IS NOT NULL
     AND EXISTS (SELECT 1 FROM "ClassAssessment" WHERE id = OLD."assessmentAudioAssessmentId") THEN
    RAISE EXCEPTION 'Admitted assessment audio must be deleted with its assessment';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Episode_assessment_audio_delete_freeze"
  AFTER DELETE ON "Episode" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guardFrozenAssessmentEpisodeDelete"();

CREATE FUNCTION "guardFrozenAssessmentDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AssessmentAudioSourceFreeze" WHERE "assessmentId" = OLD.id) THEN
    IF EXISTS (SELECT 1 FROM "CourseClass" WHERE id = OLD."classId") OR
       EXISTS (SELECT 1 FROM "Episode" WHERE "assessmentAudioAssessmentId" = OLD.id AND "audioGenerationKey" IS NOT NULL) THEN
      RAISE EXCEPTION 'Class, assessment, and admitted audio must be deleted together';
    END IF;
    DELETE FROM "AssessmentAudioProtectedMedia" WHERE "assessmentId" = OLD.id;
    DELETE FROM "AssessmentAudioSourceFreeze" WHERE "assessmentId" = OLD.id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessment_admitted_audio_delete_guard"
  AFTER DELETE ON "ClassAssessment" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guardFrozenAssessmentDelete"();

CREATE FUNCTION "assessmentAudioMaterialFrozen"(assessment_id TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM "AssessmentAudioSourceFreeze" f WHERE f."assessmentId" = assessment_id
  )
$$;

CREATE FUNCTION "assessmentAudioSourceFrozen"(class_id TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM "AssessmentAudioSourceFreeze" f
      LEFT JOIN "ClassAssessment" a ON a.id = f."assessmentId"
    WHERE f."classId" = class_id AND (a.id IS NULL OR a."sealedAt" IS NULL)
  )
$$;

CREATE FUNCTION "guardAudioFrozenSourceEpisode"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_id TEXT;
BEGIN
  IF (OLD.id, OLD."userId", OLD.source, OLD."deletedAt", OLD.status, OLD."audioUrl")
    IS NOT DISTINCT FROM (NEW.id, NEW."userId", NEW.source, NEW."deletedAt", NEW.status, NEW."audioUrl") THEN
    RETURN NEW;
  END IF;
  FOR class_id IN SELECT DISTINCT "classId" FROM "AssessmentAudioProtectedMedia"
    WHERE "episodeId" IN (OLD.id, NEW.id) ORDER BY "classId" LOOP
    UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
    IF "assessmentAudioSourceFrozen"(class_id) THEN
      RAISE EXCEPTION 'Class source media is frozen by admitted assessment audio';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "Episode_formative_audio_source_freeze" BEFORE UPDATE ON "Episode"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenSourceEpisode"();

CREATE FUNCTION "guardAudioFrozenSourceScript"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_episode TEXT; new_episode TEXT; episode_id TEXT; class_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_episode := OLD."episodeId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_episode := NEW."episodeId"; END IF;
  IF TG_OP = 'UPDATE' AND
    (OLD.id, OLD."episodeId", OLD.version, OLD.turns, OLD."soundCues", OLD.markdown)
      IS NOT DISTINCT FROM (NEW.id, NEW."episodeId", NEW.version, NEW.turns, NEW."soundCues", NEW.markdown) THEN
    RETURN NEW;
  END IF;
  FOR episode_id IN SELECT id FROM "Episode" WHERE id IN (old_episode, new_episode) ORDER BY id LOOP
    UPDATE "Episode" SET "updatedAt" = "updatedAt" WHERE id = episode_id;
  END LOOP;
  FOR class_id IN SELECT DISTINCT "classId" FROM "AssessmentAudioProtectedMedia"
    WHERE "episodeId" IN (old_episode, new_episode) ORDER BY "classId" LOOP
    UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
    IF TG_OP <> 'DELETE' AND "assessmentAudioSourceFrozen"(class_id) THEN
      RAISE EXCEPTION 'Class source media is frozen by admitted assessment audio';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Script_formative_audio_source_freeze" BEFORE INSERT OR UPDATE OR DELETE ON "Script"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenSourceScript"();

CREATE FUNCTION "guardAudioFrozenSourceMediaDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Episode' THEN episode_id := OLD.id; ELSE episode_id := OLD."episodeId"; END IF;
  IF EXISTS (SELECT 1 FROM "AssessmentAudioProtectedMedia" m
    JOIN "CourseClass" c ON c.id = m."classId"
    WHERE m."episodeId" = episode_id AND "assessmentAudioSourceFrozen"(c.id)) THEN
    RAISE EXCEPTION 'Class source media is frozen by admitted assessment audio';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Episode_formative_audio_source_delete" AFTER DELETE ON "Episode"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenSourceMediaDelete"();
CREATE CONSTRAINT TRIGGER "Script_formative_audio_source_delete" AFTER DELETE ON "Script"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenSourceMediaDelete"();

CREATE FUNCTION "guardAudioFrozenCourseLesson"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_id TEXT; changed BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'Course' THEN
    changed := (OLD.id, OLD."userId", OLD."nativeLang", OLD."targetLang")
      IS DISTINCT FROM (NEW.id, NEW."userId", NEW."nativeLang", NEW."targetLang");
  ELSE
    changed := (OLD.id, OLD.level, OLD.title, OLD.objective, OLD."grammarPoints", OLD."targetVocab")
      IS DISTINCT FROM (NEW.id, NEW.level, NEW.title, NEW.objective, NEW."grammarPoints", NEW."targetVocab");
  END IF;
  IF NOT changed THEN RETURN NEW; END IF;
  FOR class_id IN
    SELECT id FROM "CourseClass"
    WHERE (TG_TABLE_NAME = 'Course' AND "courseId" IN (OLD.id, NEW.id))
       OR (TG_TABLE_NAME = 'Lesson' AND "lessonId" IN (OLD.id, NEW.id))
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
    IF "assessmentAudioSourceFrozen"(class_id) THEN
      RAISE EXCEPTION 'Course or lesson is frozen by admitted assessment audio';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "Course_assessment_audio_source_freeze" BEFORE UPDATE ON "Course"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenCourseLesson"();
CREATE TRIGGER "Lesson_assessment_audio_source_freeze" BEFORE UPDATE ON "Lesson"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenCourseLesson"();

CREATE FUNCTION "guardAudioFrozenClassSource"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id, OLD."courseId", OLD."lessonId", OLD.attempt, OLD.status, OLD."passThreshold",
      OLD."learningSelection", OLD."readingVocabulary", OLD."sourceTitle", OLD."sourceUrl",
      OLD."skillRequirements", OLD."adaptiveSeed", OLD."prerequisiteGate")
     IS DISTINCT FROM
     (NEW.id, NEW."courseId", NEW."lessonId", NEW.attempt, NEW.status, NEW."passThreshold",
      NEW."learningSelection", NEW."readingVocabulary", NEW."sourceTitle", NEW."sourceUrl",
      NEW."skillRequirements", NEW."adaptiveSeed", NEW."prerequisiteGate")
     AND "assessmentAudioSourceFrozen"(OLD.id) THEN
    RAISE EXCEPTION 'Class teaching is frozen by admitted assessment audio';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CourseClass_assessment_audio_source_freeze" BEFORE UPDATE ON "CourseClass"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenClassSource"();

CREATE FUNCTION "guardAudioFrozenFormativeWrite"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_class TEXT; new_class TEXT; class_id TEXT; changed BOOLEAN := TRUE;
BEGIN
  IF TG_TABLE_NAME = 'ClassSection' THEN
    IF TG_OP = 'UPDATE' THEN
      old_class := OLD."classId";
      changed := (OLD.id, OLD."classId", OLD.skill, OLD.attempt, OLD.status, OLD."passThreshold", OLD.seed, OLD.spec)
        IS DISTINCT FROM (NEW.id, NEW."classId", NEW.skill, NEW.attempt, NEW.status, NEW."passThreshold", NEW.seed, NEW.spec)
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
      changed := (to_jsonb(OLD) - 'createdAt') IS DISTINCT FROM (to_jsonb(NEW) - 'createdAt');
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
CREATE TRIGGER "ClassSection_assessment_audio_source_freeze" BEFORE INSERT OR UPDATE ON "ClassSection" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeWrite"();
CREATE TRIGGER "LessonQuestion_assessment_audio_source_freeze" BEFORE INSERT OR UPDATE ON "LessonQuestion" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeWrite"();
CREATE TRIGGER "SpeakingPrompt_formative_audio_source_freeze" BEFORE INSERT OR UPDATE ON "SpeakingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeWrite"();
CREATE TRIGGER "WritingPrompt_formative_audio_source_freeze" BEFORE INSERT OR UPDATE ON "WritingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeWrite"();

CREATE FUNCTION "guardAudioFrozenFormativeDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ClassSection' THEN class_id := OLD."classId";
  ELSIF OLD."sectionId" IS NOT NULL THEN
    SELECT "classId" INTO class_id FROM "ClassSection" WHERE id = OLD."sectionId";
  END IF;
  IF class_id IS NOT NULL AND EXISTS (SELECT 1 FROM "CourseClass" WHERE id = class_id)
     AND "assessmentAudioSourceFrozen"(class_id) THEN
    RAISE EXCEPTION 'Class teaching is frozen by admitted assessment audio';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassSection_assessment_audio_source_delete" AFTER DELETE ON "ClassSection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeDelete"();
CREATE CONSTRAINT TRIGGER "LessonQuestion_assessment_audio_source_delete" AFTER DELETE ON "LessonQuestion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeDelete"();
CREATE CONSTRAINT TRIGGER "SpeakingPrompt_formative_audio_source_delete" AFTER DELETE ON "SpeakingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeDelete"();
CREATE CONSTRAINT TRIGGER "WritingPrompt_formative_audio_source_delete" AFTER DELETE ON "WritingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenFormativeDelete"();

CREATE FUNCTION "guardAudioFrozenAssessmentProvenance"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "assessmentAudioMaterialFrozen"(OLD.id) AND
     (OLD.requirements, OLD."formativeRevision", OLD."teachingKind", OLD."teachingReceiptId", OLD."generationOperationId")
       IS DISTINCT FROM
     (NEW.requirements, NEW."formativeRevision", NEW."teachingKind", NEW."teachingReceiptId", NEW."generationOperationId") THEN
    RAISE EXCEPTION 'Assessment provenance is frozen by admitted audio';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessment_audio_provenance_freeze" BEFORE UPDATE ON "ClassAssessment"
  FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentProvenance"();

CREATE FUNCTION "guardAudioFrozenAssessmentMaterial"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_assessment TEXT; new_assessment TEXT; parent_id TEXT; changed BOOLEAN := TRUE;
BEGIN
  IF TG_TABLE_NAME = 'ClassAssessmentSection' THEN
    IF TG_OP = 'UPDATE' THEN
      old_assessment := OLD."assessmentId";
      changed := (OLD.id, OLD."assessmentId", OLD.skill, OLD."passThreshold", OLD."passageText", OLD."authoredDraft", OLD."audioReservationEpisodeId", OLD."audioReservationOperationId")
        IS DISTINCT FROM (NEW.id, NEW."assessmentId", NEW.skill, NEW."passThreshold", NEW."passageText", NEW."authoredDraft", NEW."audioReservationEpisodeId", NEW."audioReservationOperationId")
        OR (OLD."episodeId" IS DISTINCT FROM NEW."episodeId" AND NOT (
          NEW."episodeId" IS NULL AND NOT EXISTS (SELECT 1 FROM "Episode" WHERE id = OLD."episodeId")
        ));
    END IF;
    new_assessment := NEW."assessmentId";
  ELSIF TG_TABLE_NAME = 'ClassAssessmentQuestion' THEN
    IF TG_OP = 'UPDATE' THEN old_assessment := OLD."assessmentId"; changed := OLD IS DISTINCT FROM NEW; END IF;
    new_assessment := NEW."assessmentId";
  ELSE
    IF TG_OP = 'UPDATE' AND OLD."assessmentSectionId" IS NOT NULL THEN
      SELECT "assessmentId" INTO old_assessment FROM "ClassAssessmentSection" WHERE id = OLD."assessmentSectionId";
    END IF;
    IF NEW."assessmentSectionId" IS NOT NULL THEN
      SELECT "assessmentId" INTO new_assessment FROM "ClassAssessmentSection" WHERE id = NEW."assessmentSectionId";
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF TG_TABLE_NAME = 'SpeakingPrompt' THEN
        changed := (to_jsonb(OLD) - ARRAY['referenceTtsUrl','assessmentReferenceIdentity'])
          IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['referenceTtsUrl','assessmentReferenceIdentity']);
      ELSE
        changed := OLD IS DISTINCT FROM NEW;
      END IF;
    END IF;
  END IF;
  IF NOT changed THEN RETURN NEW; END IF;
  FOR parent_id IN SELECT id FROM "ClassAssessment" WHERE id IN (old_assessment, new_assessment) ORDER BY id FOR UPDATE LOOP
    IF "assessmentAudioMaterialFrozen"(parent_id) THEN
      RAISE EXCEPTION 'Assessment material is frozen by admitted audio';
    END IF;
    UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = parent_id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSection_audio_material_freeze" BEFORE INSERT OR UPDATE ON "ClassAssessmentSection" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentMaterial"();
CREATE TRIGGER "ClassAssessmentQuestion_audio_material_freeze" BEFORE INSERT OR UPDATE ON "ClassAssessmentQuestion" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentMaterial"();
CREATE TRIGGER "SpeakingPrompt_audio_material_freeze" BEFORE INSERT OR UPDATE ON "SpeakingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentMaterial"();
CREATE TRIGGER "WritingPrompt_audio_material_freeze" BEFORE INSERT OR UPDATE ON "WritingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentMaterial"();

CREATE FUNCTION "guardAudioFrozenAssessmentDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT;
BEGIN
  IF TG_TABLE_NAME IN ('ClassAssessmentSection', 'ClassAssessmentQuestion') THEN
    assessment_id := OLD."assessmentId";
  ELSIF OLD."assessmentSectionId" IS NOT NULL THEN
    SELECT "assessmentId" INTO assessment_id FROM "ClassAssessmentSection" WHERE id = OLD."assessmentSectionId";
  END IF;
  IF assessment_id IS NOT NULL AND EXISTS (SELECT 1 FROM "ClassAssessment" WHERE id = assessment_id)
     AND "assessmentAudioMaterialFrozen"(assessment_id) THEN
    RAISE EXCEPTION 'Assessment material is frozen by admitted audio';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessmentSection_audio_delete_freeze" AFTER DELETE ON "ClassAssessmentSection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentDelete"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentQuestion_audio_delete_freeze" AFTER DELETE ON "ClassAssessmentQuestion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentDelete"();
CREATE CONSTRAINT TRIGGER "SpeakingPrompt_audio_delete_freeze" AFTER DELETE ON "SpeakingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentDelete"();
CREATE CONSTRAINT TRIGGER "WritingPrompt_audio_delete_freeze" AFTER DELETE ON "WritingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenAssessmentDelete"();

CREATE FUNCTION "guardAudioFrozenScript"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_id TEXT; assessment_id TEXT; old_episode TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.id, OLD."episodeId", OLD.version, OLD.turns, OLD."soundCues", OLD.markdown)
         IS NOT DISTINCT FROM (NEW.id, NEW."episodeId", NEW.version, NEW.turns, NEW."soundCues", NEW.markdown) THEN RETURN NEW; END IF;
    old_episode := OLD."episodeId";
  END IF;
  FOR episode_id IN SELECT id FROM "Episode" WHERE id IN (old_episode, NEW."episodeId") ORDER BY id LOOP
    SELECT "assessmentAudioAssessmentId" INTO assessment_id FROM "Episode" WHERE id = episode_id;
    IF assessment_id IS NOT NULL THEN
      UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = assessment_id;
      IF "assessmentAudioMaterialFrozen"(assessment_id) THEN
        RAISE EXCEPTION 'Assessment script is frozen by admitted audio';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "Script_assessment_audio_material_freeze" BEFORE INSERT OR UPDATE ON "Script" FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenScript"();
CREATE FUNCTION "guardAudioFrozenScriptDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Episode" WHERE id = OLD."episodeId" AND "assessmentAudioAssessmentId" IS NOT NULL AND "audioGenerationKey" IS NOT NULL) THEN
    RAISE EXCEPTION 'Assessment script is frozen by admitted audio';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Script_assessment_audio_delete_freeze" AFTER DELETE ON "Script" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAudioFrozenScriptDelete"();
COMMIT;
