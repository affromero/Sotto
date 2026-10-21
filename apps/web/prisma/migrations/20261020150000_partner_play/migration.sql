-- CreateTable
CREATE TABLE "PlayRoom" (
    "id" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "guestUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "kind" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "questionStyle" TEXT NOT NULL DEFAULT 'CHOICES',
    "hostSettings" JSONB NOT NULL,
    "guestSettings" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "invitationHash" TEXT,
    "invitationGeneration" INTEGER NOT NULL DEFAULT 0,
    "rematchRoomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayPresenceLease" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "credentialKind" TEXT NOT NULL,
    "viewHash" TEXT NOT NULL,
    "accessFingerprint" TEXT NOT NULL,
    "credentialExpiresAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayPresenceLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayJoinRequest" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "candidateKind" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "proposedName" TEXT,
    "settings" JSONB NOT NULL,
    "client" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "plannedProfileId" TEXT,
    "provisionedUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "enrollmentGeneration" INTEGER NOT NULL DEFAULT 1,
    "deliveryId" TEXT,
    "deliveryState" JSONB,
    "deliveryExpiresAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayRound" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "privateState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayActionReceipt" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayPhrase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "contextText" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayPhrase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayRoom_invitationHash_key" ON "PlayRoom"("invitationHash");

-- CreateIndex
CREATE INDEX "PlayRoom_hostUserId_createdAt_idx" ON "PlayRoom"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PlayRoom_guestUserId_createdAt_idx" ON "PlayRoom"("guestUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PlayRoom_status_expiresAt_idx" ON "PlayRoom"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlayPresenceLease_roomId_expiresAt_idx" ON "PlayPresenceLease"("roomId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayPresenceLease_roomId_credentialKind_credentialId_viewHa_key" ON "PlayPresenceLease"("roomId", "credentialKind", "credentialId", "viewHash");

-- CreateIndex
CREATE UNIQUE INDEX "PlayJoinRequest_proofHash_key" ON "PlayJoinRequest"("proofHash");

-- CreateIndex
CREATE UNIQUE INDEX "PlayJoinRequest_deliveryId_key" ON "PlayJoinRequest"("deliveryId");

-- CreateIndex
CREATE INDEX "PlayJoinRequest_roomId_status_expiresAt_idx" ON "PlayJoinRequest"("roomId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlayJoinRequest_candidateUserId_idx" ON "PlayJoinRequest"("candidateUserId");

-- CreateIndex
CREATE INDEX "PlayJoinRequest_provisionedUserId_idx" ON "PlayJoinRequest"("provisionedUserId");

-- CreateIndex
CREATE INDEX "PlayJoinRequest_approvedByUserId_idx" ON "PlayJoinRequest"("approvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayRound_roomId_order_key" ON "PlayRound"("roomId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PlayRound_id_roomId_key" ON "PlayRound"("id", "roomId");

-- CreateIndex
CREATE INDEX "PlayActionReceipt_roomId_idx" ON "PlayActionReceipt"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayActionReceipt_actorUserId_actionId_key" ON "PlayActionReceipt"("actorUserId", "actionId");

-- CreateIndex
CREATE INDEX "PlayPhrase_userId_createdAt_idx" ON "PlayPhrase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PlayPhrase_roomId_idx" ON "PlayPhrase"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayPhrase_userId_roundId_fingerprint_key" ON "PlayPhrase"("userId", "roundId", "fingerprint");

-- AddForeignKey
ALTER TABLE "PlayRoom" ADD CONSTRAINT "PlayRoom_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayRoom" ADD CONSTRAINT "PlayRoom_guestUserId_fkey" FOREIGN KEY ("guestUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayPresenceLease" ADD CONSTRAINT "PlayPresenceLease_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_provisionedUserId_fkey" FOREIGN KEY ("provisionedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayRound" ADD CONSTRAINT "PlayRound_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayActionReceipt" ADD CONSTRAINT "PlayActionReceipt_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayActionReceipt" ADD CONSTRAINT "PlayActionReceipt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayPhrase" ADD CONSTRAINT "PlayPhrase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayPhrase" ADD CONSTRAINT "PlayPhrase_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PlayRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayPhrase" ADD CONSTRAINT "PlayPhrase_roundId_roomId_fkey" FOREIGN KEY ("roundId", "roomId") REFERENCES "PlayRound"("id", "roomId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PlayRoom_rematchRoomId_key" ON "PlayRoom" ("rematchRoomId");
ALTER TABLE "PlayRoom" ADD CONSTRAINT "PlayRoom_rematchRoomId_fkey" FOREIGN KEY ("rematchRoomId") REFERENCES "PlayRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayRoom" ADD CONSTRAINT "PlayRoom_valid_state" CHECK (
    "status" IN ('WAITING', 'PLAYING', 'COMPLETED', 'CANCELLED', 'EXPIRED')
    AND "kind" IN ('DESCRIBE', 'MISSION', 'KNOW_ME', 'MIXED')
    AND "theme" IN ('EVERYDAY', 'FOOD', 'TRAVEL', 'SILLY', 'GET_TO_KNOW_YOU', 'AFFECTIONATE')
    AND "questionStyle" IN ('CHOICES', 'OPEN')
    AND "revision" >= 0 AND "currentRound" BETWEEN 0 AND 5
    AND "invitationGeneration" >= 0 AND "expiresAt" > "createdAt"
    AND ("guestUserId" IS NULL OR "guestUserId" <> "hostUserId")
    AND ("rematchRoomId" IS NULL OR "rematchRoomId" <> "id")
    AND (("guestUserId" IS NULL) = ("guestSettings" IS NULL))
    AND ("status" NOT IN ('PLAYING', 'COMPLETED') OR "guestUserId" IS NOT NULL)
    AND jsonb_typeof("hostSettings") = 'object'
    AND ("guestSettings" IS NULL OR jsonb_typeof("guestSettings") = 'object')
    AND ("invitationHash" IS NULL OR "invitationHash" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "PlayPresenceLease" ADD CONSTRAINT "PlayPresenceLease_valid_state" CHECK (
    "credentialKind" IN ('session', 'device')
    AND "viewHash" ~ '^[a-f0-9]{64}$'
    AND "accessFingerprint" ~ '^[a-f0-9]{64}$'
    AND "expiresAt" > "renewedAt" AND "expiresAt" <= "credentialExpiresAt"
);

ALTER TABLE "PlayJoinRequest" ADD CONSTRAINT "PlayJoinRequest_valid_state" CHECK (
    "generation" > 0 AND "enrollmentGeneration" > 0
    AND "status" IN ('WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED', 'CLAIMED', 'DECLINED', 'EXPIRED', 'REVOKED')
    AND "client" IN ('BROWSER', 'NATIVE')
    AND length("deviceName") BETWEEN 1 AND 80
    AND "proofHash" ~ '^[a-f0-9]{64}$' AND "fingerprint" ~ '^[a-f0-9]{64}$'
    AND "expiresAt" > "createdAt" AND jsonb_typeof("settings") = 'object'
    AND (
        ("candidateKind" = 'EXISTING' AND "candidateUserId" IS NOT NULL
            AND "proposedName" IS NULL AND "plannedProfileId" IS NULL
            AND "provisionedUserId" IS NULL AND "approvedByUserId" IS NULL
            AND "approvedAt" IS NULL AND "status" <> 'WAITING_FOR_OWNER')
        OR
        ("candidateKind" = 'NEW' AND "candidateUserId" IS NULL
            AND "proposedName" IS NOT NULL AND length("proposedName") BETWEEN 1 AND 80 AND "plannedProfileId" IS NOT NULL
            AND (num_nonnulls("provisionedUserId", "approvedByUserId", "approvedAt") = 0
                OR (num_nonnulls("provisionedUserId", "approvedByUserId", "approvedAt") = 3
                    AND "provisionedUserId" = "plannedProfileId"))
            AND ("status" NOT IN ('ACCEPTED', 'CLAIMED') OR "provisionedUserId" IS NOT NULL))
    )
    AND ("status" NOT IN ('ACCEPTED', 'CLAIMED') OR "acceptedAt" IS NOT NULL)
    AND ("deliveryState" IS NULL OR (
        "deliveryId" IS NOT NULL AND "deliveryExpiresAt" IS NOT NULL
        AND "acknowledgedAt" IS NULL AND "status" = 'CLAIMED'
        AND "candidateKind" = 'NEW' AND jsonb_typeof("deliveryState") = 'object'
    ))
);

CREATE UNIQUE INDEX "PlayJoinRequest_one_accepted_per_room"
ON "PlayJoinRequest" ("roomId") WHERE "status" IN ('ACCEPTED', 'CLAIMED');

ALTER TABLE "PlayRound" ADD CONSTRAINT "PlayRound_valid_state" CHECK (
    "order" BETWEEN 0 AND 5 AND jsonb_typeof("privateState") = 'object'
);
ALTER TABLE "PlayActionReceipt" ADD CONSTRAINT "PlayActionReceipt_valid_state" CHECK (
    "revision" >= 0 AND "fingerprint" ~ '^[a-f0-9]{64}$'
    AND length("operation") BETWEEN 1 AND 40 AND jsonb_typeof("result") = 'object'
);
ALTER TABLE "PlayPhrase" ADD CONSTRAINT "PlayPhrase_valid_state" CHECK (
    "kind" IN ('WORD', 'PHRASE', 'SENTENCE') AND length("text") BETWEEN 1 AND 500
    AND "targetLang" ~ '^[a-z]{2,3}$' AND "fingerprint" ~ '^[a-f0-9]{64}$'
    AND ("contextText" IS NULL OR length("contextText") <= 2000)
);
