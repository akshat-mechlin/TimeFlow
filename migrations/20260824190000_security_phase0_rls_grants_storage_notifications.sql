-- Phase 0 break-glass security hardening (applied to production 2026-08-24)
-- C-01, C-03, C-04, C-05, H-07 + profile privilege escalation guard

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read system settings" ON public.system_settings;
CREATE POLICY "Authenticated can read system settings"
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only administrators can change roles';
    END IF;
    IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
      RAISE EXCEPTION 'Only administrators can change manager assignment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.time_entries FROM anon;
REVOKE ALL ON TABLE public.project_time_entries FROM anon;
REVOKE ALL ON TABLE public.system_settings FROM anon;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;

REVOKE ALL ON FUNCTION public.backfill_screenshot_user_id_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_screenshot_user_id_batch(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_screenshot_user_id_batch(integer) TO service_role;

REVOKE ALL ON FUNCTION public.get_screenshots_for_user_day(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_screenshots_for_user_day(uuid, timestamptz, timestamptz, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_screenshots_for_user_day(uuid, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
CREATE POLICY "Users can insert own notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_notification_for_user(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notifications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.is_admin(auth.uid())
    OR public.is_manager(auth.uid())
    OR p_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not allowed to create notifications for this user';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, read)
  VALUES (p_user_id, p_title, p_message, p_type::public.notification_type, false)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification_for_user(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification_for_user(uuid, text, text, text) TO authenticated, service_role;

-- Storage policies (recreate path-scoped)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON storage.buckets;
DROP POLICY IF EXISTS "Allow Public Read for Updates 8fbnej_0" ON storage.objects;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON storage.objects;
DROP POLICY IF EXISTS "Enable users to view their own data only" ON storage.objects;
DROP POLICY IF EXISTS "Public read avatars and tracker-application" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read own screenshots objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload own objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update own objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete own objects" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage tracker-application objects" ON storage.objects;

CREATE POLICY "Public read avatars and tracker-application"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id IN ('avatars', 'tracker-application'));

CREATE POLICY "Authenticated read own screenshots objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'screenshots'
    AND (
      public.is_admin(auth.uid())
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "Authenticated upload own objects"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id IN ('avatars', 'screenshots')
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "Authenticated update own objects"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id IN ('avatars', 'screenshots')
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  )
  WITH CHECK (
    bucket_id IN ('avatars', 'screenshots')
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

CREATE POLICY "Authenticated delete own objects"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('avatars', 'screenshots')
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

CREATE POLICY "Admins manage tracker-application objects"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'tracker-application' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'tracker-application' AND public.is_admin(auth.uid()));
