# Production deployment — screenshots optimization

Migrations live in **`TimeFlow/migrations/`** (version-controlled with the app).

Based on **prod schema audit** (1,295,781 rows):

| Item | Prod state |
|------|------------|
| Columns | `id`, `time_entry_id`, `storage_path`, `taken_at`, `type`, `created_at` |
| **`user_id`** | **Missing** |
| Indexes | **`screenshots_pkey` only** |
| Triggers | None |
| RLS | Enabled — every policy joins `time_entries` (slow at 1.3M) |
| RPC | None |
| Table size | ~266 MB |

**Zero data loss.** All steps are additive (new column, indexes, functions, policy rewrites).

---

## Run order

| Step | File | When |
|------|------|------|
| 1 | `20260703120000_prod_screenshots_phase1_add_user_id.sql` | First |
| 2 | `20260703120100_prod_screenshots_phase2_indexes_concurrent.sql` | After phase 1 (one index at a time) |
| 3 | Backfill loop (see below) | After phase 2 indexes |
| 4 | `20260703120200_prod_screenshots_phase3_finalize.sql` | Only when backfill = 100% |
| 5 | Deploy **TimeFlow** frontend | After phase 3 |

---

## Phase 1 — Add column + backfill tools

Run once in Supabase SQL Editor.

Adds:
- `user_id uuid` (nullable)
- `sync_screenshot_user_id()` trigger
- `backfill_screenshot_user_id_batch(n)` function

---

## Phase 2 — Indexes (CONCURRENTLY)

Run **one `CREATE INDEX CONCURRENTLY` at a time** in SQL Editor.

Start with `idx_screenshots_time_entry_id` — speeds up backfill.

Each index may take **5–15 minutes** on 1.3M rows.

---

## Backfill — between phase 2 and phase 3

Loop until result is `0`:

```sql
SELECT public.backfill_screenshot_user_id_batch(10000);
```

Monitor progress:

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE user_id IS NULL) AS still_null,
  round(100.0 * count(user_id) / count(*), 2) AS pct_done
FROM public.screenshots;
```

Orphan check:

```sql
SELECT count(*) AS orphans
FROM public.screenshots s
LEFT JOIN public.time_entries te ON te.id = s.time_entry_id
WHERE te.id IS NULL;
```

If `orphans > 0`, fix those rows before phase 3.

---

## Phase 3 — Finalize (NOT NULL, RLS, RPC)

Run **only when** `still_null = 0`.

- Sets `user_id NOT NULL` + FK to `profiles`
- Replaces 4 RLS policies to use `user_id` directly
- Creates `get_screenshots_for_user_day()` RPC

---

## Phase 4 — Deploy frontend

Deploy **TimeFlow** (`src/pages/Screenshots.tsx` query fix).

Primary API:

```
POST /rest/v1/rpc/get_screenshots_for_user_day
```

Fallback: direct query on `screenshots.user_id`.

---

## Verify

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.get_screenshots_for_user_day(
  '<user-uuid>'::uuid,
  '2026-07-01T18:30:00+00'::timestamptz,
  '2026-07-02T18:29:59.999+00'::timestamptz,
  'all',
  500
);
```

Expected: **`Index Scan using idx_screenshots_user_id_taken_at`**, **< 200ms**.

---

## Reverting (if something goes wrong)

**Before phase 3** (user_id still nullable):

```sql
-- Drop new indexes (optional)
DROP INDEX CONCURRENTLY IF EXISTS idx_screenshots_user_id_taken_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_screenshots_user_id_type_taken_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_screenshots_time_entry_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_screenshots_taken_at_desc;

-- Remove column (only if you need full rollback)
ALTER TABLE public.screenshots DROP COLUMN IF EXISTS user_id;

DROP TRIGGER IF EXISTS trg_sync_screenshot_user_id ON public.screenshots;
DROP FUNCTION IF EXISTS public.sync_screenshot_user_id();
DROP FUNCTION IF EXISTS public.backfill_screenshot_user_id_batch(integer);
```

**After phase 3** (NOT NULL + RLS + RPC applied): restore previous RLS policies from a backup or Supabase point-in-time recovery. Do not drop `user_id` without a maintenance window.

---

## Prod type values

| type | count |
|------|------:|
| screenshot | 796,030 |
| camera | 402,444 |
| desktop | 72,325 |
| webcam | 24,886 |
| automatic | 118 |

Frontend + RPC filters:
- **Camera tab:** `camera`, `webcam`
- **Screenshot tab:** `screenshot`, `desktop`, `automatic`, `screen`
