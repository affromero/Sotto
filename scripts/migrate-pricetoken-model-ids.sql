-- Migrate image + video model IDs from legacy Sotto IDs to PriceToken canonical IDs.
-- Run once after deploy. Safe to re-run (WHERE clauses are idempotent).

-- AutoModelConfig: image model defaults
UPDATE "AutoModelConfig"
SET "freeImageModel" = 'fal-flux-1-schnell'
WHERE "freeImageModel" = 'flux-schnell';

UPDATE "AutoModelConfig"
SET "proImageModel" = 'fal-flux-1-schnell'
WHERE "proImageModel" = 'flux-schnell';

UPDATE "AutoModelConfig"
SET "freeImageModel" = 'fal-flux-1-pro'
WHERE "freeImageModel" = 'flux-1.1-pro';

UPDATE "AutoModelConfig"
SET "proImageModel" = 'fal-flux-1-pro'
WHERE "proImageModel" = 'flux-1.1-pro';

UPDATE "AutoModelConfig"
SET "freeImageModel" = 'fal-flux-2-pro'
WHERE "freeImageModel" = 'flux-2-pro';

UPDATE "AutoModelConfig"
SET "proImageModel" = 'fal-flux-2-pro'
WHERE "proImageModel" = 'flux-2-pro';

-- AutoModelConfig: video model defaults (minimax)
UPDATE "AutoModelConfig"
SET "freeVideoModel" = 'minimax-hailuo02-768p'
WHERE "freeVideoModel" IN ('minimax-t2v-01', 'minimax-hailuo-02');

UPDATE "AutoModelConfig"
SET "proVideoModel" = 'minimax-hailuo02-768p'
WHERE "proVideoModel" IN ('minimax-t2v-01', 'minimax-hailuo-02');

UPDATE "AutoModelConfig"
SET "freeVideoModel" = 'minimax-hailuo23-fast-1080p'
WHERE "freeVideoModel" = 'minimax-hailuo-2.3';

UPDATE "AutoModelConfig"
SET "proVideoModel" = 'minimax-hailuo23-fast-1080p'
WHERE "proVideoModel" = 'minimax-hailuo-2.3';

-- VideoGeneration: image model references
UPDATE "VideoGeneration"
SET "imageModel" = 'fal-flux-1-schnell'
WHERE "imageModel" = 'flux-schnell';

UPDATE "VideoGeneration"
SET "imageModel" = 'fal-flux-1-pro'
WHERE "imageModel" = 'flux-1.1-pro';

UPDATE "VideoGeneration"
SET "imageModel" = 'fal-flux-2-pro'
WHERE "imageModel" = 'flux-2-pro';
