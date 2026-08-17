-- Allow the Activity Logs dashboard to record and read user_logs.
-- Employees can insert their own rows. Managers/admins can insert logs for others
-- (e.g. manual hour edits). Admins can read every log.

ALTER TABLE public.user_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own activity logs" ON public.user_logs;
CREATE POLICY "Users can insert own activity logs"
ON public.user_logs
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
  OR public.is_manager(auth.uid())
);

DROP POLICY IF EXISTS "Users can view own activity logs" ON public.user_logs;
CREATE POLICY "Users can view own activity logs"
ON public.user_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all activity logs" ON public.user_logs;
CREATE POLICY "Admins can view all activity logs"
ON public.user_logs
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));
