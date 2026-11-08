-- The reviewed URL stays in SpeakingPrompt. This locator tracks only the
-- current storage reference and is verified against the immutable identity.
CREATE TABLE "AssessmentSpeakingReference" (
  "promptId" TEXT PRIMARY KEY,
  "currentUrl" TEXT NOT NULL CHECK (length("currentUrl") > 0),
  CONSTRAINT "AssessmentSpeakingReference_promptId_fkey"
    FOREIGN KEY ("promptId") REFERENCES "SpeakingPrompt"(id) ON DELETE CASCADE
);

INSERT INTO "AssessmentSpeakingReference" ("promptId", "currentUrl")
SELECT id, "referenceTtsUrl" FROM "SpeakingPrompt"
WHERE "assessmentSectionId" IS NOT NULL AND "referenceTtsUrl" IS NOT NULL;

CREATE FUNCTION "touchAssessmentSpeakingReference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_prompt TEXT; target_class TEXT; target_assessment TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."promptId" IS DISTINCT FROM NEW."promptId" THEN
    RAISE EXCEPTION 'Assessment speaking locator cannot change prompt';
  END IF;
  target_prompt := CASE WHEN TG_OP = 'DELETE' THEN OLD."promptId" ELSE NEW."promptId" END;
  SELECT a."classId", a.id INTO target_class, target_assessment
    FROM "SpeakingPrompt" p
    JOIN "ClassAssessmentSection" s ON s.id = p."assessmentSectionId"
    JOIN "ClassAssessment" a ON a.id = s."assessmentId"
    WHERE p.id = target_prompt;
  IF target_assessment IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Assessment speaking locator requires an assessment prompt';
  END IF;
  UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = target_class;
  UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = target_assessment;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentSpeakingReference_fence"
  BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentSpeakingReference"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentSpeakingReference"();

CREATE FUNCTION "guardAssessmentSpeakingReferenceDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SpeakingPrompt" p
    JOIN "ClassAssessmentSection" s ON s.id = p."assessmentSectionId"
    JOIN "ClassAssessment" a ON a.id = s."assessmentId"
    WHERE p.id = OLD."promptId" AND a."sealedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Sealed assessment speaking locator cannot be removed'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AssessmentSpeakingReference_delete_guard"
  AFTER DELETE ON "AssessmentSpeakingReference" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guardAssessmentSpeakingReferenceDelete"();

CREATE FUNCTION "syncAssessmentSpeakingReference"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assessmentSectionId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."referenceTtsUrl" IS NULL THEN
    DELETE FROM "AssessmentSpeakingReference" WHERE "promptId" = NEW.id;
  ELSE
    INSERT INTO "AssessmentSpeakingReference" ("promptId", "currentUrl")
    VALUES (NEW.id, NEW."referenceTtsUrl")
    ON CONFLICT ("promptId") DO UPDATE SET "currentUrl" = EXCLUDED."currentUrl";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SpeakingPrompt_sync_assessment_reference"
  AFTER INSERT OR UPDATE OF "referenceTtsUrl", "assessmentSectionId" ON "SpeakingPrompt"
  FOR EACH ROW EXECUTE FUNCTION "syncAssessmentSpeakingReference"();
