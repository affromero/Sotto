-- Assessment admission must invalidate an older class snapshot before deletion.
CREATE TRIGGER "ClassAssessment_class_insert_fence" AFTER INSERT ON "ClassAssessment"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();
CREATE TRIGGER "ClassAssessment_class_update_fence" AFTER UPDATE ON "ClassAssessment"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();
CREATE TRIGGER "ClassAssessment_class_delete_fence" AFTER DELETE ON "ClassAssessment"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();

-- Productive child rows can be inserted while a sealed assessment is ready.
-- Touch every old/new assessment parent so a stale deletion snapshot conflicts.
CREATE FUNCTION "touchAssessmentProductiveStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT; prompt_table TEXT; rows_query TEXT;
BEGIN
  IF TG_TABLE_NAME = 'SpeakingRecording' THEN prompt_table := 'SpeakingPrompt';
  ELSIF TG_TABLE_NAME = 'WritingResponse' THEN prompt_table := 'WritingPrompt';
  ELSE RAISE EXCEPTION 'Unexpected assessment productive table'; END IF;
  IF TG_OP = 'INSERT' THEN rows_query := 'SELECT "assessmentSectionId", "promptId" FROM new_rows';
  ELSIF TG_OP = 'DELETE' THEN rows_query := 'SELECT "assessmentSectionId", "promptId" FROM old_rows';
  ELSE rows_query := 'SELECT "assessmentSectionId", "promptId" FROM old_rows UNION ALL SELECT "assessmentSectionId", "promptId" FROM new_rows'; END IF;
  FOR assessment_id IN EXECUTE format(
    'SELECT DISTINCT s."assessmentId" FROM (%s) r LEFT JOIN %I p ON p.id = r."promptId" JOIN "ClassAssessmentSection" s ON s.id IN (r."assessmentSectionId", p."assessmentSectionId") ORDER BY s."assessmentId"',
    rows_query, prompt_table
  ) LOOP
    UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = assessment_id;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "SpeakingRecording_assessment_insert_fence" AFTER INSERT ON "SpeakingRecording"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();
CREATE TRIGGER "SpeakingRecording_assessment_update_fence" AFTER UPDATE ON "SpeakingRecording"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();
CREATE TRIGGER "SpeakingRecording_assessment_delete_fence" AFTER DELETE ON "SpeakingRecording"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();
CREATE TRIGGER "WritingResponse_assessment_insert_fence" AFTER INSERT ON "WritingResponse"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();
CREATE TRIGGER "WritingResponse_assessment_update_fence" AFTER UPDATE ON "WritingResponse"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();
CREATE TRIGGER "WritingResponse_assessment_delete_fence" AFTER DELETE ON "WritingResponse"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentProductiveStatement"();

CREATE FUNCTION "touchAssessmentReceiptStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT; rows_query TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN rows_query := 'SELECT "assessmentId" FROM new_rows';
  ELSIF TG_OP = 'DELETE' THEN rows_query := 'SELECT "assessmentId" FROM old_rows';
  ELSE rows_query := 'SELECT "assessmentId" FROM old_rows UNION ALL SELECT "assessmentId" FROM new_rows'; END IF;
  FOR assessment_id IN EXECUTE format('SELECT DISTINCT "assessmentId" FROM (%s) r ORDER BY "assessmentId"', rows_query) LOOP
    UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = assessment_id;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "ClassAssessmentSubmission_insert_fence" AFTER INSERT ON "ClassAssessmentSubmission"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentSubmission_update_fence" AFTER UPDATE ON "ClassAssessmentSubmission"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentSubmission_delete_fence" AFTER DELETE ON "ClassAssessmentSubmission"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentProductiveEvidence_insert_fence" AFTER INSERT ON "ClassAssessmentProductiveEvidence"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentProductiveEvidence_update_fence" AFTER UPDATE ON "ClassAssessmentProductiveEvidence"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentProductiveEvidence_delete_fence" AFTER DELETE ON "ClassAssessmentProductiveEvidence"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentAnswer_insert_fence" AFTER INSERT ON "ClassAssessmentAnswer"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentAnswer_update_fence" AFTER UPDATE ON "ClassAssessmentAnswer"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
CREATE TRIGGER "ClassAssessmentAnswer_delete_fence" AFTER DELETE ON "ClassAssessmentAnswer"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchAssessmentReceiptStatement"();
