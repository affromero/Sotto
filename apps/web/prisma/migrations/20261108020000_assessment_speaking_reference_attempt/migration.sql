-- A dispatched speaking reference is one-shot. Its active marker can only
-- become a final identity for the same prompt and provider invocation.
CREATE FUNCTION "guardAssessmentSpeakingReferenceAttempt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  assessment_id TEXT;
  assessment_user TEXT;
  generation_id TEXT;
  assessment_status "ClassAssessmentStatus";
  old_identity JSONB := OLD."assessmentReferenceIdentity";
  new_identity JSONB := NEW."assessmentReferenceIdentity";
  provenance JSONB;
BEGIN
  IF OLD."assessmentSectionId" IS NOT NULL AND
     old_identity->'provenance'->>'operationId' IS NOT NULL THEN
    IF old_identity IS DISTINCT FROM new_identity OR
       OLD."referenceTtsUrl" IS DISTINCT FROM NEW."referenceTtsUrl" THEN
      RAISE EXCEPTION 'Assessment speaking reference attempt cannot be reset or replaced';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."assessmentSectionId" IS NULL OR
     old_identity->>'kind' IS DISTINCT FROM 'ASSESSMENT_SPEAKING_TTS_ACTIVE' THEN
    RETURN NEW;
  END IF;
  IF old_identity = new_identity THEN
    IF OLD."referenceTtsUrl" IS DISTINCT FROM NEW."referenceTtsUrl" THEN
      RAISE EXCEPTION 'Active assessment speaking reference cannot change locator';
    END IF;
    RETURN NEW;
  END IF;
  SELECT a.id, a."userId", a."generationOperationId", a.status
    INTO assessment_id, assessment_user, generation_id, assessment_status
    FROM "ClassAssessmentSection" s JOIN "ClassAssessment" a ON a.id = s."assessmentId"
    WHERE s.id = OLD."assessmentSectionId" FOR UPDATE OF a;
  provenance := new_identity->'provenance';
  IF assessment_status IS DISTINCT FROM 'GENERATING' OR
     OLD."referenceTtsUrl" IS NOT NULL OR NEW."referenceTtsUrl" IS NULL OR
     old_identity->>'assessmentId' IS DISTINCT FROM assessment_id OR
     old_identity->>'userId' IS DISTINCT FROM assessment_user OR
     old_identity->>'promptId' IS DISTINCT FROM OLD.id OR
     old_identity->>'operationId' IS DISTINCT FROM generation_id OR
     new_identity->>'assessmentId' IS DISTINCT FROM assessment_id OR
     new_identity->>'userId' IS DISTINCT FROM assessment_user OR
     new_identity->>'promptId' IS DISTINCT FROM OLD.id OR
     new_identity->'reference'->>'reference' IS DISTINCT FROM NEW."referenceTtsUrl" OR
     provenance->>'operationId' IS DISTINCT FROM old_identity->>'operationId' OR
     provenance->>'fingerprint' IS DISTINCT FROM old_identity->>'fingerprint' OR
     provenance->>'provider' IS DISTINCT FROM old_identity->>'provider' OR
     provenance->>'model' IS DISTINCT FROM old_identity->>'model' OR
     provenance->>'voiceId' IS DISTINCT FROM old_identity->>'voiceId' OR
     provenance->>'speechFingerprint' IS DISTINCT FROM old_identity->>'speechFingerprint' OR
     provenance->>'inputDigest' IS DISTINCT FROM old_identity->>'inputDigest' OR
     COALESCE(provenance->>'dispatches', '') !~ '^([1-9]|[1-5][0-9]|6[0-4])$' THEN
    RAISE EXCEPTION 'Assessment speaking reference attempt cannot be reset or replaced';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SpeakingPrompt_assessment_reference_attempt_guard"
  BEFORE UPDATE ON "SpeakingPrompt" FOR EACH ROW
  EXECUTE FUNCTION "guardAssessmentSpeakingReferenceAttempt"();
