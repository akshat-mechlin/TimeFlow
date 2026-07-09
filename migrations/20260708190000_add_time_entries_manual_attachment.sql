-- Manual time entry tracking (manager/admin edits with optional proof file)
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS is_manual_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_attachment_path text;

COMMENT ON COLUMN public.time_entries.is_manual_entry IS 'True when entry was created or updated via Attendance manual edit modal';
COMMENT ON COLUMN public.time_entries.manual_attachment_path IS 'Relative path on timeflow storage server, e.g. manual-updates/{entry_id}/file.pdf';
