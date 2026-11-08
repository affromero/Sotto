-- CreateEnum
CREATE TYPE "ClassAssessmentStatus" AS ENUM ('GENERATING', 'READY', 'COMMITTED', 'FAILED', 'UNRESOLVED', 'RETIRED');

-- AlterTable
ALTER TABLE "SpeakingPrompt" ADD COLUMN "assessmentSectionId" TEXT, ADD COLUMN "assessmentRubric" TEXT, ADD COLUMN "assessmentReferenceIdentity" JSONB, ADD COLUMN "assessmentTaskMode" TEXT, ADD COLUMN "assessmentGuidance" TEXT;

-- AlterTable
ALTER TABLE "SpeakingRecording" ADD COLUMN     "assessmentSectionId" TEXT;

-- AlterTable
ALTER TABLE "WritingPrompt" ADD COLUMN "assessmentSectionId" TEXT, ADD COLUMN "assessmentRubric" TEXT;

-- AlterTable
ALTER TABLE "WritingResponse" ADD COLUMN     "assessmentSectionId" TEXT;

-- CreateTable
CREATE TABLE "ClassAssessment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classAttempt" INTEGER NOT NULL,
    "assessmentAttempt" INTEGER NOT NULL,
    "status" "ClassAssessmentStatus" NOT NULL DEFAULT 'GENERATING',
    "requirements" JSONB NOT NULL,
    "formativeRevision" TEXT NOT NULL,
    "teachingKind" TEXT,
    "teachingReceiptId" TEXT,
    "reviewedMaterialDigest" TEXT,
    "generationOperationId" TEXT,
    "reviewOperationId" TEXT,
    "reviewReceipt" JSONB,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassAssessment_teaching_receipt_check" CHECK (
      ("teachingKind" IS NULL AND "teachingReceiptId" IS NULL)
      OR ("teachingKind" IS NOT NULL AND "teachingKind" IN ('BASE', 'ADDENDUM') AND "teachingReceiptId" IS NOT NULL AND "teachingReceiptId" <> '')
    )
);

-- CreateTable
CREATE TABLE "ClassAssessmentSection" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "passThreshold" DOUBLE PRECISION NOT NULL,
    "passageText" TEXT,
    "episodeId" TEXT,
    "audioReservationEpisodeId" TEXT,
    "audioReservationOperationId" TEXT,
    "audioIdentity" JSONB,
    "authoredDraft" JSONB,

    CONSTRAINT "ClassAssessmentSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassAssessmentProviderCall" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "attemptId" TEXT,
    "attemptFingerprint" TEXT,
    "responseMetadata" JSONB,
    "responseBytes" BYTEA,
    "responseSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassAssessmentProviderCall_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassAssessmentProviderCall_assessment_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ClassAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassAssessmentProviderCall_stage_key" UNIQUE ("assessmentId", "stage", "ordinal"),
    CONSTRAINT "ClassAssessmentProviderCall_attempt_key" UNIQUE ("attemptId"),
    CONSTRAINT "ClassAssessmentProviderCall_stage_valid" CHECK ("stage" IN ('AUTHOR_GRAMMAR', 'AUTHOR_READING', 'AUTHOR_LISTENING', 'AUTHOR_SPEAKING', 'AUTHOR_WRITING', 'REVIEW')),
    CONSTRAINT "ClassAssessmentProviderCall_ordinal_valid" CHECK ("ordinal" BETWEEN 0 AND 15),
    CONSTRAINT "ClassAssessmentProviderCall_role_valid" CHECK ("role" IN ('MODEL', 'MODERATION', 'CLI')),
    CONSTRAINT "ClassAssessmentProviderCall_digest_valid" CHECK ("inputDigest" ~ '^[a-f0-9]{64}$' AND ("attemptFingerprint" IS NULL OR "attemptFingerprint" ~ '^[a-f0-9]{64}$') AND ("responseSha256" IS NULL OR "responseSha256" ~ '^[a-f0-9]{64}$')),
    CONSTRAINT "ClassAssessmentProviderCall_state_valid" CHECK (
      ("status" = 'READY' AND "attemptId" IS NULL AND "attemptFingerprint" IS NULL AND "responseBytes" IS NULL AND "responseMetadata" IS NULL AND "responseSha256" IS NULL) OR
      ("status" IN ('DISPATCHING', 'UNKNOWN') AND "attemptId" IS NOT NULL AND "attemptFingerprint" IS NOT NULL AND "responseBytes" IS NULL AND "responseMetadata" IS NULL AND "responseSha256" IS NULL) OR
      ("status" IN ('SUCCEEDED', 'FAILED') AND "attemptId" IS NOT NULL AND "attemptFingerprint" IS NOT NULL AND (("responseBytes" IS NOT NULL AND "responseMetadata" IS NOT NULL AND "responseSha256" IS NOT NULL) OR ("status" = 'FAILED' AND "responseBytes" IS NULL AND "responseMetadata" IS NULL AND "responseSha256" IS NULL)))
    ),
    CONSTRAINT "ClassAssessmentProviderCall_bytes_limit" CHECK ("responseBytes" IS NULL OR octet_length("responseBytes") <= 524288)
);

-- CreateTable
CREATE TABLE "ClassAssessmentQuestion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "ClassAssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassAssessmentSubmission" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassAssessmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassAssessmentAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,

    CONSTRAINT "ClassAssessmentAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassAssessmentProductiveEvidence" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "speakingRecordingId" TEXT,
    "writingResponseId" TEXT,
    "operationId" TEXT NOT NULL,
    "operationFingerprint" TEXT NOT NULL,
    "materialDigest" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "snapshot" JSONB NOT NULL,
    CONSTRAINT "ClassAssessmentProductiveEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessment_generationOperationId_key" ON "ClassAssessment"("generationOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessment_reviewOperationId_key" ON "ClassAssessment"("reviewOperationId");

-- CreateIndex
CREATE INDEX "ClassAssessment_userId_classId_idx" ON "ClassAssessment"("userId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessment_classId_classAttempt_assessmentAttempt_key" ON "ClassAssessment"("classId", "classAttempt", "assessmentAttempt");

-- CreateIndex
ALTER TABLE "Episode" ADD COLUMN "assessmentAudioAssessmentId" TEXT,
  ADD COLUMN "assessmentAudioSectionId" TEXT,
  ADD COLUMN "assessmentAudioOperationId" TEXT;
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_assessment_audio_marker_check" CHECK (
  ("assessmentAudioAssessmentId" IS NULL AND "assessmentAudioSectionId" IS NULL AND "assessmentAudioOperationId" IS NULL)
  OR ("assessmentAudioAssessmentId" IS NOT NULL AND "assessmentAudioAssessmentId" <> ''
      AND "assessmentAudioSectionId" IS NOT NULL AND "assessmentAudioSectionId" <> ''
      AND "assessmentAudioOperationId" IS NOT NULL AND "assessmentAudioOperationId" <> '')
);
CREATE FUNCTION "keepAssessmentAudioMarker"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."assessmentAudioAssessmentId", OLD."assessmentAudioSectionId", OLD."assessmentAudioOperationId")
     IS DISTINCT FROM (NEW."assessmentAudioAssessmentId", NEW."assessmentAudioSectionId", NEW."assessmentAudioOperationId") THEN
    RAISE EXCEPTION 'Assessment audio marker cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Episode_assessment_audio_marker_immutable"
  BEFORE UPDATE OF "assessmentAudioAssessmentId", "assessmentAudioSectionId", "assessmentAudioOperationId"
  ON "Episode" FOR EACH ROW EXECUTE FUNCTION "keepAssessmentAudioMarker"();

-- Touch affected class tuples in one stable order per statement. A Serializable
-- reader with an older snapshot then cannot lock a class after a source write.
CREATE FUNCTION "touchFormativeClasses"(class_ids TEXT[]) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE class_id TEXT;
BEGIN
  FOR class_id IN SELECT id FROM "CourseClass" WHERE id = ANY(class_ids) ORDER BY id LOOP
    UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = class_id;
  END LOOP;
END $$;

CREATE FUNCTION "touchFormativeSectionStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE class_ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT "classId") INTO class_ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT id) INTO class_ids FROM (
      SELECT o."classId" AS id FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - ARRAY['score','passed','generatedAt','createdAt','updatedAt'])
            IS DISTINCT FROM (to_jsonb(n) - ARRAY['score','passed','generatedAt','createdAt','updatedAt'])
      UNION
      SELECT n."classId" AS id FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - ARRAY['score','passed','generatedAt','createdAt','updatedAt'])
            IS DISTINCT FROM (to_jsonb(n) - ARRAY['score','passed','generatedAt','createdAt','updatedAt'])
    ) changed WHERE id IS NOT NULL;
  END IF;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;

CREATE FUNCTION "touchFormativeChildStatement"() RETURNS trigger LANGUAGE plpgsql AS $$
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
      WHERE (to_jsonb(o) - 'createdAt') IS DISTINCT FROM (to_jsonb(n) - 'createdAt');
  END IF;
  PERFORM "touchFormativeClasses"(class_ids);
  RETURN NULL;
END $$;

CREATE TRIGGER "ClassSection_formative_insert" AFTER INSERT ON "ClassSection" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();
CREATE TRIGGER "ClassSection_formative_update" AFTER UPDATE ON "ClassSection" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();
CREATE TRIGGER "ClassSection_formative_delete" AFTER DELETE ON "ClassSection" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeSectionStatement"();
CREATE TRIGGER "LessonQuestion_formative_insert" AFTER INSERT ON "LessonQuestion" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "LessonQuestion_formative_update" AFTER UPDATE ON "LessonQuestion" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "LessonQuestion_formative_delete" AFTER DELETE ON "LessonQuestion" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "SpeakingPrompt_formative_insert" AFTER INSERT ON "SpeakingPrompt" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "SpeakingPrompt_formative_update" AFTER UPDATE ON "SpeakingPrompt" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "SpeakingPrompt_formative_delete" AFTER DELETE ON "SpeakingPrompt" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "WritingPrompt_formative_insert" AFTER INSERT ON "WritingPrompt" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "WritingPrompt_formative_update" AFTER UPDATE ON "WritingPrompt" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();
CREATE TRIGGER "WritingPrompt_formative_delete" AFTER DELETE ON "WritingPrompt" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "touchFormativeChildStatement"();

CREATE UNIQUE INDEX "ClassAssessmentSection_episodeId_key" ON "ClassAssessmentSection"("episodeId");

CREATE UNIQUE INDEX "ClassAssessmentSection_audioReservationEpisodeId_key" ON "ClassAssessmentSection"("audioReservationEpisodeId");

ALTER TABLE "ClassAssessmentSection" ADD CONSTRAINT "ClassAssessmentSection_audio_reservation_check" CHECK (
  ("audioReservationEpisodeId" IS NULL AND "audioReservationOperationId" IS NULL)
  OR ("audioReservationEpisodeId" IS NOT NULL AND "audioReservationOperationId" IS NOT NULL
      AND "audioReservationOperationId" <> '' AND skill = 'LISTENING'
      AND ("episodeId" IS NULL OR "episodeId" = "audioReservationEpisodeId"))
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentSection_assessmentId_skill_key" ON "ClassAssessmentSection"("assessmentId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentSection_id_assessmentId_key" ON "ClassAssessmentSection"("id", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentQuestion_sectionId_order_key" ON "ClassAssessmentQuestion"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentQuestion_id_assessmentId_key" ON "ClassAssessmentQuestion"("id", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentSubmission_assessmentId_key" ON "ClassAssessmentSubmission"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentSubmission_id_assessmentId_key" ON "ClassAssessmentSubmission"("id", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssessmentAnswer_submissionId_questionId_key" ON "ClassAssessmentAnswer"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_id_userId_key" ON "Course"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingPrompt_assessmentSectionId_order_key" ON "SpeakingPrompt"("assessmentSectionId", "order");

CREATE UNIQUE INDEX "SpeakingPrompt_id_assessmentSectionId_key" ON "SpeakingPrompt"("id", "assessmentSectionId");

-- CreateIndex
CREATE INDEX "SpeakingRecording_assessmentSectionId_idx" ON "SpeakingRecording"("assessmentSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "WritingPrompt_assessmentSectionId_order_key" ON "WritingPrompt"("assessmentSectionId", "order");

CREATE UNIQUE INDEX "WritingPrompt_id_assessmentSectionId_key" ON "WritingPrompt"("id", "assessmentSectionId");

CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_speakingRecordingId_key" ON "ClassAssessmentProductiveEvidence"("speakingRecordingId");
CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_writingResponseId_key" ON "ClassAssessmentProductiveEvidence"("writingResponseId");
CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_operationId_key" ON "ClassAssessmentProductiveEvidence"("operationId");
CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_submissionId_promptId_key" ON "ClassAssessmentProductiveEvidence"("submissionId", "promptId");
CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_speakingRecordingId_secti_key" ON "ClassAssessmentProductiveEvidence"("speakingRecordingId", "sectionId", "promptId");
CREATE UNIQUE INDEX "ClassAssessmentProductiveEvidence_writingResponseId_section_key" ON "ClassAssessmentProductiveEvidence"("writingResponseId", "sectionId", "promptId");
CREATE UNIQUE INDEX "SpeakingRecording_id_assessmentSectionId_promptId_key" ON "SpeakingRecording"("id", "assessmentSectionId", "promptId");
CREATE UNIQUE INDEX "WritingResponse_id_assessmentSectionId_promptId_key" ON "WritingResponse"("id", "assessmentSectionId", "promptId");

-- CreateIndex
CREATE INDEX "WritingResponse_assessmentSectionId_idx" ON "WritingResponse"("assessmentSectionId");

-- AddForeignKey
ALTER TABLE "ClassAssessment" ADD CONSTRAINT "ClassAssessment_classId_courseId_fkey" FOREIGN KEY ("classId", "courseId") REFERENCES "CourseClass"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessment" ADD CONSTRAINT "ClassAssessment_courseId_userId_fkey" FOREIGN KEY ("courseId", "userId") REFERENCES "Course"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessment" ADD CONSTRAINT "ClassAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentSection" ADD CONSTRAINT "ClassAssessmentSection_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ClassAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentSection" ADD CONSTRAINT "ClassAssessmentSection_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentQuestion" ADD CONSTRAINT "ClassAssessmentQuestion_sectionId_assessmentId_fkey" FOREIGN KEY ("sectionId", "assessmentId") REFERENCES "ClassAssessmentSection"("id", "assessmentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentSubmission" ADD CONSTRAINT "ClassAssessmentSubmission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ClassAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentAnswer" ADD CONSTRAINT "ClassAssessmentAnswer_submissionId_assessmentId_fkey" FOREIGN KEY ("submissionId", "assessmentId") REFERENCES "ClassAssessmentSubmission"("id", "assessmentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssessmentAnswer" ADD CONSTRAINT "ClassAssessmentAnswer_questionId_assessmentId_fkey" FOREIGN KEY ("questionId", "assessmentId") REFERENCES "ClassAssessmentQuestion"("id", "assessmentId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_assessmentSectionId_fkey" FOREIGN KEY ("assessmentSectionId") REFERENCES "ClassAssessmentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_assessmentSectionId_fkey" FOREIGN KEY ("assessmentSectionId") REFERENCES "ClassAssessmentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingPrompt" ADD CONSTRAINT "WritingPrompt_assessmentSectionId_fkey" FOREIGN KEY ("assessmentSectionId") REFERENCES "ClassAssessmentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_assessmentSectionId_fkey" FOREIGN KEY ("assessmentSectionId") REFERENCES "ClassAssessmentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_promptId_assessmentSectionId_fkey" FOREIGN KEY ("promptId", "assessmentSectionId") REFERENCES "SpeakingPrompt"("id", "assessmentSectionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_promptId_assessmentSectionId_fkey" FOREIGN KEY ("promptId", "assessmentSectionId") REFERENCES "WritingPrompt"("id", "assessmentSectionId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassAssessmentProductiveEvidence" ADD CONSTRAINT "ClassAssessmentProductiveEvidence_submissionId_assessmentI_fkey" FOREIGN KEY ("submissionId", "assessmentId") REFERENCES "ClassAssessmentSubmission"("id", "assessmentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassAssessmentProductiveEvidence" ADD CONSTRAINT "ClassAssessmentProductiveEvidence_sectionId_assessmentId_fkey" FOREIGN KEY ("sectionId", "assessmentId") REFERENCES "ClassAssessmentSection"("id", "assessmentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassAssessmentProductiveEvidence" ADD CONSTRAINT "ClassAssessmentProductiveEvidence_speakingRecordingId_sect_fkey" FOREIGN KEY ("speakingRecordingId", "sectionId", "promptId") REFERENCES "SpeakingRecording"("id", "assessmentSectionId", "promptId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ClassAssessmentProductiveEvidence" ADD CONSTRAINT "ClassAssessmentProductiveEvidence_writingResponseId_sectio_fkey" FOREIGN KEY ("writingResponseId", "sectionId", "promptId") REFERENCES "WritingResponse"("id", "assessmentSectionId", "promptId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ClassAssessmentProductiveEvidence" ADD CONSTRAINT "ClassAssessmentProductiveEvidence_valid_snapshot" CHECK (
  num_nonnulls("speakingRecordingId", "writingResponseId") = 1 AND score >= 0 AND score <= 1 AND
  length(trim("operationId")) > 0 AND "operationFingerprint" ~ '^[a-f0-9]{64}$' AND
  "materialDigest" ~ '^[a-f0-9]{64}$' AND "inputDigest" ~ '^[a-f0-9]{64}$');

-- At most one live held-out attempt exists for a class attempt.
CREATE UNIQUE INDEX "ClassAssessment_one_live_attempt" ON "ClassAssessment" ("classId", "classAttempt")
  WHERE "status" IN ('GENERATING', 'READY', 'UNRESOLVED');

ALTER TABLE "ClassAssessment" ADD CONSTRAINT "ClassAssessment_positive_attempts"
  CHECK ("classAttempt" > 0 AND "assessmentAttempt" > 0);
ALTER TABLE "ClassAssessment" ADD CONSTRAINT "ClassAssessment_review_before_ready"
  CHECK ("status" NOT IN ('READY', 'COMMITTED') OR
    ("teachingKind" IS NOT NULL AND "teachingReceiptId" IS NOT NULL AND
     "generationOperationId" IS NOT NULL AND "reviewOperationId" IS NOT NULL AND
     "reviewedMaterialDigest" IS NOT NULL AND "reviewedMaterialDigest" ~ '^[a-f0-9]{64}$' AND "reviewReceipt" IS NOT NULL AND "sealedAt" IS NOT NULL));
ALTER TABLE "ClassAssessmentSection" ADD CONSTRAINT "ClassAssessmentSection_valid_threshold"
  CHECK ("passThreshold" >= 0 AND "passThreshold" <= 1);
ALTER TABLE "ClassAssessmentSection" ADD CONSTRAINT "ClassAssessmentSection_media_skill"
  CHECK (("episodeId" IS NULL OR "skill" = 'LISTENING') AND ("audioIdentity" IS NULL OR "skill" = 'LISTENING') AND ("passageText" IS NULL OR "skill" = 'READING'));
ALTER TABLE "ClassAssessmentQuestion" ADD CONSTRAINT "ClassAssessmentQuestion_valid_choice"
  CHECK ("correctIndex" BETWEEN 0 AND 3);
ALTER TABLE "ClassAssessmentAnswer" ADD CONSTRAINT "ClassAssessmentAnswer_valid_choice"
  CHECK ("selectedIndex" BETWEEN 0 AND 3);

-- Keep legacy records intact while disallowing multiple parents on assessment work.
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_assessment_task_mode"
  CHECK (("assessmentSectionId" IS NULL AND "assessmentTaskMode" IS NULL) OR
    ("assessmentSectionId" IS NOT NULL AND "assessmentTaskMode" IS NOT NULL AND "assessmentTaskMode" IN ('READ_ALOUD', 'COMMUNICATIVE') AND
      ("assessmentTaskMode" <> 'COMMUNICATIVE' OR ("referenceTtsUrl" IS NULL AND "assessmentReferenceIdentity" IS NULL))));
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_assessment_guidance_parent"
  CHECK ("assessmentSectionId" IS NOT NULL OR "assessmentGuidance" IS NULL);
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_assessment_parent_only"
  CHECK (("assessmentSectionId" IS NOT NULL OR "assessmentReferenceIdentity" IS NULL) AND ("assessmentSectionId" IS NULL OR ("sectionId" IS NULL AND "practiceSessionId" IS NULL AND "examSectionId" IS NULL AND "assessmentRubric" IS NOT NULL AND length(trim("assessmentRubric")) > 0)));
ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_assessment_parent_only"
  CHECK ("assessmentSectionId" IS NULL OR ("sectionId" IS NULL AND "practiceSessionId" IS NULL AND "examSectionId" IS NULL));
ALTER TABLE "WritingPrompt" ADD CONSTRAINT "WritingPrompt_assessment_parent_only"
  CHECK ("assessmentSectionId" IS NULL OR ("sectionId" IS NULL AND "practiceSessionId" IS NULL AND "examSectionId" IS NULL AND "assessmentRubric" IS NOT NULL AND length(trim("assessmentRubric")) > 0));
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_assessment_parent_only"
  CHECK ("assessmentSectionId" IS NULL OR ("sectionId" IS NULL AND "practiceSessionId" IS NULL AND "examSectionId" IS NULL));

-- A nullable composite foreign key alone would let a response omit its assessment parent.
CREATE FUNCTION "checkAssessmentProductiveParent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prompt_section TEXT;
  assessment_owner TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."assessmentSectionId" IS NOT NULL OR NEW."assessmentSectionId" IS NOT NULL) AND
     (OLD."promptId", OLD."assessmentSectionId", OLD."userId", OLD.attempt) IS DISTINCT FROM
     (NEW."promptId", NEW."assessmentSectionId", NEW."userId", NEW.attempt) THEN
    RAISE EXCEPTION 'Assessment response identity cannot change';
  END IF;
  IF TG_TABLE_NAME = 'SpeakingRecording' THEN
    SELECT p."assessmentSectionId", a."userId" INTO prompt_section, assessment_owner
      FROM "SpeakingPrompt" p LEFT JOIN "ClassAssessmentSection" s ON s.id = p."assessmentSectionId"
      LEFT JOIN "ClassAssessment" a ON a.id = s."assessmentId" WHERE p.id = NEW."promptId";
  ELSE
    SELECT p."assessmentSectionId", a."userId" INTO prompt_section, assessment_owner
      FROM "WritingPrompt" p LEFT JOIN "ClassAssessmentSection" s ON s.id = p."assessmentSectionId"
      LEFT JOIN "ClassAssessment" a ON a.id = s."assessmentId" WHERE p.id = NEW."promptId";
  END IF;
  IF prompt_section IS NOT NULL AND
     (NEW."assessmentSectionId" IS DISTINCT FROM prompt_section OR NEW."userId" IS DISTINCT FROM assessment_owner) THEN
    RAISE EXCEPTION 'Assessment response parent or owner does not match its prompt';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SpeakingRecording_assessment_parent" BEFORE INSERT OR UPDATE OF "promptId", "assessmentSectionId", "userId", attempt ON "SpeakingRecording"
  FOR EACH ROW EXECUTE FUNCTION "checkAssessmentProductiveParent"();
CREATE TRIGGER "WritingResponse_assessment_parent" BEFORE INSERT OR UPDATE OF "promptId", "assessmentSectionId", "userId", attempt ON "WritingResponse"
  FOR EACH ROW EXECUTE FUNCTION "checkAssessmentProductiveParent"();

CREATE FUNCTION "keepAssessmentProductiveInput"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."assessmentSectionId" IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'SpeakingRecording' THEN
    IF OLD."audioUrl" IS DISTINCT FROM NEW."audioUrl" THEN RAISE EXCEPTION 'Assessment recording input cannot change'; END IF;
  ELSE
    IF OLD.text IS DISTINCT FROM NEW.text THEN RAISE EXCEPTION 'Assessment writing input cannot change'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SpeakingRecording_assessment_input" BEFORE UPDATE OF "audioUrl" ON "SpeakingRecording"
  FOR EACH ROW EXECUTE FUNCTION "keepAssessmentProductiveInput"();
CREATE TRIGGER "WritingResponse_assessment_input" BEFORE UPDATE OF text ON "WritingResponse"
  FOR EACH ROW EXECUTE FUNCTION "keepAssessmentProductiveInput"();

CREATE FUNCTION "checkAssessmentPromptSkill"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_skill "SkillType";
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."assessmentSectionId" IS DISTINCT FROM NEW."assessmentSectionId" AND
     (OLD."assessmentSectionId" IS NOT NULL OR NEW."assessmentSectionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Assessment prompt parent cannot change';
  END IF;
  IF NEW."assessmentSectionId" IS NULL THEN RETURN NEW; END IF;
  required_skill := CASE WHEN TG_TABLE_NAME = 'SpeakingPrompt' THEN 'SPEAKING'::"SkillType" ELSE 'WRITING'::"SkillType" END;
  IF NOT EXISTS (SELECT 1 FROM "ClassAssessmentSection" WHERE id = NEW."assessmentSectionId" AND skill = required_skill) THEN
    RAISE EXCEPTION 'Assessment prompt skill does not match its section';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SpeakingPrompt_assessment_skill" BEFORE INSERT OR UPDATE OF "assessmentSectionId" ON "SpeakingPrompt"
  FOR EACH ROW EXECUTE FUNCTION "checkAssessmentPromptSkill"();
CREATE TRIGGER "WritingPrompt_assessment_skill" BEFORE INSERT OR UPDATE OF "assessmentSectionId" ON "WritingPrompt"
  FOR EACH ROW EXECUTE FUNCTION "checkAssessmentPromptSkill"();

CREATE FUNCTION "checkAssessmentQuestionSkill"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ClassAssessmentSection" WHERE id = NEW."sectionId"
    AND "assessmentId" = NEW."assessmentId" AND skill IN ('GRAMMAR', 'READING', 'LISTENING')) THEN
    RAISE EXCEPTION 'Assessment question skill does not match its section';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentQuestion_skill" BEFORE INSERT OR UPDATE OF "sectionId", "assessmentId" ON "ClassAssessmentQuestion"
  FOR EACH ROW EXECUTE FUNCTION "checkAssessmentQuestionSkill"();

CREATE FUNCTION "keepAssessmentSectionSkill"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.skill IS DISTINCT FROM NEW.skill OR OLD."assessmentId" IS DISTINCT FROM NEW."assessmentId" THEN
    RAISE EXCEPTION 'Assessment section identity cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSection_skill_immutable" BEFORE UPDATE OF skill, "assessmentId" ON "ClassAssessmentSection"
  FOR EACH ROW EXECUTE FUNCTION "keepAssessmentSectionSkill"();

CREATE FUNCTION "keepAssessmentOwnership"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."classId", OLD."courseId", OLD."userId", OLD."classAttempt", OLD."assessmentAttempt") IS DISTINCT FROM
     (NEW."classId", NEW."courseId", NEW."userId", NEW."classAttempt", NEW."assessmentAttempt") THEN
    RAISE EXCEPTION 'Assessment ownership and attempt cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessment_identity_immutable" BEFORE UPDATE OF "classId", "courseId", "userId", "classAttempt", "assessmentAttempt" ON "ClassAssessment"
  FOR EACH ROW EXECUTE FUNCTION "keepAssessmentOwnership"();

CREATE FUNCTION "guardAssessmentSeal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'GENERATING' OR NEW."sealedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Assessment must start unsealed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."sealedAt" IS NOT NULL AND
     (OLD."sealedAt", OLD.requirements, OLD."formativeRevision", OLD."teachingKind", OLD."teachingReceiptId", OLD."reviewedMaterialDigest", OLD."generationOperationId", OLD."reviewOperationId", OLD."reviewReceipt") IS DISTINCT FROM
     (NEW."sealedAt", NEW.requirements, NEW."formativeRevision", NEW."teachingKind", NEW."teachingReceiptId", NEW."reviewedMaterialDigest", NEW."generationOperationId", NEW."reviewOperationId", NEW."reviewReceipt") THEN
    RAISE EXCEPTION 'Sealed assessment provenance cannot change';
  END IF;
  IF OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL AND NEW.status <> 'READY' THEN
    RAISE EXCEPTION 'Assessment must be ready when sealed';
  END IF;
  IF OLD."sealedAt" IS NOT NULL AND NEW.status = 'GENERATING' THEN
    RAISE EXCEPTION 'Sealed assessment cannot return to generation';
  END IF;
  IF OLD.status = 'COMMITTED' AND NEW.status <> 'COMMITTED' THEN
    RAISE EXCEPTION 'Committed assessment cannot change status';
  END IF;
  IF NEW.status = 'COMMITTED' AND NOT EXISTS (SELECT 1 FROM "ClassAssessmentSubmission" WHERE "assessmentId" = NEW.id) THEN
    RAISE EXCEPTION 'Committed assessment requires a submission';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessment_seal_guard" BEFORE INSERT OR UPDATE ON "ClassAssessment"
  FOR EACH ROW EXECUTE FUNCTION "guardAssessmentSeal"();

-- Publication and material writes serialize on the same assessment row.
CREATE FUNCTION "guardAssessmentMaterialWrite"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_assessment TEXT;
  new_assessment TEXT;
  parent RECORD;
BEGIN
  IF TG_TABLE_NAME IN ('ClassAssessmentSection', 'ClassAssessmentQuestion', 'ClassAssessmentProviderCall') THEN
    IF TG_OP = 'UPDATE' THEN old_assessment := OLD."assessmentId"; END IF;
    new_assessment := NEW."assessmentId";
  ELSE
    IF TG_OP = 'UPDATE' AND
       ((OLD."assessmentSectionId" IS NULL) IS DISTINCT FROM (NEW."assessmentSectionId" IS NULL)) THEN
      RAISE EXCEPTION 'Assessment prompts cannot change parent category';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."assessmentSectionId" IS NOT NULL THEN
      SELECT "assessmentId" INTO old_assessment FROM "ClassAssessmentSection" WHERE id = OLD."assessmentSectionId";
    END IF;
    IF NEW."assessmentSectionId" IS NOT NULL THEN
      SELECT "assessmentId" INTO new_assessment FROM "ClassAssessmentSection" WHERE id = NEW."assessmentSectionId";
    END IF;
  END IF;
  FOR parent IN SELECT id, "sealedAt" FROM "ClassAssessment" WHERE id IN (old_assessment, new_assessment) ORDER BY id FOR UPDATE LOOP
    IF parent."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'Sealed assessment material cannot change'; END IF;
    UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = parent.id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSection_material_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentSection" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialWrite"();
CREATE TRIGGER "ClassAssessmentProviderCall_material_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentProviderCall" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialWrite"();
CREATE FUNCTION "keepAssessmentAudioReservation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."audioReservationEpisodeId" IS NOT NULL AND
     (OLD."audioReservationEpisodeId" IS DISTINCT FROM NEW."audioReservationEpisodeId" OR
      OLD."audioReservationOperationId" IS DISTINCT FROM NEW."audioReservationOperationId") THEN
    RAISE EXCEPTION 'Assessment audio reservation cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSection_audio_reservation_immutable"
  BEFORE UPDATE ON "ClassAssessmentSection" FOR EACH ROW EXECUTE FUNCTION "keepAssessmentAudioReservation"();
-- Make a concurrent attachment visible to Serializable readers that locked the episode.
CREATE FUNCTION "touchAssessmentEpisode"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."episodeId" IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD."episodeId" IS DISTINCT FROM NEW."episodeId") THEN
    UPDATE "Episode" SET "updatedAt" = "updatedAt" WHERE id = NEW."episodeId";
    IF NOT EXISTS (
      SELECT 1 FROM "Episode" e JOIN "ClassAssessment" a ON a.id = NEW."assessmentId"
      WHERE e.id = NEW."episodeId" AND e."userId" = a."userId"
        AND e."assessmentAudioAssessmentId" = a.id
        AND e."assessmentAudioSectionId" = NEW.id
        AND e."assessmentAudioOperationId" = a."generationOperationId"
        AND NEW."audioReservationEpisodeId" = e.id
        AND NEW."audioReservationOperationId" = a."generationOperationId"
        AND NEW.skill = 'LISTENING'
    ) THEN
      RAISE EXCEPTION 'Assessment audio must match its creation reservation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSection_touch_episode" BEFORE INSERT OR UPDATE OF "episodeId" ON "ClassAssessmentSection"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentEpisode"();
CREATE FUNCTION "requireAttachedAssessmentAudio"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assessmentAudioAssessmentId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Episode" WHERE id = NEW.id)
    AND NOT EXISTS (
      SELECT 1 FROM "ClassAssessmentSection" s
      WHERE s.id = NEW."assessmentAudioSectionId" AND s."assessmentId" = NEW."assessmentAudioAssessmentId"
        AND s."episodeId" = NEW.id AND s."audioReservationOperationId" = NEW."assessmentAudioOperationId"
    ) THEN
    RAISE EXCEPTION 'Assessment audio must be attached before commit';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Episode_assessment_audio_attached"
  AFTER INSERT ON "Episode" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "requireAttachedAssessmentAudio"();
CREATE FUNCTION "keepAssessmentAudioAttached"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."episodeId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Episode" WHERE id = OLD."episodeId")
    AND NOT EXISTS (
      SELECT 1 FROM "ClassAssessmentSection" s
      WHERE s.id = OLD.id AND s."assessmentId" = OLD."assessmentId" AND s."episodeId" = OLD."episodeId"
    ) THEN
    RAISE EXCEPTION 'Assessment audio must remain attached until deleted';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessmentSection_audio_stays_attached"
  AFTER UPDATE OR DELETE ON "ClassAssessmentSection" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "keepAssessmentAudioAttached"();

-- A private held-out episode cannot be attached to another learning activity.
-- Recheck the final reference at commit. The marker is immutable, and an
-- episode outside the transaction's snapshot must fail closed.
CREATE FUNCTION "rejectAssessmentAudioReuse"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attached BOOLEAN; marker TEXT;
BEGIN
  IF NEW."episodeId" IS NULL OR
     (TG_OP = 'UPDATE' AND OLD."episodeId" IS NOT DISTINCT FROM NEW."episodeId") THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND "episodeId" = $2)', TG_TABLE_NAME)
    INTO attached USING NEW.id, NEW."episodeId";
  IF NOT attached THEN RETURN NULL; END IF;
  SELECT "assessmentAudioAssessmentId" INTO marker FROM "Episode" WHERE id = NEW."episodeId";
  IF NOT FOUND OR marker IS NOT NULL THEN
    RAISE EXCEPTION 'Assessment audio cannot be used by another activity';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClassSection_no_assessment_audio" AFTER INSERT OR UPDATE ON "ClassSection"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "rejectAssessmentAudioReuse"();
CREATE CONSTRAINT TRIGGER "ExamSection_no_assessment_audio" AFTER INSERT OR UPDATE ON "ExamSection"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "rejectAssessmentAudioReuse"();
CREATE CONSTRAINT TRIGGER "PracticeSession_no_assessment_audio" AFTER INSERT OR UPDATE ON "PracticeSession"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "rejectAssessmentAudioReuse"();

-- Media writes touch the marked episode before mutation, fencing older
-- Serializable snapshots that validate its script, voice and segment settings.
CREATE FUNCTION "touchAssessmentMediaEpisode"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_id TEXT;
BEGIN
  FOR episode_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."episodeId" ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."episodeId" ELSE NULL END
    ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    UPDATE "Episode" SET "updatedAt" = "updatedAt"
      WHERE id = episode_id AND "assessmentAudioAssessmentId" IS NOT NULL;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Script_assessment_media_fence" BEFORE INSERT OR UPDATE OR DELETE ON "Script"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMediaEpisode"();
CREATE TRIGGER "EpisodeVoice_assessment_media_fence" BEFORE INSERT OR UPDATE OR DELETE ON "EpisodeVoice"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMediaEpisode"();
CREATE TRIGGER "Segment_assessment_media_insert_fence" BEFORE INSERT OR DELETE ON "Segment"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMediaEpisode"();
CREATE TRIGGER "Segment_assessment_media_update_fence" BEFORE UPDATE OF "episodeId", "order", "speaker", "text", "version", "audioUrl", "duration", "wordTimings", "startTime", "ttsProvider", "ttsModel", "ttsVoiceId" ON "Segment"
  FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMediaEpisode"();
CREATE TRIGGER "ClassAssessmentQuestion_material_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentQuestion" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialWrite"();
CREATE TRIGGER "SpeakingPrompt_assessment_material_guard" BEFORE INSERT OR UPDATE ON "SpeakingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialWrite"();
CREATE TRIGGER "WritingPrompt_assessment_material_guard" BEFORE INSERT OR UPDATE ON "WritingPrompt" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialWrite"();

-- Deletion remains subject to the deferred sealed/cascade rules below. Touch
-- a surviving parent now so an older snapshot cannot publish missing material.
CREATE FUNCTION "touchAssessmentMaterialDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT;
BEGIN
  IF TG_TABLE_NAME IN ('ClassAssessmentSection', 'ClassAssessmentQuestion', 'ClassAssessmentProviderCall') THEN
    assessment_id := OLD."assessmentId";
  ELSIF OLD."assessmentSectionId" IS NOT NULL THEN
    SELECT "assessmentId" INTO assessment_id FROM "ClassAssessmentSection" WHERE id = OLD."assessmentSectionId";
  END IF;
  UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = assessment_id;
  RETURN OLD;
END $$;
CREATE TRIGGER "ClassAssessmentSection_delete_fence" BEFORE DELETE ON "ClassAssessmentSection" FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMaterialDelete"();
CREATE TRIGGER "ClassAssessmentQuestion_delete_fence" BEFORE DELETE ON "ClassAssessmentQuestion" FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMaterialDelete"();
CREATE TRIGGER "ClassAssessmentProviderCall_delete_fence" BEFORE DELETE ON "ClassAssessmentProviderCall" FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMaterialDelete"();
CREATE TRIGGER "SpeakingPrompt_assessment_delete_fence" BEFORE DELETE ON "SpeakingPrompt" FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMaterialDelete"();
CREATE TRIGGER "WritingPrompt_assessment_delete_fence" BEFORE DELETE ON "WritingPrompt" FOR EACH ROW EXECUTE FUNCTION "touchAssessmentMaterialDelete"();

-- Deferred deletion checks allow the whole class to cascade after fenced cleanup.
CREATE FUNCTION "guardAssessmentMaterialDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT; sealed_at TIMESTAMP(3);
BEGIN
  IF TG_TABLE_NAME IN ('ClassAssessmentSection', 'ClassAssessmentQuestion', 'ClassAssessmentProviderCall') THEN
    assessment_id := OLD."assessmentId";
  ELSIF OLD."assessmentSectionId" IS NOT NULL THEN
    SELECT "assessmentId" INTO assessment_id FROM "ClassAssessmentSection" WHERE id = OLD."assessmentSectionId";
  END IF;
  SELECT "sealedAt" INTO sealed_at FROM "ClassAssessment" WHERE id = assessment_id FOR UPDATE;
  IF sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sealed assessment material cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessmentSection_delete_guard" AFTER DELETE ON "ClassAssessmentSection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialDelete"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentQuestion_delete_guard" AFTER DELETE ON "ClassAssessmentQuestion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialDelete"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentProviderCall_delete_guard" AFTER DELETE ON "ClassAssessmentProviderCall" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialDelete"();
CREATE CONSTRAINT TRIGGER "SpeakingPrompt_assessment_delete_guard" AFTER DELETE ON "SpeakingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialDelete"();
CREATE CONSTRAINT TRIGGER "WritingPrompt_assessment_delete_guard" AFTER DELETE ON "WritingPrompt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentMaterialDelete"();

CREATE FUNCTION "guardAssessmentDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."sealedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "CourseClass" WHERE id = OLD."classId" AND "courseId" = OLD."courseId") THEN
    RAISE EXCEPTION 'Sealed assessment cannot be deleted while its class exists';
  END IF;
  RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessment_delete_guard" AFTER DELETE ON "ClassAssessment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentDelete"();

CREATE FUNCTION "guardAssessmentReceiptWrite"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "ClassAssessmentStatus";
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Assessment receipt and answers cannot change'; END IF;
  SELECT status INTO parent_status FROM "ClassAssessment" WHERE id = NEW."assessmentId" FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'READY'::"ClassAssessmentStatus" THEN
    RAISE EXCEPTION 'Assessment must be ready before recording a submission';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentSubmission_write_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentSubmission" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptWrite"();
CREATE TRIGGER "ClassAssessmentAnswer_write_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentAnswer" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptWrite"();
CREATE TRIGGER "ClassAssessmentProductiveEvidence_write_guard" BEFORE INSERT OR UPDATE ON "ClassAssessmentProductiveEvidence" FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptWrite"();

-- The application must additionally verify the durable grant, operation and input digest.
CREATE FUNCTION "checkAssessmentProductiveEvidence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "ClassAssessment"%ROWTYPE; source_score DOUBLE PRECISION;
BEGIN
  SELECT * INTO parent FROM "ClassAssessment" WHERE id = NEW."assessmentId" FOR UPDATE;
  IF NOT FOUND OR NEW."materialDigest" IS DISTINCT FROM parent."reviewedMaterialDigest" THEN
    RAISE EXCEPTION 'Assessment evidence material does not match';
  END IF;
  IF NEW."speakingRecordingId" IS NOT NULL THEN
    SELECT "overallScore" INTO source_score FROM "SpeakingRecording"
      WHERE id = NEW."speakingRecordingId" AND "assessmentSectionId" = NEW."sectionId"
        AND "promptId" = NEW."promptId" AND "userId" = parent."userId"
        AND attempt = parent."assessmentAttempt" AND status = 'SCORED'
        AND "gradingOperationId" = NEW."operationId" FOR UPDATE;
  ELSE
    SELECT "overallScore" INTO source_score FROM "WritingResponse"
      WHERE id = NEW."writingResponseId" AND "assessmentSectionId" = NEW."sectionId"
        AND "promptId" = NEW."promptId" AND "userId" = parent."userId"
        AND attempt = parent."assessmentAttempt" AND "gradingState"->>'status' = 'COMPLETED'
        AND "gradingState"->>'id' = NEW."operationId"
        AND "gradingState"->>'fingerprint' = NEW."operationFingerprint"
        AND "gradingState"->>'userId' = parent."userId"
        AND "gradingState"->>'courseId' = parent."courseId" FOR UPDATE;
  END IF;
  IF NOT FOUND OR source_score IS NULL OR source_score IS DISTINCT FROM NEW.score THEN
    RAISE EXCEPTION 'Assessment evidence does not match completed owned work';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClassAssessmentProductiveEvidence_binding" BEFORE INSERT ON "ClassAssessmentProductiveEvidence" FOR EACH ROW EXECUTE FUNCTION "checkAssessmentProductiveEvidence"();

CREATE FUNCTION "guardAssessmentReceiptDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "ClassAssessment" WHERE id = OLD."assessmentId" FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'Assessment receipt and answers cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessmentSubmission_delete_guard" AFTER DELETE ON "ClassAssessmentSubmission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptDelete"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentAnswer_delete_guard" AFTER DELETE ON "ClassAssessmentAnswer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptDelete"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentProductiveEvidence_delete_guard" AFTER DELETE ON "ClassAssessmentProductiveEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "guardAssessmentReceiptDelete"();

-- A receipt and its answers must commit in the same transaction as the state transition.
CREATE FUNCTION "requireAssessmentCommit"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "ClassAssessmentStatus";
BEGIN
  SELECT status INTO parent_status FROM "ClassAssessment" WHERE id = NEW."assessmentId" FOR UPDATE;
  IF FOUND AND parent_status <> 'COMMITTED' THEN
    RAISE EXCEPTION 'Assessment submission must commit atomically';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ClassAssessmentSubmission_atomic_commit" AFTER INSERT ON "ClassAssessmentSubmission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "requireAssessmentCommit"();
CREATE CONSTRAINT TRIGGER "ClassAssessmentProductiveEvidence_atomic_commit" AFTER INSERT ON "ClassAssessmentProductiveEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "requireAssessmentCommit"();
