CREATE UNIQUE INDEX "SpeakingRecording_assessment_prompt_attempt_key"
ON "SpeakingRecording" ("assessmentSectionId", "promptId", "attempt")
WHERE "assessmentSectionId" IS NOT NULL AND "status" <> 'FAILED';

CREATE INDEX "SpeakingRecording_assessmentSectionId_promptId_attempt_idx"
ON "SpeakingRecording" ("assessmentSectionId", "promptId", "attempt");
