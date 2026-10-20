ALTER TABLE "PlayPresenceLease" ADD COLUMN "releasedAt" TIMESTAMP(3);
CREATE INDEX "PlayPresenceLease_expiresAt_idx" ON "PlayPresenceLease" ("expiresAt");
CREATE INDEX "PlayJoinRequest_status_expiresAt_idx" ON "PlayJoinRequest" ("status", "expiresAt");
CREATE INDEX "PlayJoinRequest_deliveryExpiresAt_idx" ON "PlayJoinRequest" ("deliveryExpiresAt");
ALTER TABLE "PlayPresenceLease" DROP CONSTRAINT "PlayPresenceLease_valid_state";
ALTER TABLE "PlayPresenceLease" ADD CONSTRAINT "PlayPresenceLease_valid_state" CHECK (
    "credentialKind" IN ('session', 'device')
    AND "viewHash" ~ '^[a-f0-9]{64}$'
    AND "accessFingerprint" ~ '^[a-f0-9]{64}$'
    AND "expiresAt" <= "credentialExpiresAt"
    AND (
        ("releasedAt" IS NULL AND "expiresAt" > "renewedAt")
        OR ("releasedAt" IS NOT NULL AND "expiresAt" <= "releasedAt" AND "releasedAt" >= "renewedAt")
    )
);

ALTER TABLE "PlayJoinRequest" DROP CONSTRAINT "PlayJoinRequest_valid_state";
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
            AND "proposedName" IS NOT NULL AND length("proposedName") BETWEEN 1 AND 80
            AND (num_nonnulls("plannedProfileId", "provisionedUserId", "approvedByUserId", "approvedAt") = 0
                OR (num_nonnulls("plannedProfileId", "provisionedUserId", "approvedByUserId", "approvedAt") = 4
                    AND "provisionedUserId" = "plannedProfileId"))
            AND ("status" NOT IN ('WAITING_FOR_HOST', 'ACCEPTED', 'CLAIMED') OR "provisionedUserId" IS NOT NULL))
    )
    AND ("status" NOT IN ('ACCEPTED', 'CLAIMED') OR "acceptedAt" IS NOT NULL)
    AND ("deliveryState" IS NULL OR (
        "deliveryId" IS NOT NULL AND "deliveryExpiresAt" IS NOT NULL
        AND "acknowledgedAt" IS NULL AND "status" = 'CLAIMED'
        AND "candidateKind" = 'NEW' AND jsonb_typeof("deliveryState") = 'object'
    ))
);
