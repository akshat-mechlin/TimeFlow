-- Include DevTools access attempts (user_logs.log_type = 'devtools_attempt') in Activity Logs.

CREATE INDEX IF NOT EXISTS user_logs_devtools_created_at_idx
  ON public.user_logs (created_at DESC)
  WHERE log_type = 'devtools_attempt';

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
SET search_path TO 'public'
SET statement_timeout TO '8s'
AS $$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 50), 1);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_branch_limit integer;
  v_action text := NULLIF(p_action, 'all');
  v_source text := NULLIF(p_source, 'all');
  v_search text := NULLIF(BTRIM(COALESCE(p_search, '')), '');
  v_want_te_create boolean;
  v_want_te_update boolean;
  v_want_te_delete boolean;
  v_want_ss boolean;
  v_want_cam boolean;
  v_want_ss_delete boolean;
  v_want_cam_delete boolean;
  v_want_devtools boolean;
  v_total bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can view API logs';
  END IF;

  v_branch_limit := v_limit + v_offset;
  v_want_te_create := v_action IS NULL OR v_action IN ('time_entry', 'time_entry_created');
  v_want_te_update := v_action IS NULL OR v_action IN ('time_entry', 'time_entry_updated');
  v_want_te_delete := v_action IS NULL OR v_action IN ('time_entry', 'time_entry_deleted');
  v_want_ss := (v_action IS NULL OR v_action IN ('screenshot', 'screenshot_created')) AND (v_source IS NULL OR v_source = 'desktop');
  v_want_cam := (v_action IS NULL OR v_action IN ('camera', 'camera_created')) AND (v_source IS NULL OR v_source = 'desktop');
  v_want_ss_delete := v_action IS NULL OR v_action IN ('screenshot', 'screenshot_deleted');
  v_want_cam_delete := v_action IS NULL OR v_action IN ('camera', 'camera_deleted');
  v_want_devtools := v_action IS NULL OR v_action IN ('security', 'devtools_attempt');

  IF v_want_te_create THEN
    SELECT v_total + COUNT(*) INTO v_total FROM public.time_entries te
    WHERE (p_start IS NULL OR te.created_at >= p_start OR te.start_time >= p_start)
      AND (p_end IS NULL OR COALESCE(te.created_at, te.start_time) <= p_end)
      AND (p_user_id IS NULL OR te.user_id = p_user_id)
      AND (v_source IS NULL OR (v_source = 'website' AND COALESCE(te.is_manual_entry, false)) OR (v_source = 'desktop' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NOT NULL) OR (v_source = 'other' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NULL))
      AND (v_search IS NULL OR te.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
      AND NOT EXISTS (SELECT 1 FROM public.resource_audit_logs a WHERE a.resource = 'time_entry' AND a.record_id = te.id AND a.operation = 'INSERT');
  END IF;

  IF v_want_te_update THEN
    SELECT v_total + COUNT(*) INTO v_total FROM public.time_entries te
    WHERE te.updated_at IS NOT NULL AND te.created_at IS NOT NULL AND te.updated_at > te.created_at + interval '30 seconds'
      AND (p_start IS NULL OR te.updated_at >= p_start) AND (p_end IS NULL OR te.updated_at <= p_end)
      AND (p_user_id IS NULL OR te.user_id = p_user_id)
      AND (v_source IS NULL OR (v_source = 'website' AND COALESCE(te.is_manual_entry, false)) OR (v_source = 'desktop' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NOT NULL) OR (v_source = 'other' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NULL))
      AND (v_search IS NULL OR te.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
      AND NOT EXISTS (SELECT 1 FROM public.resource_audit_logs a WHERE a.resource = 'time_entry' AND a.record_id = te.id AND a.operation = 'UPDATE');
  END IF;

  IF v_want_ss THEN
    SELECT v_total + COUNT(*) INTO v_total FROM public.screenshots s
    WHERE s.taken_at IS NOT NULL AND (p_start IS NULL OR s.taken_at >= p_start) AND (p_end IS NULL OR s.taken_at <= p_end)
      AND (p_user_id IS NULL OR s.user_id = p_user_id) AND s.type NOT IN ('camera', 'webcam')
      AND (v_search IS NULL OR s.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'));
  END IF;

  IF v_want_cam THEN
    SELECT v_total + COUNT(*) INTO v_total FROM public.screenshots s
    WHERE s.taken_at IS NOT NULL AND (p_start IS NULL OR s.taken_at >= p_start) AND (p_end IS NULL OR s.taken_at <= p_end)
      AND (p_user_id IS NULL OR s.user_id = p_user_id) AND s.type IN ('camera', 'webcam')
      AND (v_search IS NULL OR s.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'));
  END IF;

  IF v_want_te_create OR v_want_te_update OR v_want_te_delete OR v_want_ss_delete OR v_want_cam_delete THEN
    SELECT v_total + COUNT(*) INTO v_total FROM public.resource_audit_logs a
    WHERE (p_start IS NULL OR a.created_at >= p_start) AND (p_end IS NULL OR a.created_at <= p_end)
      AND (p_user_id IS NULL OR a.owner_id = p_user_id OR a.actor_id = p_user_id)
      AND (v_source IS NULL OR a.source = v_source)
      AND (
        (v_want_te_create AND a.resource = 'time_entry' AND a.operation = 'INSERT')
        OR (v_want_te_update AND a.resource = 'time_entry' AND a.operation = 'UPDATE')
        OR (v_want_te_delete AND a.resource = 'time_entry' AND a.operation = 'DELETE')
        OR (v_want_ss_delete AND a.resource = 'screenshot' AND a.operation = 'DELETE')
        OR (v_want_cam_delete AND a.resource = 'camera' AND a.operation = 'DELETE')
      )
      AND (v_search IS NULL OR COALESCE(a.owner_id, a.actor_id) IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'));
  END IF;

  IF v_want_devtools THEN
    SELECT v_total + COUNT(*) INTO v_total
    FROM public.user_logs ul
    WHERE ul.log_type = 'devtools_attempt'
      AND (p_start IS NULL OR ul.created_at >= p_start)
      AND (p_end IS NULL OR ul.created_at <= p_end)
      AND (p_user_id IS NULL OR ul.user_id = p_user_id)
      AND (
        v_source IS NULL
        OR COALESCE(ul.metadata->>'source', 'other') = v_source
      )
      AND (
        v_search IS NULL
        OR ul.user_id IN (
          SELECT pr.id FROM public.profiles pr
          WHERE pr.full_name ILIKE '%' || v_search || '%'
             OR pr.email ILIKE '%' || v_search || '%'
        )
        OR ul.log_message ILIKE '%' || v_search || '%'
      );
  END IF;

  RETURN QUERY
  WITH events AS (
    (
      SELECT te.id AS event_id, COALESCE(te.created_at, te.start_time) AS event_at,
        'time_entry_created'::text AS action, 'time_entry'::text AS log_type, te.user_id AS actor_id,
        CASE WHEN COALESCE(te.is_manual_entry, false) THEN 'website' WHEN te.app_version IS NOT NULL THEN 'desktop' ELSE 'other' END AS source,
        jsonb_build_object('record_id', te.id, 'start_time', te.start_time, 'end_time', te.end_time, 'duration', te.duration, 'description', te.description, 'is_manual_entry', te.is_manual_entry, 'app_version', te.app_version, 'operation', 'INSERT') AS details
      FROM public.time_entries te
      WHERE v_want_te_create
        AND (p_start IS NULL OR te.created_at >= p_start OR te.start_time >= p_start)
        AND (p_end IS NULL OR COALESCE(te.created_at, te.start_time) <= p_end)
        AND (p_user_id IS NULL OR te.user_id = p_user_id)
        AND (v_source IS NULL OR (v_source = 'website' AND COALESCE(te.is_manual_entry, false)) OR (v_source = 'desktop' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NOT NULL) OR (v_source = 'other' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NULL))
        AND (v_search IS NULL OR te.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
        AND NOT EXISTS (SELECT 1 FROM public.resource_audit_logs a WHERE a.resource = 'time_entry' AND a.record_id = te.id AND a.operation = 'INSERT')
      ORDER BY COALESCE(te.created_at, te.start_time) DESC
      LIMIT v_branch_limit
    )
    UNION ALL
    (
      SELECT md5(te.id::text || ':update')::uuid, te.updated_at, 'time_entry_updated'::text, 'time_entry'::text, te.user_id,
        CASE WHEN COALESCE(te.is_manual_entry, false) THEN 'website' WHEN te.app_version IS NOT NULL THEN 'desktop' ELSE 'other' END,
        jsonb_build_object('record_id', te.id, 'start_time', te.start_time, 'end_time', te.end_time, 'duration', te.duration, 'description', te.description, 'is_manual_entry', te.is_manual_entry, 'app_version', te.app_version, 'operation', 'UPDATE')
      FROM public.time_entries te
      WHERE v_want_te_update AND te.updated_at IS NOT NULL AND te.created_at IS NOT NULL AND te.updated_at > te.created_at + interval '30 seconds'
        AND (p_start IS NULL OR te.updated_at >= p_start) AND (p_end IS NULL OR te.updated_at <= p_end)
        AND (p_user_id IS NULL OR te.user_id = p_user_id)
        AND (v_source IS NULL OR (v_source = 'website' AND COALESCE(te.is_manual_entry, false)) OR (v_source = 'desktop' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NOT NULL) OR (v_source = 'other' AND NOT COALESCE(te.is_manual_entry, false) AND te.app_version IS NULL))
        AND (v_search IS NULL OR te.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
        AND NOT EXISTS (SELECT 1 FROM public.resource_audit_logs a WHERE a.resource = 'time_entry' AND a.record_id = te.id AND a.operation = 'UPDATE')
      ORDER BY te.updated_at DESC
      LIMIT v_branch_limit
    )
    UNION ALL
    (
      SELECT s.id, s.taken_at,
        CASE WHEN s.type IN ('camera', 'webcam') THEN 'camera_created' ELSE 'screenshot_created' END,
        CASE WHEN s.type IN ('camera', 'webcam') THEN 'camera' ELSE 'screenshot' END,
        s.user_id, 'desktop'::text,
        jsonb_build_object('record_id', s.id, 'time_entry_id', s.time_entry_id, 'storage_path', s.storage_path, 'type', s.type, 'taken_at', s.taken_at, 'operation', 'INSERT')
      FROM public.screenshots s
      WHERE (v_want_ss OR v_want_cam) AND s.taken_at IS NOT NULL
        AND (p_start IS NULL OR s.taken_at >= p_start) AND (p_end IS NULL OR s.taken_at <= p_end)
        AND (p_user_id IS NULL OR s.user_id = p_user_id)
        AND ((v_want_ss AND v_want_cam) OR (v_want_ss AND s.type NOT IN ('camera', 'webcam')) OR (v_want_cam AND s.type IN ('camera', 'webcam')))
        AND (v_search IS NULL OR s.user_id IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
      ORDER BY s.taken_at DESC
      LIMIT v_branch_limit
    )
    UNION ALL
    (
      SELECT a.id, a.created_at,
        CASE a.operation
          WHEN 'INSERT' THEN a.resource || '_created'
          WHEN 'UPDATE' THEN a.resource || '_updated'
          ELSE a.resource || '_deleted'
        END,
        a.resource, COALESCE(a.owner_id, a.actor_id), a.source,
        COALESCE(a.details, '{}'::jsonb) || jsonb_build_object('operation', a.operation, 'actor_id', a.actor_id)
      FROM public.resource_audit_logs a
      WHERE (p_start IS NULL OR a.created_at >= p_start) AND (p_end IS NULL OR a.created_at <= p_end)
        AND (p_user_id IS NULL OR a.owner_id = p_user_id OR a.actor_id = p_user_id)
        AND (v_source IS NULL OR a.source = v_source)
        AND (
          (v_want_te_create AND a.resource = 'time_entry' AND a.operation = 'INSERT')
          OR (v_want_te_update AND a.resource = 'time_entry' AND a.operation = 'UPDATE')
          OR (v_want_te_delete AND a.resource = 'time_entry' AND a.operation = 'DELETE')
          OR (v_want_ss_delete AND a.resource = 'screenshot' AND a.operation = 'DELETE')
          OR (v_want_cam_delete AND a.resource = 'camera' AND a.operation = 'DELETE')
        )
        AND (v_search IS NULL OR COALESCE(a.owner_id, a.actor_id) IN (SELECT pr.id FROM public.profiles pr WHERE pr.full_name ILIKE '%' || v_search || '%' OR pr.email ILIKE '%' || v_search || '%'))
      ORDER BY a.created_at DESC
      LIMIT v_branch_limit
    )
    UNION ALL
    (
      SELECT
        ul.id AS event_id,
        ul.created_at AS event_at,
        'devtools_attempt'::text AS action,
        'devtools_attempt'::text AS log_type,
        ul.user_id AS actor_id,
        COALESCE(ul.metadata->>'source', 'other')::text AS source,
        (
          COALESCE(ul.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'operation', 'SECURITY',
            'log_message', ul.log_message,
            'device_info', ul.device_info,
            'user_agent', ul.user_agent,
            'ip_address', ul.ip_address
          )
        ) AS details
      FROM public.user_logs ul
      WHERE v_want_devtools
        AND ul.log_type = 'devtools_attempt'
        AND (p_start IS NULL OR ul.created_at >= p_start)
        AND (p_end IS NULL OR ul.created_at <= p_end)
        AND (p_user_id IS NULL OR ul.user_id = p_user_id)
        AND (
          v_source IS NULL
          OR COALESCE(ul.metadata->>'source', 'other') = v_source
        )
        AND (
          v_search IS NULL
          OR ul.user_id IN (
            SELECT pr.id FROM public.profiles pr
            WHERE pr.full_name ILIKE '%' || v_search || '%'
               OR pr.email ILIKE '%' || v_search || '%'
          )
          OR ul.log_message ILIKE '%' || v_search || '%'
        )
      ORDER BY ul.created_at DESC
      LIMIT v_branch_limit
    )
  )
  SELECT e.event_id, e.event_at, NULL::text, e.action::text, e.log_type::text, e.actor_id, p.email::text,
    COALESCE(p.full_name, p.email, 'Someone')::text, e.source::text,
    (CASE e.action
      WHEN 'time_entry_created' THEN COALESCE(p.full_name, 'Someone') || CASE WHEN COALESCE((e.details->>'is_manual_entry')::boolean, false) THEN ' added a manual time entry' ELSE ' started a time entry' END || CASE WHEN COALESCE((e.details->>'duration')::integer, 0) > 0 THEN ' (' || public.format_seconds_for_log((e.details->>'duration')::integer) || ')' ELSE '' END
      WHEN 'time_entry_updated' THEN COALESCE(p.full_name, 'Someone') || ' sent a time entry update' || CASE WHEN NULLIF(e.details->>'duration', '') IS NOT NULL THEN ' (' || public.format_seconds_for_log((e.details->>'duration')::integer) || ')' ELSE '' END
      WHEN 'time_entry_deleted' THEN COALESCE(p.full_name, 'Someone') || ' deleted a time entry'
      WHEN 'screenshot_created' THEN COALESCE(p.full_name, 'Someone') || ' saved a screenshot'
      WHEN 'screenshot_updated' THEN COALESCE(p.full_name, 'Someone') || ' updated a screenshot'
      WHEN 'screenshot_deleted' THEN COALESCE(p.full_name, 'Someone') || ' deleted a screenshot'
      WHEN 'camera_created' THEN COALESCE(p.full_name, 'Someone') || ' saved a camera photo'
      WHEN 'camera_updated' THEN COALESCE(p.full_name, 'Someone') || ' updated a camera photo'
      WHEN 'camera_deleted' THEN COALESCE(p.full_name, 'Someone') || ' deleted a camera photo'
      WHEN 'devtools_attempt' THEN COALESCE(
        NULLIF(e.details->>'log_message', ''),
        COALESCE(p.full_name, 'Someone') || ' attempted to open developer tools. Action captured.'
      )
      ELSE COALESCE(p.full_name, 'Someone') || ' - ' || replace(e.action, '_', ' ')
    END)::text,
    e.details, v_total
  FROM events e
  LEFT JOIN public.profiles p ON p.id = e.actor_id
  ORDER BY e.event_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tracker_crud_logs(integer, integer, text, text, uuid, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracker_crud_logs(integer, integer, text, text, uuid, text, timestamptz, timestamptz) TO authenticated;
