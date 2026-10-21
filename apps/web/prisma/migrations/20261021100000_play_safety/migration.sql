-- AlterTable
ALTER TABLE "PlayJoinRequest" ADD COLUMN     "acceptedConductAt" TIMESTAMP(3),
ADD COLUMN     "acceptedConductVersion" INTEGER;

-- CreateTable
CREATE TABLE "PlaySafetyState" (
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "conductVersion" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "sharingRestrictedAt" TIMESTAMP(3),

    CONSTRAINT "PlaySafetyState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PlayUserBlock" (
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayUserBlock_pkey" PRIMARY KEY ("blockerUserId","blockedUserId")
);

-- CreateTable
CREATE TABLE "PlaySafetyReport" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "roomId" TEXT,
    "roundId" TEXT,
    "category" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" TEXT,
    "reviewAction" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responderUserId" TEXT,

    CONSTRAINT "PlaySafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaySafetyReceipt" (
    "actorUserId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaySafetyReceipt_pkey" PRIMARY KEY ("actorUserId","actionId")
);

-- CreateIndex
CREATE INDEX "PlayUserBlock_blockerUserId_createdAt_blockedUserId_idx" ON "PlayUserBlock"("blockerUserId", "createdAt", "blockedUserId");

-- CreateIndex
CREATE INDEX "PlayUserBlock_blockedUserId_idx" ON "PlayUserBlock"("blockedUserId");

-- CreateIndex
CREATE INDEX "PlaySafetyReport_reporterUserId_createdAt_id_idx" ON "PlaySafetyReport"("reporterUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PlaySafetyReport_status_createdAt_id_idx" ON "PlaySafetyReport"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PlaySafetyReport_subjectUserId_idx" ON "PlaySafetyReport"("subjectUserId");

-- CreateIndex
CREATE INDEX "PlaySafetyReport_roomId_idx" ON "PlaySafetyReport"("roomId");

-- CreateIndex
CREATE INDEX "PlaySafetyReport_roundId_idx" ON "PlaySafetyReport"("roundId");

-- AddForeignKey
ALTER TABLE "PlaySafetyState" ADD CONSTRAINT "PlaySafetyState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayUserBlock" ADD CONSTRAINT "PlayUserBlock_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayUserBlock" ADD CONSTRAINT "PlayUserBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_responderUserId_fkey" FOREIGN KEY ("responderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PlayRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySafetyReceipt" ADD CONSTRAINT "PlaySafetyReceipt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_conduct_check" CHECK (
  ("acceptedConductVersion" IS NULL AND "acceptedConductAt" IS NULL) OR
  ("acceptedConductVersion" IS NOT NULL AND "acceptedConductVersion" > 0 AND "acceptedConductAt" IS NOT NULL)
);
ALTER TABLE "PlaySafetyState" ADD CONSTRAINT "PlaySafetyState_state_check" CHECK (
  "revision" >= 0 AND (
    ("conductVersion" IS NULL AND "acceptedAt" IS NULL) OR
    ("conductVersion" IS NOT NULL AND "conductVersion" > 0 AND "acceptedAt" IS NOT NULL)
  )
);
ALTER TABLE "PlayUserBlock" ADD CONSTRAINT "PlayUserBlock_distinct_check" CHECK (
  "blockerUserId" <> "blockedUserId"
);
ALTER TABLE "PlaySafetyReport" ADD CONSTRAINT "PlaySafetyReport_content_check" CHECK (
  "reporterUserId" <> "subjectUserId" AND "revision" >= 0 AND
  "category" IN ('HARASSMENT', 'THREATS', 'HATE', 'SEXUAL_CONTENT', 'VIOLENCE', 'IMPERSONATION', 'OTHER') AND
  "status" IN ('OPEN', 'RESOLVED') AND char_length("detail") <= 1000 AND
  jsonb_typeof("evidence") = 'object' AND
  "evidence" ?& ARRAY['selector', 'text'] AND
  "evidence" - 'selector' - 'text' = '{}'::jsonb AND octet_length("evidence"::text) <= 4096 AND
  jsonb_typeof("evidence"->'selector') = 'object' AND
  jsonb_typeof("evidence"->'text') = 'string' AND
  char_length("evidence"->>'text') BETWEEN 1 AND 500 AND
  (("response" IS NULL AND "reviewAction" IS NULL AND "respondedAt" IS NULL AND "responderUserId" IS NULL) OR
   ("response" IS NOT NULL AND "reviewAction" IS NOT NULL AND "reviewAction" IN ('RESPOND', 'DISMISS', 'CLOSE_ROOM', 'RESTRICT_PLAY', 'RESTORE_PLAY') AND char_length("response") BETWEEN 1 AND 1000 AND "respondedAt" IS NOT NULL)) AND
  ("status" <> 'RESOLVED' OR "response" IS NOT NULL)
);
ALTER TABLE "PlaySafetyReceipt" ADD CONSTRAINT "PlaySafetyReceipt_result_check" CHECK (
  "operation" IN ('CONDUCT', 'BLOCK', 'UNBLOCK', 'REPORT', 'REVIEW') AND
  jsonb_typeof("result") = 'object' AND octet_length("result"::text) <= 256 AND
  "result" ?& ARRAY['actionId', 'completed'] AND
  "result" - 'actionId' - 'completed' = '{}'::jsonb AND
  jsonb_typeof("result"->'actionId') = 'string' AND
  "result"->>'actionId' = "actionId" AND "result"->'completed' = 'true'::jsonb
);
