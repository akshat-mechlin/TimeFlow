-- Delete screenshots and camera shots before October 1, 2025
-- This query handles foreign key constraints by deleting related records first

-- Step 1: Delete related records from screenshot_activity table
DELETE FROM screenshot_activity
WHERE screenshot_id IN (
  SELECT id 
  FROM screenshots 
  WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
);

-- Step 2: Delete related records from activity_logs table
DELETE FROM activity_logs
WHERE screenshot_id IN (
  SELECT id 
  FROM screenshots 
  WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
);

-- Step 3: Delete screenshots and camera shots before October 1, 2025
-- This will delete all records where taken_at is before October 1, 2025
-- regardless of the type (screenshot or camera)
DELETE FROM screenshots
WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz;

-- Optional: If you want to delete only specific types, uncomment and modify:
-- DELETE FROM screenshots
-- WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
--   AND type IN ('screenshot', 'camera'); -- Adjust type values as needed

-- Note: This query only deletes database records.
-- The actual files in Supabase Storage are NOT deleted by this query.
-- You may need to delete the files from storage separately using the storage_path field.

