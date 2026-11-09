-- Existing reviewed assessments retain their original material and digest.
ALTER TABLE "SpeakingPrompt" ADD COLUMN "assessmentCriteria" JSONB;
ALTER TABLE "ClassAssessment" ADD COLUMN "materialVersion" INTEGER NOT NULL DEFAULT 1
  CHECK ("materialVersion" IN (1, 2));
CREATE FUNCTION "guardAssessmentMaterialVersion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."materialVersion" IS DISTINCT FROM NEW."materialVersion" THEN
    RAISE EXCEPTION 'Assessment material version cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessment_material_version_immutable" BEFORE UPDATE ON "ClassAssessment"
  FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialVersion"();
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_assessment_criteria_parent_check"
  CHECK ("assessmentCriteria" IS NULL OR
    ("assessmentSectionId" IS NOT NULL AND jsonb_typeof("assessmentCriteria") = 'array'));
