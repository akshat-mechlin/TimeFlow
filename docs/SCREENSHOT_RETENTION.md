# Screenshot retention (L-03)

Live inventory at audit time: ~1.9M rows in `public.screenshots` plus camera/webcam types.

## Recommendations

1. Define retention (e.g. 90/180 days) by policy and automate deletion of old storage objects + DB rows.
2. Prefer private object storage with signed URLs; keep Supabase `screenshots` bucket non-public.
3. Restrict who can query screenshots (already role-based when RLS is enabled).
4. Document legal/HR justification for webcam capture.

Public buckets `avatars` and `tracker-application` are intentional (L-01) for profile images and installer downloads.
