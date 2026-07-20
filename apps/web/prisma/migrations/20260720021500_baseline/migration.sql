-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('PENDING', 'DISCOVERING', 'EXTRACTING', 'RESEARCHING', 'PLANNING', 'SCRIPTING', 'COMPILING', 'SCRIPT_READY', 'GENERATING_AUDIO', 'STITCHING', 'READY', 'UPDATING', 'FAILED', 'IMPORTING', 'TRANSCRIBING');

-- CreateEnum
CREATE TYPE "EpisodeVisibility" AS ENUM ('UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "EpisodeSource" AS ENUM ('WEB', 'API', 'AGENT', 'IMPORT', 'ADMIN', 'CLASS');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('PENDING', 'ANSWERING', 'ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EPISODE_READY', 'EPISODE_FAILED', 'KEY_INVALID', 'SCRIPT_READY', 'PLATFORM_ANNOUNCEMENT', 'PIPELINE_FAILURE');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('BUG', 'FEATURE_REQUEST', 'GENERAL', 'PRAISE', 'CONCERN');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('WEB', 'PAPER', 'BOOK', 'ARTICLE', 'VIDEO', 'REPORT');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'REPLACED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "PlacementSource" AS ENUM ('TEST', 'NOTES', 'NOTES_VERIFIED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PedagogyStyle" AS ENUM ('BALANCED', 'IMMERSION', 'GRAMMAR', 'COMMUNICATION', 'INTENSIVE');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('LOCKED', 'GENERATING', 'AVAILABLE', 'IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PracticeKind" AS ENUM ('FULL', 'GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING', 'VOCAB');

-- CreateEnum
CREATE TYPE "PracticeStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FocusTargetKind" AS ENUM ('WORD', 'PHRASE', 'SENTENCE');

-- CreateEnum
CREATE TYPE "FocusTargetSource" AS ENUM ('TRANSCRIPT', 'CLASS', 'PRACTICE', 'NOTES', 'LIVE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SpeakingGradeStatus" AS ENUM ('PENDING', 'GRADING', 'SCORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExamInstitution" AS ENUM ('GOETHE', 'DELE', 'CAMBRIDGE', 'CEFR_GENERIC');

-- CreateEnum
CREATE TYPE "MockExamStatus" AS ENUM ('GENERATING', 'READY', 'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'FAILED');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('VOCAB_VOCAB', 'VOCAB_GRAMMAR', 'VOCAB_CLASS', 'VOCAB_EPISODE', 'GRAMMAR_GRAMMAR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "preferredLanguage" TEXT,
    "preferredTtsProvider" TEXT,
    "preferredTtsModel" TEXT,
    "preferredSttModel" TEXT,
    "preferredAiProvider" TEXT,
    "preferredAiModel" TEXT,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "showAgentUsageStatus" BOOLEAN NOT NULL DEFAULT true,
    "themeMode" TEXT NOT NULL DEFAULT 'system',
    "themePalette" TEXT NOT NULL DEFAULT 'aula',
    "themeAccent" TEXT,
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "hasCompletedOnboarding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "topic" TEXT NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'PENDING',
    "failedAtStatus" TEXT,
    "failureReason" TEXT,
    "technicalError" TEXT,
    "errorId" TEXT,
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "audioUrl" TEXT,
    "duration" INTEGER,
    "durationDeviation" INTEGER,
    "fileSize" INTEGER,
    "ttsProvider" TEXT,
    "ttsModel" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "verificationMode" TEXT NOT NULL DEFAULT 'standard',
    "aiAutoResolved" BOOLEAN NOT NULL DEFAULT false,
    "ttsAutoResolved" BOOLEAN NOT NULL DEFAULT false,
    "sttProvider" TEXT,
    "sttModel" TEXT,
    "language" TEXT,
    "source" "EpisodeSource" NOT NULL DEFAULT 'WEB',
    "visibility" "EpisodeVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isDelisted" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "lastCompletedStitchKey" TEXT,
    "activeStitchKey" TEXT,
    "activeStitchOwner" TEXT,
    "audioGenerationKey" TEXT,
    "pdfUrl" TEXT,
    "waveformUrl" TEXT,
    "spectrogramUrl" TEXT,
    "lowReferences" BOOLEAN NOT NULL DEFAULT false,
    "verificationProgress" JSONB,
    "sourcePlatform" TEXT,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchDossier" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "userBrief" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "gaps" JSONB,
    "blockedClaims" JSONB,
    "recommendedAngle" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,

    CONSTRAINT "ResearchDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeOutline" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "drivingQuestion" TEXT NOT NULL,
    "listenerPromise" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "narrativeFramework" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "beats" JSONB NOT NULL,
    "tensionCurve" JSONB,
    "bannedAngles" JSONB,
    "unresolvedQuestions" JSONB,
    "speakerRoles" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,

    CONSTRAINT "CreativeOutline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "topic" TEXT,
    "depth" TEXT,
    "audienceLevel" TEXT,
    "audience" TEXT,
    "focusAreas" TEXT[],
    "tone" TEXT,
    "durationTarget" INTEGER,
    "speakers" JSONB,
    "priorKnowledge" TEXT,
    "sourceUrl" TEXT,
    "sourceContent" TEXT,
    "sourceMetadata" JSONB,
    "verificationMode" TEXT NOT NULL DEFAULT 'standard',
    "feasibilityVerdict" TEXT,
    "feasibilitySuggestion" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Discovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentIngestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "provider" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "runId" TEXT,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryMessage" (
    "id" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chips" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryChatError" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "errorKind" TEXT NOT NULL,
    "errorDetail" TEXT,
    "discoveryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryChatError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "soundCues" JSONB,
    "markdown" TEXT NOT NULL,
    "context" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationFeedback" TEXT,
    "verificationClaims" JSONB,
    "compiledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioUrl" TEXT,
    "order" INTEGER NOT NULL,
    "startTime" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "wordTimings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ttsProvider" TEXT,
    "ttsModel" TEXT,
    "ttsVoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeVoice" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "voiceId" TEXT,
    "provider" TEXT,

    CONSTRAINT "EpisodeVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVoicePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserVoicePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeVersion" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "duration" INTEGER,
    "changeType" TEXT NOT NULL,
    "changeSummary" TEXT,
    "interactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeVersionSegment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startTime" DOUBLE PRECISION,
    "ttsVoiceId" TEXT,

    CONSTRAINT "EpisodeVersionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "InteractionStatus" NOT NULL DEFAULT 'PENDING',
    "question" TEXT NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "answer" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "incorporated" BOOLEAN NOT NULL DEFAULT false,
    "helpful" BOOLEAN,
    "segmentOrder" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Save" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Save_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeTag" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EpisodeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'onboarding',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "idempotencyKey" TEXT,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "episodeId" TEXT,
    "userId" TEXT,
    "service" TEXT NOT NULL,
    "modelId" TEXT,
    "category" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "type" "FeedbackType" NOT NULL,
    "rating" INTEGER,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Paired device',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "year" INTEGER,
    "url" TEXT,
    "type" "ReferenceType" NOT NULL DEFAULT 'WEB',
    "publisher" TEXT,
    "doi" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verificationDetails" JSONB,
    "originalTitle" TEXT,
    "contentDomain" TEXT,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyEntry" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "word" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "pronunciation" TEXT,
    "exampleSentence" TEXT,
    "difficulty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTtsKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "extraData" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTtsKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVisualCueKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVisualCueKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoModelConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "aiProvider" TEXT NOT NULL DEFAULT 'anthropic',
    "aiModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    "ttsProvider" TEXT NOT NULL DEFAULT 'openai',
    "ttsModel" TEXT NOT NULL DEFAULT 'tts-1-hd',
    "sttProvider" TEXT NOT NULL DEFAULT 'openai',
    "sttModel" TEXT NOT NULL DEFAULT 'whisper-large-v3-turbo',
    "platformAiProvider" TEXT NOT NULL DEFAULT 'anthropic',
    "platformAiModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    "includedModels" JSONB,
    "includedTtsModels" JSONB,
    "includedSttModels" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AutoModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiBaseUrl" TEXT,
    "sttProvider" TEXT,
    "sttBaseUrl" TEXT,
    "sttModel" TEXT,
    "ttsProvider" TEXT,
    "ttsBaseUrl" TEXT,
    "storageProvider" TEXT,
    "s3Bucket" TEXT,
    "s3Region" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioFingerprint" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "fingerprint" INTEGER[],
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPricingSnapshot" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputPerMTok" DOUBLE PRECISION NOT NULL,
    "outputPerMTok" DOUBLE PRECISION NOT NULL,
    "contextWindow" INTEGER,
    "maxOutputTokens" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'registry',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPricingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Curriculum" (
    "id" TEXT NOT NULL,
    "nativeLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'seeded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Curriculum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "curriculumId" TEXT NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "order" INTEGER NOT NULL,
    "parentId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "grammarPoints" JSONB NOT NULL,
    "vocabThemes" JSONB NOT NULL,
    "targetVocab" JSONB NOT NULL,
    "canDoSummary" TEXT,
    "estMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nativeLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "curriculumId" TEXT NOT NULL,
    "currentLevel" "CefrLevel" NOT NULL DEFAULT 'A1',
    "startLevel" "CefrLevel" NOT NULL DEFAULT 'A1',
    "placementSource" "PlacementSource",
    "pedagogy" "PedagogyStyle" NOT NULL DEFAULT 'BALANCED',
    "activeClassId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementResult" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "responses" JSONB NOT NULL,
    "scoreBySkill" JSONB NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseClass" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'LOCKED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "adaptiveSeed" JSONB,
    "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "worksheetPdfUrl" TEXT,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "submittedAt" TIMESTAMP(3),
    "passedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSection" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "SectionStatus" NOT NULL DEFAULT 'PENDING',
    "seed" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "episodeId" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonQuestion" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "skill" "SkillType" NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "vocabIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grammarKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "passageRef" TEXT,
    "passageText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSubmission" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingPrompt" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT,
    "practiceSessionId" TEXT,
    "examSectionId" TEXT,
    "order" INTEGER NOT NULL,
    "targetPhrase" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "ipa" TEXT,
    "referenceTtsUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakingPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingRecording" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT,
    "practiceSessionId" TEXT,
    "examSectionId" TEXT,
    "promptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "transcript" TEXT,
    "overallScore" DOUBLE PRECISION,
    "rubricScores" JSONB,
    "phonemeScores" JSONB,
    "feedback" TEXT,
    "status" "SpeakingGradeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingPrompt" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT,
    "practiceSessionId" TEXT,
    "examSectionId" TEXT,
    "order" INTEGER NOT NULL,
    "task" TEXT NOT NULL,
    "guidance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingResponse" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT,
    "practiceSessionId" TEXT,
    "examSectionId" TEXT,
    "promptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "corrections" JSONB,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockExam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "institution" "ExamInstitution" NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "status" "MockExamStatus" NOT NULL DEFAULT 'GENERATING',
    "blueprintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSection" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "part" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SectionStatus" NOT NULL DEFAULT 'PENDING',
    "episodeId" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "skill" "SkillType" NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "passageRef" TEXT,
    "passageText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSubmission" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "band" TEXT,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSectionResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT,

    CONSTRAINT "ExamSectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerVocab" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "pronunciation" TEXT,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastReviewed" TIMESTAMP(3),
    "firstSeenClassId" TEXT,
    "cefrLevel" "CefrLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerVocab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerGrammar" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cefrLevel" "CefrLevel",
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastReviewed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerGrammar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabEdge" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" "EdgeType" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sourceVocabId" TEXT,
    "targetVocabId" TEXT,
    "grammarId" TEXT,
    "classId" TEXT,
    "episodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" "PracticeKind" NOT NULL,
    "status" "PracticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "items" JSONB NOT NULL,
    "seed" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "vocabLemmas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grammarKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "focusTargetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "episodeId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerFocusTarget" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" "FocusTargetKind" NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "contextText" TEXT,
    "sourceType" "FocusTargetSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "userMarkedDifficulty" INTEGER NOT NULL DEFAULT 3,
    "priorityBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "visualCueUrl" TEXT,
    "visualCueAlt" TEXT,
    "visualCueAttribution" TEXT,
    "visualCueProvider" TEXT,
    "pronunciationAudioUrl" TEXT,
    "lastSelectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPracticedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerFocusTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseNote" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Episode_userId_idx" ON "Episode"("userId");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE INDEX "Episode_visibility_idx" ON "Episode"("visibility");

-- CreateIndex
CREATE INDEX "Episode_createdAt_idx" ON "Episode"("createdAt");

-- CreateIndex
CREATE INDEX "Episode_deletedAt_idx" ON "Episode"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_userId_slug_key" ON "Episode"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDossier_episodeId_key" ON "ResearchDossier"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeOutline_episodeId_key" ON "CreativeOutline"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Discovery_episodeId_key" ON "Discovery"("episodeId");

-- CreateIndex
CREATE INDEX "Discovery_userId_idx" ON "Discovery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIngestion_episodeId_key" ON "AgentIngestion"("episodeId");

-- CreateIndex
CREATE INDEX "AgentIngestion_userId_createdAt_idx" ON "AgentIngestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentIngestion_contentHash_idx" ON "AgentIngestion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIngestion_userId_idempotencyKey_key" ON "AgentIngestion"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DiscoveryMessage_discoveryId_idx" ON "DiscoveryMessage"("discoveryId");

-- CreateIndex
CREATE INDEX "DiscoveryChatError_createdAt_idx" ON "DiscoveryChatError"("createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryChatError_userId_idx" ON "DiscoveryChatError"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Script_episodeId_key" ON "Script"("episodeId");

-- CreateIndex
CREATE INDEX "Segment_episodeId_idx" ON "Segment"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_episodeId_order_key" ON "Segment"("episodeId", "order");

-- CreateIndex
CREATE INDEX "EpisodeVoice_episodeId_idx" ON "EpisodeVoice"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeVoice_episodeId_speaker_key" ON "EpisodeVoice"("episodeId", "speaker");

-- CreateIndex
CREATE INDEX "UserVoicePreference_userId_idx" ON "UserVoicePreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserVoicePreference_userId_speaker_key" ON "UserVoicePreference"("userId", "speaker");

-- CreateIndex
CREATE INDEX "EpisodeVersion_episodeId_idx" ON "EpisodeVersion"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeVersion_episodeId_version_key" ON "EpisodeVersion"("episodeId", "version");

-- CreateIndex
CREATE INDEX "EpisodeVersionSegment_versionId_idx" ON "EpisodeVersionSegment"("versionId");

-- CreateIndex
CREATE INDEX "Interaction_episodeId_idx" ON "Interaction"("episodeId");

-- CreateIndex
CREATE INDEX "Interaction_userId_idx" ON "Interaction"("userId");

-- CreateIndex
CREATE INDEX "Interaction_status_idx" ON "Interaction"("status");

-- CreateIndex
CREATE INDEX "Save_episodeId_idx" ON "Save"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Save_userId_episodeId_key" ON "Save"("userId", "episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_slug_idx" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_parentId_idx" ON "Tag"("parentId");

-- CreateIndex
CREATE INDEX "EpisodeTag_tagId_idx" ON "EpisodeTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeTag_episodeId_tagId_key" ON "EpisodeTag"("episodeId", "tagId");

-- CreateIndex
CREATE INDEX "UserInterest_userId_idx" ON "UserInterest"("userId");

-- CreateIndex
CREATE INDEX "UserInterest_tagId_idx" ON "UserInterest"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "UserInterest_userId_tagId_key" ON "UserInterest"("userId", "tagId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "Job_episodeId_idx" ON "Job"("episodeId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_episodeId_createdAt_idx" ON "PipelineEvent"("episodeId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_type_createdAt_idx" ON "PipelineEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineEvent_idempotencyKey_key" ON "PipelineEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApiUsageLog_episodeId_idx" ON "ApiUsageLog"("episodeId");

-- CreateIndex
CREATE INDEX "ApiUsageLog_userId_idx" ON "ApiUsageLog"("userId");

-- CreateIndex
CREATE INDEX "ApiUsageLog_createdAt_idx" ON "ApiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_service_idx" ON "ApiUsageLog"("service");

-- CreateIndex
CREATE INDEX "ApiUsageLog_modelId_idx" ON "ApiUsageLog"("modelId");

-- CreateIndex
CREATE INDEX "Feedback_type_idx" ON "Feedback"("type");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "PairingToken_tokenHash_key" ON "PairingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PairingToken_userId_idx" ON "PairingToken"("userId");

-- CreateIndex
CREATE INDEX "PairingToken_tokenHash_idx" ON "PairingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Reference_episodeId_idx" ON "Reference"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_episodeId_number_key" ON "Reference"("episodeId", "number");

-- CreateIndex
CREATE INDEX "VocabularyEntry_episodeId_idx" ON "VocabularyEntry"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_episodeId_number_key" ON "VocabularyEntry"("episodeId", "number");

-- CreateIndex
CREATE INDEX "UserTtsKey_userId_idx" ON "UserTtsKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTtsKey_userId_provider_key" ON "UserTtsKey"("userId", "provider");

-- CreateIndex
CREATE INDEX "UserAiKey_userId_idx" ON "UserAiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAiKey_userId_provider_key" ON "UserAiKey"("userId", "provider");

-- CreateIndex
CREATE INDEX "UserVisualCueKey_userId_idx" ON "UserVisualCueKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserVisualCueKey_userId_provider_key" ON "UserVisualCueKey"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AudioFingerprint_episodeId_key" ON "AudioFingerprint"("episodeId");

-- CreateIndex
CREATE INDEX "AudioFingerprint_duration_idx" ON "AudioFingerprint"("duration");

-- CreateIndex
CREATE INDEX "ModelPricingSnapshot_modelId_createdAt_idx" ON "ModelPricingSnapshot"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelPricingSnapshot_createdAt_idx" ON "ModelPricingSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Curriculum_nativeLang_targetLang_key" ON "Curriculum"("nativeLang", "targetLang");

-- CreateIndex
CREATE INDEX "Lesson_curriculumId_level_order_idx" ON "Lesson"("curriculumId", "level", "order");

-- CreateIndex
CREATE INDEX "Lesson_parentId_idx" ON "Lesson"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_curriculumId_slug_key" ON "Lesson"("curriculumId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_curriculumId_order_key" ON "Lesson"("curriculumId", "order");

-- CreateIndex
CREATE INDEX "Course_userId_idx" ON "Course"("userId");

-- CreateIndex
CREATE INDEX "Course_curriculumId_idx" ON "Course"("curriculumId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_userId_nativeLang_targetLang_key" ON "Course"("userId", "nativeLang", "targetLang");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementResult_courseId_key" ON "PlacementResult"("courseId");

-- CreateIndex
CREATE INDEX "CourseClass_courseId_order_idx" ON "CourseClass"("courseId", "order");

-- CreateIndex
CREATE INDEX "CourseClass_courseId_status_idx" ON "CourseClass"("courseId", "status");

-- CreateIndex
CREATE INDEX "CourseClass_lessonId_idx" ON "CourseClass"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSection_episodeId_key" ON "ClassSection"("episodeId");

-- CreateIndex
CREATE INDEX "ClassSection_classId_skill_attempt_idx" ON "ClassSection"("classId", "skill", "attempt");

-- CreateIndex
CREATE INDEX "LessonQuestion_sectionId_idx" ON "LessonQuestion"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonQuestion_sectionId_order_key" ON "LessonQuestion"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSubmission_classId_key" ON "ClassSubmission"("classId");

-- CreateIndex
CREATE INDEX "ClassSubmission_userId_idx" ON "ClassSubmission"("userId");

-- CreateIndex
CREATE INDEX "SectionAnswer_sectionId_idx" ON "SectionAnswer"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionAnswer_submissionId_questionId_key" ON "SectionAnswer"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "SpeakingPrompt_sectionId_idx" ON "SpeakingPrompt"("sectionId");

-- CreateIndex
CREATE INDEX "SpeakingPrompt_practiceSessionId_idx" ON "SpeakingPrompt"("practiceSessionId");

-- CreateIndex
CREATE INDEX "SpeakingPrompt_examSectionId_idx" ON "SpeakingPrompt"("examSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingPrompt_sectionId_order_key" ON "SpeakingPrompt"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingPrompt_practiceSessionId_order_key" ON "SpeakingPrompt"("practiceSessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingPrompt_examSectionId_order_key" ON "SpeakingPrompt"("examSectionId", "order");

-- CreateIndex
CREATE INDEX "SpeakingRecording_sectionId_idx" ON "SpeakingRecording"("sectionId");

-- CreateIndex
CREATE INDEX "SpeakingRecording_practiceSessionId_idx" ON "SpeakingRecording"("practiceSessionId");

-- CreateIndex
CREATE INDEX "SpeakingRecording_examSectionId_idx" ON "SpeakingRecording"("examSectionId");

-- CreateIndex
CREATE INDEX "SpeakingRecording_promptId_idx" ON "SpeakingRecording"("promptId");

-- CreateIndex
CREATE INDEX "SpeakingRecording_userId_idx" ON "SpeakingRecording"("userId");

-- CreateIndex
CREATE INDEX "WritingPrompt_sectionId_idx" ON "WritingPrompt"("sectionId");

-- CreateIndex
CREATE INDEX "WritingPrompt_practiceSessionId_idx" ON "WritingPrompt"("practiceSessionId");

-- CreateIndex
CREATE INDEX "WritingPrompt_examSectionId_idx" ON "WritingPrompt"("examSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "WritingPrompt_sectionId_order_key" ON "WritingPrompt"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "WritingPrompt_practiceSessionId_order_key" ON "WritingPrompt"("practiceSessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "WritingPrompt_examSectionId_order_key" ON "WritingPrompt"("examSectionId", "order");

-- CreateIndex
CREATE INDEX "WritingResponse_sectionId_idx" ON "WritingResponse"("sectionId");

-- CreateIndex
CREATE INDEX "WritingResponse_practiceSessionId_idx" ON "WritingResponse"("practiceSessionId");

-- CreateIndex
CREATE INDEX "WritingResponse_examSectionId_idx" ON "WritingResponse"("examSectionId");

-- CreateIndex
CREATE INDEX "WritingResponse_promptId_idx" ON "WritingResponse"("promptId");

-- CreateIndex
CREATE INDEX "WritingResponse_userId_idx" ON "WritingResponse"("userId");

-- CreateIndex
CREATE INDEX "MockExam_userId_idx" ON "MockExam"("userId");

-- CreateIndex
CREATE INDEX "MockExam_courseId_idx" ON "MockExam"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSection_episodeId_key" ON "ExamSection"("episodeId");

-- CreateIndex
CREATE INDEX "ExamSection_examId_order_idx" ON "ExamSection"("examId", "order");

-- CreateIndex
CREATE INDEX "ExamQuestion_sectionId_idx" ON "ExamQuestion"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestion_sectionId_order_key" ON "ExamQuestion"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSubmission_examId_key" ON "ExamSubmission"("examId");

-- CreateIndex
CREATE INDEX "ExamSectionResult_sectionId_idx" ON "ExamSectionResult"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSectionResult_submissionId_sectionId_key" ON "ExamSectionResult"("submissionId", "sectionId");

-- CreateIndex
CREATE INDEX "LearnerVocab_courseId_dueAt_idx" ON "LearnerVocab"("courseId", "dueAt");

-- CreateIndex
CREATE INDEX "LearnerVocab_courseId_mastery_idx" ON "LearnerVocab"("courseId", "mastery");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerVocab_courseId_lemma_key" ON "LearnerVocab"("courseId", "lemma");

-- CreateIndex
CREATE INDEX "LearnerGrammar_courseId_dueAt_idx" ON "LearnerGrammar"("courseId", "dueAt");

-- CreateIndex
CREATE INDEX "LearnerGrammar_courseId_mastery_idx" ON "LearnerGrammar"("courseId", "mastery");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerGrammar_courseId_topicKey_key" ON "LearnerGrammar"("courseId", "topicKey");

-- CreateIndex
CREATE INDEX "VocabEdge_courseId_type_idx" ON "VocabEdge"("courseId", "type");

-- CreateIndex
CREATE INDEX "VocabEdge_sourceVocabId_idx" ON "VocabEdge"("sourceVocabId");

-- CreateIndex
CREATE INDEX "VocabEdge_targetVocabId_idx" ON "VocabEdge"("targetVocabId");

-- CreateIndex
CREATE INDEX "VocabEdge_grammarId_idx" ON "VocabEdge"("grammarId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSession_episodeId_key" ON "PracticeSession"("episodeId");

-- CreateIndex
CREATE INDEX "PracticeSession_courseId_kind_idx" ON "PracticeSession"("courseId", "kind");

-- CreateIndex
CREATE INDEX "PracticeSession_courseId_status_idx" ON "PracticeSession"("courseId", "status");

-- CreateIndex
CREATE INDEX "LearnerFocusTarget_courseId_kind_idx" ON "LearnerFocusTarget"("courseId", "kind");

-- CreateIndex
CREATE INDEX "LearnerFocusTarget_courseId_lastSelectedAt_idx" ON "LearnerFocusTarget"("courseId", "lastSelectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerFocusTarget_courseId_kind_normalizedText_key" ON "LearnerFocusTarget"("courseId", "kind", "normalizedText");

-- CreateIndex
CREATE UNIQUE INDEX "CourseNote_courseId_key" ON "CourseNote"("courseId");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchDossier" ADD CONSTRAINT "ResearchDossier_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeOutline" ADD CONSTRAINT "CreativeOutline_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discovery" ADD CONSTRAINT "Discovery_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discovery" ADD CONSTRAINT "Discovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIngestion" ADD CONSTRAINT "AgentIngestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIngestion" ADD CONSTRAINT "AgentIngestion_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryMessage" ADD CONSTRAINT "DiscoveryMessage_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryChatError" ADD CONSTRAINT "DiscoveryChatError_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVoice" ADD CONSTRAINT "EpisodeVoice_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVoicePreference" ADD CONSTRAINT "UserVoicePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVersion" ADD CONSTRAINT "EpisodeVersion_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVersion" ADD CONSTRAINT "EpisodeVersion_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVersionSegment" ADD CONSTRAINT "EpisodeVersionSegment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTag" ADD CONSTRAINT "EpisodeTag_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTag" ADD CONSTRAINT "EpisodeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingToken" ADD CONSTRAINT "PairingToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyEntry" ADD CONSTRAINT "VocabularyEntry_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTtsKey" ADD CONSTRAINT "UserTtsKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAiKey" ADD CONSTRAINT "UserAiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVisualCueKey" ADD CONSTRAINT "UserVisualCueKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioFingerprint" ADD CONSTRAINT "AudioFingerprint_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResult" ADD CONSTRAINT "PlacementResult_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CourseClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonQuestion" ADD CONSTRAINT "LessonQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubmission" ADD CONSTRAINT "ClassSubmission_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CourseClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubmission" ADD CONSTRAINT "ClassSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAnswer" ADD CONSTRAINT "SectionAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ClassSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingPrompt" ADD CONSTRAINT "SpeakingPrompt_examSectionId_fkey" FOREIGN KEY ("examSectionId") REFERENCES "ExamSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SpeakingPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingRecording" ADD CONSTRAINT "SpeakingRecording_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingPrompt" ADD CONSTRAINT "WritingPrompt_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingPrompt" ADD CONSTRAINT "WritingPrompt_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingPrompt" ADD CONSTRAINT "WritingPrompt_examSectionId_fkey" FOREIGN KEY ("examSectionId") REFERENCES "ExamSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "WritingPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingResponse" ADD CONSTRAINT "WritingResponse_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExam" ADD CONSTRAINT "MockExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExam" ADD CONSTRAINT "MockExam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSection" ADD CONSTRAINT "ExamSection_examId_fkey" FOREIGN KEY ("examId") REFERENCES "MockExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSection" ADD CONSTRAINT "ExamSection_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ExamSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "MockExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSectionResult" ADD CONSTRAINT "ExamSectionResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExamSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerVocab" ADD CONSTRAINT "LearnerVocab_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerGrammar" ADD CONSTRAINT "LearnerGrammar_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabEdge" ADD CONSTRAINT "VocabEdge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabEdge" ADD CONSTRAINT "VocabEdge_sourceVocabId_fkey" FOREIGN KEY ("sourceVocabId") REFERENCES "LearnerVocab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabEdge" ADD CONSTRAINT "VocabEdge_targetVocabId_fkey" FOREIGN KEY ("targetVocabId") REFERENCES "LearnerVocab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerFocusTarget" ADD CONSTRAINT "LearnerFocusTarget_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseNote" ADD CONSTRAINT "CourseNote_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
