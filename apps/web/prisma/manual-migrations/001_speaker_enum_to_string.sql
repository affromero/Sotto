-- Migration: Convert Segment.speaker from Speaker enum to plain TEXT
-- Context: Multi-voice support removes the binary HOST/EXPERT enum.
-- Existing values ('HOST', 'EXPERT') are preserved as text strings.
-- This must run BEFORE prisma db push, which expects the column to be TEXT.

-- Step 1: Convert the speaker column from enum to text
-- The cast is safe because enum values are valid text.
DO $$
BEGIN
  -- Only run if the column is still an enum type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'Segment'
      AND column_name = 'speaker'
      AND udt_name = 'Speaker'
  ) THEN
    ALTER TABLE "Segment" ALTER COLUMN "speaker" TYPE TEXT USING "speaker"::TEXT;
    RAISE NOTICE 'Converted Segment.speaker from enum to TEXT';
  ELSE
    RAISE NOTICE 'Segment.speaker is already TEXT — skipping';
  END IF;
END $$;

-- Step 2: Drop the Speaker enum if it exists and is no longer referenced
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Speaker') THEN
    DROP TYPE "Speaker";
    RAISE NOTICE 'Dropped Speaker enum';
  ELSE
    RAISE NOTICE 'Speaker enum does not exist — skipping';
  END IF;
END $$;
