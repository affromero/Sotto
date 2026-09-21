ALTER TABLE "ApiUsageLog" ALTER COLUMN "totalCost" DROP NOT NULL;

-- Earlier CLI loggers assigned zero without measuring subscription cost.
-- Treat those historical zeros conservatively as unknown; retain nonzero costs.
UPDATE "ApiUsageLog" SET "totalCost" = NULL
WHERE "totalCost" = 0 AND "service" IN ('claude-code', 'codex');
