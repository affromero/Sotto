-- AlterTable
ALTER TABLE "CourseClass" ADD COLUMN     "learningSelection" JSONB;

-- AlterTable
ALTER TABLE "LessonQuestion" ADD COLUMN     "learningAssessment" JSONB;

-- AlterTable
ALTER TABLE "SpeakingPrompt" ADD COLUMN     "learningObjectives" JSONB;

-- AlterTable
ALTER TABLE "SpeakingRecording" ADD COLUMN     "objectiveEvidence" JSONB;

-- AlterTable
ALTER TABLE "WritingPrompt" ADD COLUMN     "learningObjectives" JSONB;

-- AlterTable
ALTER TABLE "WritingResponse" ADD COLUMN     "objectiveEvidence" JSONB;

-- AlterTable
ALTER TABLE "PracticeSession" ADD COLUMN     "learningSelection" JSONB;

-- CreateTable
CREATE TABLE "LearningMapRevision" (
    "id" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "catalogHash" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningMapRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningNodeIdentity" (
    "id" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningNodeIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningLevelBinding" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "revisionId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "coverage" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningLevelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningLevelCompletion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "nextLevel" "CefrLevel",
    "bindingId" TEXT NOT NULL,
    "intentHash" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningLevelCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObservation" (
    "id" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "criterionVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "skill" "SkillType" NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "responseIdentity" TEXT NOT NULL,
    "quality" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerObjectiveState" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "criterionVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "skill" "SkillType" NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "assessedTasks" INTEGER NOT NULL DEFAULT 0,
    "assessedSessions" INTEGER NOT NULL DEFAULT 0,
    "lastQuality" DOUBLE PRECISION,
    "lastReviewed" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerObjectiveState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonLearningObjective" (
    "lessonId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "criterionVersion" INTEGER NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "LessonLearningObjective_pkey" PRIMARY KEY ("lessonId","objectiveId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningMapRevision_targetLang_version_key" ON "LearningMapRevision"("targetLang", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMapRevision_targetLang_catalogHash_key" ON "LearningMapRevision"("targetLang", "catalogHash");

-- CreateIndex
CREATE INDEX "LearningNodeIdentity_targetLang_kind_idx" ON "LearningNodeIdentity"("targetLang", "kind");

-- CreateIndex
CREATE INDEX "LearningLevelBinding_revisionId_idx" ON "LearningLevelBinding"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningLevelBinding_courseId_level_key" ON "LearningLevelBinding"("courseId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "LearningLevelCompletion_requestId_key" ON "LearningLevelCompletion"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningLevelCompletion_bindingId_key" ON "LearningLevelCompletion"("bindingId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningLevelCompletion_courseId_level_key" ON "LearningLevelCompletion"("courseId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObservation_deduplicationKey_key" ON "LearningObservation"("deduplicationKey");

-- CreateIndex
CREATE INDEX "LearningObservation_courseId_objectiveId_criterionVersion_p_idx" ON "LearningObservation"("courseId", "objectiveId", "criterionVersion", "policyVersion", "level", "skill");

-- CreateIndex
CREATE INDEX "LearningObservation_courseId_sessionId_idx" ON "LearningObservation"("courseId", "sessionId");

-- CreateIndex
CREATE INDEX "LearningObservation_courseId_observedAt_id_idx" ON "LearningObservation"("courseId", "observedAt", "id");

-- CreateIndex
CREATE INDEX "LearnerObjectiveState_courseId_dueAt_idx" ON "LearnerObjectiveState"("courseId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerObjectiveState_criterion_key" ON "LearnerObjectiveState"("courseId", "objectiveId", "criterionVersion", "policyVersion", "level", "skill");

-- CreateIndex
CREATE INDEX "LessonLearningObjective_objectiveId_idx" ON "LessonLearningObjective"("objectiveId");

-- AddForeignKey
ALTER TABLE "LearningLevelBinding" ADD CONSTRAINT "LearningLevelBinding_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningLevelBinding" ADD CONSTRAINT "LearningLevelBinding_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "LearningMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningLevelCompletion" ADD CONSTRAINT "LearningLevelCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningLevelCompletion" ADD CONSTRAINT "LearningLevelCompletion_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "LearningLevelBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObservation" ADD CONSTRAINT "LearningObservation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObservation" ADD CONSTRAINT "LearningObservation_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "LearningNodeIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObservation" ADD CONSTRAINT "LearningObservation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "LearningMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerObjectiveState" ADD CONSTRAINT "LearnerObjectiveState_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerObjectiveState" ADD CONSTRAINT "LearnerObjectiveState_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "LearningNodeIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLearningObjective" ADD CONSTRAINT "LessonLearningObjective_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLearningObjective" ADD CONSTRAINT "LessonLearningObjective_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "LearningNodeIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
