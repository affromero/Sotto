-- A Serializable assessment read must see writes to formative feedback made
-- before it acquires the class lock, including newer pending attempts.
CREATE FUNCTION "touchFormativeProgressStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[]; prompt_table TEXT; rows_query TEXT;
BEGIN
  IF TG_TABLE_NAME = 'SpeakingRecording' THEN prompt_table := 'SpeakingPrompt';
  ELSIF TG_TABLE_NAME = 'WritingResponse' THEN prompt_table := 'WritingPrompt';
  ELSE RAISE EXCEPTION 'Unexpected formative progress table'; END IF;
  IF TG_OP = 'INSERT' THEN rows_query := 'SELECT "sectionId", "promptId" FROM new_rows';
  ELSIF TG_OP = 'DELETE' THEN rows_query := 'SELECT "sectionId", "promptId" FROM old_rows';
  ELSE rows_query := 'SELECT "sectionId", "promptId" FROM old_rows UNION ALL SELECT "sectionId", "promptId" FROM new_rows'; END IF;
  EXECUTE format(
    'SELECT array_agg(DISTINCT s."classId") FROM (%s) r LEFT JOIN %I p ON p.id = r."promptId" JOIN "ClassSection" s ON s.id IN (r."sectionId", p."sectionId")',
    rows_query, prompt_table
  ) INTO class_ids;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;

CREATE TRIGGER "SpeakingRecording_formative_insert" AFTER INSERT ON "SpeakingRecording" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
CREATE TRIGGER "SpeakingRecording_formative_update" AFTER UPDATE ON "SpeakingRecording" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
CREATE TRIGGER "SpeakingRecording_formative_delete" AFTER DELETE ON "SpeakingRecording" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
CREATE TRIGGER "WritingResponse_formative_insert" AFTER INSERT ON "WritingResponse" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
CREATE TRIGGER "WritingResponse_formative_update" AFTER UPDATE ON "WritingResponse" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
CREATE TRIGGER "WritingResponse_formative_delete" AFTER DELETE ON "WritingResponse" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeProgressStatement"();
