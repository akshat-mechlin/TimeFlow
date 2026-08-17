-- Log every time_entries INSERT/UPDATE sent to Supabase.
-- Historical rows still appear once from the live table until they have audit events.

CREATE INDEX IF NOT EXISTS idx_resource_audit_logs_record_op
  ON public.resource_audit_logs (resource, record_id, operation);

CREATE OR REPLACE FUNCTION public.log_tracker_resource_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_resource text;
  v_owner uuid;
  v_source text;
  v_details jsonb;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_TABLE_NAME = 'time_entries' THEN
    v_resource := 'time_entry';
    v_owner := v_row.user_id;
    v_source := CASE
      WHEN COALESCE(v_row.is_manual_entry, false) THEN 'website'
      WHEN v_row.app_version IS NOT NULL THEN 'desktop'
      ELSE 'other'
    END;
    v_details := jsonb_build_object(
      'record_id', v_row.id,
      'start_time', v_row.start_time,
      'end_time', v_row.end_time,
      'duration', v_row.duration,
      'description', v_row.description,
      'is_manual_entry', v_row.is_manual_entry,
      'app_version', v_row.app_version
    );
    IF TG_OP = 'UPDATE' THEN
      v_details := v_details || jsonb_build_object(
        'previous_duration', OLD.duration,
        'previous_end_time', OLD.end_time,
        'previous_start_time', OLD.start_time
      );
    END IF;
  ELSE
    v_resource := CASE
      WHEN v_row.type IN ('camera', 'webcam') THEN 'camera'
      ELSE 'screenshot'
    END;
    v_owner := v_row.user_id;
    v_source := 'desktop';
    v_details := jsonb_build_object(
      'record_id', v_row.id,
      'time_entry_id', v_row.time_entry_id,
      'storage_path', v_row.storage_path,
      'type', v_row.type,
      'taken_at', v_row.taken_at
    );
  END IF;

  INSERT INTO public.resource_audit_logs (
    resource, operation, record_id, owner_id, actor_id, source, details
  ) VALUES (
    v_resource, TG_OP, v_row.id, v_owner, auth.uid(), v_source, v_details
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entries_resource_audit ON public.time_entries;
CREATE TRIGGER trg_time_entries_resource_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tracker_resource_audit();
