-- CRUD logs for time entries, screenshots, and camera shots.
-- Creates/updates are read from the live tables. Deletes are captured by triggers.

CREATE TABLE IF NOT EXISTS public.resource_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  resource text NOT NULL,
  operation text NOT NULL,
  record_id uuid,
  owner_id uuid,
  actor_id uuid,
  source text NOT NULL DEFAULT 'other',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_resource_audit_logs_created_at
  ON public.resource_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_audit_logs_owner_created_at
  ON public.resource_audit_logs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_audit_logs_resource_op
  ON public.resource_audit_logs (resource, operation, created_at DESC);

ALTER TABLE public.resource_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view resource audit logs" ON public.resource_audit_logs;
CREATE POLICY "Admins can view resource audit logs"
  ON public.resource_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

REVOKE ALL ON public.resource_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.resource_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.format_seconds_for_log(p_seconds integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_seconds, 0) < 60 THEN 'less than a minute'
    WHEN p_seconds < 3600 THEN
      (p_seconds / 60)::text || ' minute' || CASE WHEN p_seconds / 60 = 1 THEN '' ELSE 's' END
    WHEN (p_seconds % 3600) < 60 THEN
      (p_seconds / 3600)::text || ' hour' || CASE WHEN p_seconds / 3600 = 1 THEN '' ELSE 's' END
    ELSE
      (p_seconds / 3600)::text || ' hour' || CASE WHEN p_seconds / 3600 = 1 THEN ' ' ELSE 's ' END
      || ((p_seconds % 3600) / 60)::text || ' minute' || CASE WHEN ((p_seconds % 3600) / 60) = 1 THEN '' ELSE 's' END
  END
$$;

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
    IF TG_OP = 'UPDATE'
      AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
      AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
      AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.is_manual_entry IS NOT DISTINCT FROM OLD.is_manual_entry
      AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    THEN
      RETURN NEW;
    END IF;

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
  ELSE
    IF TG_OP = 'UPDATE'
      AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path
      AND NEW.type IS NOT DISTINCT FROM OLD.type
      AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    THEN
      RETURN NEW;
    END IF;

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
    v_resource,
    TG_OP,
    v_row.id,
    v_owner,
    auth.uid(),
    v_source,
    v_details
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entries_resource_audit ON public.time_entries;
CREATE TRIGGER trg_time_entries_resource_audit
  AFTER DELETE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tracker_resource_audit();

DROP TRIGGER IF EXISTS trg_screenshots_resource_audit ON public.screenshots;
CREATE TRIGGER trg_screenshots_resource_audit
  AFTER DELETE ON public.screenshots
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tracker_resource_audit();

CREATE OR REPLACE FUNCTION public.get_tracker_crud_logs(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_action text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  ip_address text,
  action text,
  log_type text,
  actor_id uuid,
  actor_email text,
  actor_name text,
  source text,
  message text,
  details jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can view API logs';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT
      te.id AS event_id,
      COALESCE(te.created_at, te.start_time) AS event_at,
      'time_entry_created'::text AS action,
      'time_entry'::text AS log_type,
      te.user_id AS actor_id,
      CASE
        WHEN COALESCE(te.is_manual_entry, false) THEN 'website'
        WHEN te.app_version IS NOT NULL THEN 'desktop'
        ELSE 'other'
      END AS source,
      jsonb_build_object(
        'record_id', te.id,
        'start_time', te.start_time,
        'end_time', te.end_time,
        'duration', te.duration,
        'description', te.description,
        'is_manual_entry', te.is_manual_entry,
        'app_version', te.app_version,
        'operation', 'INSERT'
      ) AS details
    FROM public.time_entries te
    WHERE (p_start IS NULL OR COALESCE(te.created_at, te.start_time) >= p_start)
      AND (p_end IS NULL OR COALESCE(te.created_at, te.start_time) <= p_end)
      AND (p_user_id IS NULL OR te.user_id = p_user_id)

    UNION ALL

    SELECT
      md5(te.id::text || ':update')::uuid AS event_id,
      te.updated_at AS event_at,
      'time_entry_updated'::text AS action,
      'time_entry'::text AS log_type,
      te.user_id AS actor_id,
      CASE
        WHEN COALESCE(te.is_manual_entry, false) THEN 'website'
        WHEN te.app_version IS NOT NULL THEN 'desktop'
        ELSE 'other'
      END AS source,
      jsonb_build_object(
        'record_id', te.id,
        'start_time', te.start_time,
        'end_time', te.end_time,
        'duration', te.duration,
        'description', te.description,
        'is_manual_entry', te.is_manual_entry,
        'app_version', te.app_version,
        'operation', 'UPDATE'
      ) AS details
    FROM public.time_entries te
    WHERE te.updated_at IS NOT NULL
      AND te.created_at IS NOT NULL
      AND te.updated_at > te.created_at + interval '30 seconds'
      AND (p_start IS NULL OR te.updated_at >= p_start)
      AND (p_end IS NULL OR te.updated_at <= p_end)
      AND (p_user_id IS NULL OR te.user_id = p_user_id)

    UNION ALL

    SELECT
      s.id AS event_id,
      COALESCE(s.taken_at, s.created_at) AS event_at,
      CASE
        WHEN s.type IN ('camera', 'webcam') THEN 'camera_created'
        ELSE 'screenshot_created'
      END AS action,
      CASE
        WHEN s.type IN ('camera', 'webcam') THEN 'camera'
        ELSE 'screenshot'
      END AS log_type,
      s.user_id AS actor_id,
      'desktop'::text AS source,
      jsonb_build_object(
        'record_id', s.id,
        'time_entry_id', s.time_entry_id,
        'storage_path', s.storage_path,
        'type', s.type,
        'taken_at', s.taken_at,
        'operation', 'INSERT'
      ) AS details
    FROM public.screenshots s
    WHERE (p_start IS NULL OR COALESCE(s.taken_at, s.created_at) >= p_start)
      AND (p_end IS NULL OR COALESCE(s.taken_at, s.created_at) <= p_end)
      AND (p_user_id IS NULL OR s.user_id = p_user_id)

    UNION ALL

    SELECT
      a.id AS event_id,
      a.created_at AS event_at,
      (a.resource || '_' || lower(a.operation))::text AS action,
      a.resource AS log_type,
      COALESCE(a.owner_id, a.actor_id) AS actor_id,
      a.source,
      COALESCE(a.details, '{}'::jsonb) || jsonb_build_object(
        'operation', a.operation,
        'actor_id', a.actor_id
      ) AS details
    FROM public.resource_audit_logs a
    WHERE a.operation = 'DELETE'
      AND (p_start IS NULL OR a.created_at >= p_start)
      AND (p_end IS NULL OR a.created_at <= p_end)
      AND (p_user_id IS NULL OR a.owner_id = p_user_id OR a.actor_id = p_user_id)
  )
  SELECT
    e.event_id,
    e.event_at,
    NULL::text AS ip_address,
    e.action::text,
    e.log_type::text,
    e.actor_id,
    p.email::text AS actor_email,
    COALESCE(p.full_name, p.email, 'Someone')::text AS actor_name,
    e.source::text,
    (
      CASE e.action
        WHEN 'time_entry_created' THEN
          COALESCE(p.full_name, 'Someone')
          || CASE WHEN COALESCE((e.details->>'is_manual_entry')::boolean, false)
               THEN ' added a manual time entry'
               ELSE ' started a time entry'
             END
          || CASE WHEN COALESCE((e.details->>'duration')::integer, 0) > 0
               THEN ' (' || public.format_seconds_for_log((e.details->>'duration')::integer) || ')'
               ELSE ''
             END
        WHEN 'time_entry_updated' THEN
          COALESCE(p.full_name, 'Someone') || ' updated a time entry'
          || CASE WHEN NULLIF(e.details->>'duration', '') IS NOT NULL
               THEN ' to ' || public.format_seconds_for_log((e.details->>'duration')::integer)
               ELSE ''
             END
        WHEN 'time_entry_deleted' THEN
          COALESCE(p.full_name, 'Someone') || ' deleted a time entry'
        WHEN 'screenshot_created' THEN
          COALESCE(p.full_name, 'Someone') || ' saved a screenshot'
        WHEN 'screenshot_updated' THEN
          COALESCE(p.full_name, 'Someone') || ' updated a screenshot'
        WHEN 'screenshot_deleted' THEN
          COALESCE(p.full_name, 'Someone') || ' deleted a screenshot'
        WHEN 'camera_created' THEN
          COALESCE(p.full_name, 'Someone') || ' saved a camera photo'
        WHEN 'camera_updated' THEN
          COALESCE(p.full_name, 'Someone') || ' updated a camera photo'
        WHEN 'camera_deleted' THEN
          COALESCE(p.full_name, 'Someone') || ' deleted a camera photo'
        ELSE
          COALESCE(p.full_name, 'Someone') || ' - ' || replace(e.action, '_', ' ')
      END
    )::text AS message,
    e.details,
    COUNT(*) OVER()::bigint AS total_count
  FROM events e
  LEFT JOIN public.profiles p ON p.id = e.actor_id
  WHERE (
      p_action IS NULL
      OR p_action = 'all'
      OR e.action = p_action
      OR (p_action = 'time_entry' AND e.action LIKE 'time_entry_%')
      OR (p_action = 'screenshot' AND e.action LIKE 'screenshot_%')
      OR (p_action = 'camera' AND e.action LIKE 'camera_%')
    )
    AND (p_source IS NULL OR p_source = 'all' OR e.source = p_source)
    AND (
      p_search IS NULL
      OR p.full_name ILIKE '%' || p_search || '%'
      OR p.email ILIKE '%' || p_search || '%'
      OR e.action ILIKE '%' || p_search || '%'
    )
  ORDER BY e.event_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tracker_crud_logs(
  integer, integer, text, text, uuid, text, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.format_seconds_for_log(integer) TO authenticated;
