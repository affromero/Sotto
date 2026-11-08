-- Serialize attachment with cancellation of an unqueued listening episode.
-- The tuple touch makes an older Serializable snapshot retry after an
-- attachment commits, even though the association lives on the child table.
BEGIN;
LOCK TABLE "CourseClass", "ClassSection", "PracticeSession", "ExamSection", "Episode" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION "fenceListeningAttachment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_status "EpisodeStatus"; episode_deleted TIMESTAMP(3);
BEGIN
  IF NEW."episodeId" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."episodeId" IS NOT DISTINCT FROM NEW."episodeId" THEN
    RETURN NEW;
  END IF;
  SELECT status, "deletedAt" INTO episode_status, episode_deleted
    FROM "Episode" WHERE id = NEW."episodeId" FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF episode_status NOT IN ('PENDING', 'SCRIPT_READY', 'GENERATING_AUDIO', 'STITCHING', 'READY')
    OR episode_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot attach an unavailable listening episode';
  END IF;
  UPDATE "Episode" SET "updatedAt" = "updatedAt" WHERE id = NEW."episodeId";
  RETURN NEW;
END $$;

CREATE TRIGGER "ClassSection_listening_attachment_fence"
  BEFORE INSERT OR UPDATE OF "episodeId" ON "ClassSection"
  FOR EACH ROW EXECUTE FUNCTION "fenceListeningAttachment"();
CREATE TRIGGER "PracticeSession_listening_attachment_fence"
  BEFORE INSERT OR UPDATE OF "episodeId" ON "PracticeSession"
  FOR EACH ROW EXECUTE FUNCTION "fenceListeningAttachment"();
CREATE TRIGGER "ExamSection_listening_attachment_fence"
  BEFORE INSERT OR UPDATE OF "episodeId" ON "ExamSection"
  FOR EACH ROW EXECUTE FUNCTION "fenceListeningAttachment"();
ALTER TABLE "ClassSection" ENABLE ALWAYS TRIGGER "ClassSection_listening_attachment_fence";
ALTER TABLE "PracticeSession" ENABLE ALWAYS TRIGGER "PracticeSession_listening_attachment_fence";
ALTER TABLE "ExamSection" ENABLE ALWAYS TRIGGER "ExamSection_listening_attachment_fence";
COMMIT;
