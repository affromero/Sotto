-- Add User.timezone (IANA name) for local-day activity bucketing.
-- Null = never chosen; readers fall back to the server's own timezone.
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
