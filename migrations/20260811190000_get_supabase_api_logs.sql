-- Admin-only reader for existing Supabase Auth API audit logs.
-- Applied remotely as get_supabase_api_logs.

CREATE OR REPLACE FUNCTION public.get_supabase_api_logs(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_action text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_include_session_renewals boolean DEFAULT false
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
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can view API logs';
  END IF;

  RETURN QUERY
  WITH mapped AS (
    SELECT
      e.id,
      e.created_at,
      NULLIF(e.ip_address::text, '') AS ip_address,
      COALESCE(e.payload->>'action', 'unknown') AS action,
      COALESCE(e.payload->>'log_type', 'account') AS log_type,
      NULLIF(e.payload->>'actor_id', '')::uuid AS actor_id,
      COALESCE(e.payload->>'actor_username', p.email)::text AS actor_email,
      COALESCE(p.full_name, e.payload->>'actor_username', 'Someone')::text AS actor_name,
      CASE
        WHEN COALESCE(e.payload->>'action', '') IN ('token_refreshed', 'token_revoked') THEN 'other'
        WHEN COALESCE(e.payload->>'actor_via_sso', 'false') = 'true'
          OR COALESCE(e.payload->'traits'->>'provider', e.payload->'traits'->>'provider_type', '') = 'azure'
          THEN 'website'
        WHEN COALESCE(e.payload->>'action', '') IN ('login', 'logout', 'user_signedup', 'user_repeated_signup') THEN 'website'
        ELSE 'other'
      END AS source,
      e.payload::jsonb AS details
    FROM auth.audit_log_entries e
    LEFT JOIN public.profiles p
      ON p.id = NULLIF(e.payload->>'actor_id', '')::uuid
    WHERE (p_start IS NULL OR e.created_at >= p_start)
      AND (p_end IS NULL OR e.created_at <= p_end)
      AND (p_user_id IS NULL OR NULLIF(e.payload->>'actor_id', '')::uuid = p_user_id)
      AND (p_action IS NULL OR e.payload->>'action' = p_action)
      AND (
        p_include_session_renewals
        OR COALESCE(e.payload->>'action', '') NOT IN ('token_refreshed', 'token_revoked')
      )
      AND (
        p_search IS NULL
        OR e.payload->>'actor_username' ILIKE '%' || p_search || '%'
        OR p.full_name ILIKE '%' || p_search || '%'
        OR e.payload->>'action' ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    m.id,
    m.created_at,
    m.ip_address::text,
    m.action::text,
    m.log_type::text,
    m.actor_id,
    m.actor_email::text,
    m.actor_name::text,
    m.source::text,
    (
      CASE m.action
        WHEN 'login' THEN m.actor_name || ' signed in'
        WHEN 'logout' THEN m.actor_name || ' signed out'
        WHEN 'user_signedup' THEN m.actor_name || ' created an account'
        WHEN 'user_repeated_signup' THEN m.actor_name || ' tried to create an account that already exists'
        WHEN 'user_deleted' THEN m.actor_name || ' was removed'
        WHEN 'user_modified' THEN m.actor_name || '''s account was updated'
        WHEN 'user_updated_password' THEN m.actor_name || ' changed their password'
        WHEN 'user_recovery_requested' THEN m.actor_name || ' asked to reset their password'
        WHEN 'user_invited' THEN m.actor_name || ' was invited'
        WHEN 'token_refreshed' THEN m.actor_name || '''s session was renewed automatically'
        WHEN 'token_revoked' THEN m.actor_name || '''s previous session was replaced'
        ELSE m.actor_name || ' — ' || replace(m.action, '_', ' ')
      END
    )::text AS message,
    m.details::jsonb,
    COUNT(*) OVER()::bigint AS total_count
  FROM mapped m
  WHERE (p_source IS NULL OR p_source = 'all' OR m.source = p_source)
  ORDER BY m.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supabase_api_logs(
  integer, integer, text, text, uuid, text, timestamptz, timestamptz, boolean
) TO authenticated;
