-- Allow security DevTools evidence captures without an active time entry.
ALTER TABLE public.screenshots
  ALTER COLUMN time_entry_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_screenshot_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Security / DevTools evidence may have no time entry; trust explicit user_id.
  IF NEW.time_entry_id IS NULL THEN
    IF NEW.user_id IS NULL THEN
      NEW.user_id := auth.uid();
    END IF;
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'screenshots.user_id is required when time_entry_id is null';
    END IF;
    RETURN NEW;
  END IF;

  SELECT te.user_id
  INTO NEW.user_id
  FROM public.time_entries AS te
  WHERE te.id = NEW.time_entry_id;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid time_entry_id % — no matching time_entries row', NEW.time_entry_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Employees need to insert their own captures (tracking + security evidence).
DROP POLICY IF EXISTS "Users can insert own screenshots" ON public.screenshots;
CREATE POLICY "Users can insert own screenshots"
ON public.screenshots
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
