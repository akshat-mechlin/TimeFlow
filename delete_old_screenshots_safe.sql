-- SAFE VERSION: Preview and Delete screenshots before October 1, 2025
-- Run the preview queries first to see what will be deleted

-- ============================================
-- PREVIEW QUERIES (Run these first!)
-- ============================================

-- Preview: Count screenshots to be deleted
SELECT 
  type,
  COUNT(*) as count,
  MIN(taken_at) as oldest_date,
  MAX(taken_at) as newest_date
FROM screenshots
WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
GROUP BY type
ORDER BY type;

-- Preview: Total count of screenshots to be deleted
SELECT COUNT(*) as total_screenshots_to_delete
FROM screenshots
WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz;

-- Preview: Count of related screenshot_activity records
SELECT COUNT(*) as screenshot_activity_records_to_delete
FROM screenshot_activity
WHERE screenshot_id IN (
  SELECT id 
  FROM screenshots 
  WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
);

-- Preview: Count of related activity_logs records
SELECT COUNT(*) as activity_logs_records_to_delete
FROM activity_logs
WHERE screenshot_id IN (
  SELECT id 
  FROM screenshots 
  WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz
);

-- ============================================
-- DELETION QUERIES (Run in a transaction!)
-- ============================================

BEGIN;

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
DELETE FROM screenshots
WHERE taken_at < '2025-10-01 00:00:00+00'::timestamptz;

-- Review the results before committing
-- If everything looks good, run: COMMIT;
-- If something is wrong, run: ROLLBACK;

-- COMMIT;  -- Uncomment to commit the transaction
-- ROLLBACK; -- Uncomment to rollback the transaction

-- ============================================
-- IMPORTANT NOTES:
-- ============================================
-- 1. This query only deletes database records.
-- 2. The actual files in Supabase Storage are NOT deleted automatically.
-- 3. You may need to delete the storage files separately using the storage_path.
-- 4. Consider backing up your data before running this query.
-- 5. The date '2025-10-01' means records BEFORE this date will be deleted.

