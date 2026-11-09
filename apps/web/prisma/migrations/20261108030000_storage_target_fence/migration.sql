-- Older Sidedoor writers predate target fencing. Serialize their storage
-- admissions with target retirement even during mixed-version deployments.
BEGIN;
CREATE FUNCTION "guardStorageTargetFence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  binding TEXT;
  storage_key TEXT;
  target TEXT;
  affected INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.id LIKE 'sd-tf:1:%' AND OLD.state->>'status' = 'retired' THEN
      RAISE EXCEPTION 'Storage target retirement is permanent';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.id LIKE 'sd-tf:1:%'
     AND OLD.state->>'status' = 'retired'
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.state IS DISTINCT FROM OLD.state) THEN
    RAISE EXCEPTION 'Storage target retirement is permanent';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (OLD.id LIKE 'sd-w:1:%' OR OLD.id LIKE 'sd-asset:1:%')
     AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Storage record identity cannot change';
  END IF;

  IF NEW.id LIKE 'sd-w:1:%' THEN
    IF NEW.state->>'kind' IS DISTINCT FROM 'write' THEN
      RAISE EXCEPTION 'Storage write identity is invalid';
    END IF;
    binding := NEW.state->'target'->>'binding';
    storage_key := NEW.state->'target'->>'key';
  ELSIF NEW.id LIKE 'sd-asset:1:%' THEN
    IF NEW.state->>'kind' IS DISTINCT FROM 'storage_asset'
       OR jsonb_typeof(NEW.state->'consumers') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Storage asset identity is invalid';
    END IF;
    IF jsonb_array_length(NEW.state->'consumers') = 0 THEN RETURN NEW; END IF;
    binding := NEW.state->'prepared'->'target'->>'binding';
    storage_key := NEW.state->'prepared'->'target'->>'key';
  ELSE
    RETURN NEW;
  END IF;

  IF binding IS NULL OR binding !~ '^[a-f0-9]{64}$' OR storage_key IS NULL THEN
    RAISE EXCEPTION 'Storage target identity is invalid';
  END IF;
  target := encode(sha256(convert_to(
    '[' || to_json(binding)::TEXT || ',' || to_json(storage_key)::TEXT || ']', 'UTF8'
  )), 'hex');

  INSERT INTO "SidedoorState" AS gate (id, revision, state)
  VALUES (
    'sd-tf:1:' || target,
    gen_random_uuid()::TEXT,
    jsonb_build_object('kind', 'storage_target_fence', 'target', target, 'status', 'open')
  )
  ON CONFLICT (id) DO UPDATE SET revision = gen_random_uuid()::TEXT
  WHERE gate.state->>'kind' = 'storage_target_fence'
    AND gate.state->>'target' = target AND gate.state->>'status' = 'open';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Storage target is retired'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SidedoorState_storage_target_fence"
  BEFORE INSERT OR UPDATE OR DELETE ON "SidedoorState"
  FOR EACH ROW EXECUTE FUNCTION "guardStorageTargetFence"();
COMMIT;
