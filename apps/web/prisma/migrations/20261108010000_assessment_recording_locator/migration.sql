ALTER TABLE "SpeakingRecording" ADD COLUMN "assessmentAudioUrl" TEXT;

UPDATE "SpeakingRecording" SET "assessmentAudioUrl" = "audioUrl"
WHERE "assessmentSectionId" IS NOT NULL;

CREATE FUNCTION "initializeAssessmentRecordingLocator"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assessmentSectionId" IS NOT NULL AND NEW."assessmentAudioUrl" IS NULL THEN
    NEW."assessmentAudioUrl" := NEW."audioUrl";
  END IF;
  IF NEW."assessmentSectionId" IS NOT NULL AND NEW."assessmentAudioUrl" IS DISTINCT FROM NEW."audioUrl" THEN
    RAISE EXCEPTION 'Assessment recording locator must start at its admitted input';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SpeakingRecording_assessment_locator_initialize"
BEFORE INSERT ON "SpeakingRecording"
FOR EACH ROW EXECUTE FUNCTION "initializeAssessmentRecordingLocator"();

CREATE FUNCTION "fenceAssessmentRecordingLocator"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_class TEXT; target_assessment TEXT; assessment_status "ClassAssessmentStatus";
BEGIN
  IF OLD."assessmentSectionId" IS NULL OR OLD."assessmentAudioUrl" IS NOT DISTINCT FROM NEW."assessmentAudioUrl" THEN
    RETURN NEW;
  END IF;
  SELECT a."classId", a.id, a.status INTO target_class, target_assessment, assessment_status
  FROM "ClassAssessmentSection" s JOIN "ClassAssessment" a ON a.id = s."assessmentId"
  WHERE s.id = OLD."assessmentSectionId";
  IF target_assessment IS NULL OR assessment_status <> 'COMMITTED' THEN
    RAISE EXCEPTION 'Assessment recording cannot move while the assessment is active';
  END IF;
  UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = target_class;
  UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = target_assessment;
  RETURN NEW;
END $$;
CREATE TRIGGER "SpeakingRecording_assessment_locator_fence"
BEFORE UPDATE OF "assessmentAudioUrl" ON "SpeakingRecording"
FOR EACH ROW EXECUTE FUNCTION "fenceAssessmentRecordingLocator"();

ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_assessment_locator_check"
CHECK (("assessmentSectionId" IS NULL AND "assessmentAudioUrl" IS NULL) OR
       ("assessmentSectionId" IS NOT NULL AND "assessmentAudioUrl" IS NOT NULL AND length("assessmentAudioUrl") > 0));
