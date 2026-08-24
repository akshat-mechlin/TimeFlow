# Desktop Supabase config (no keys in the installer)

## Goal

Packaged Electron builds must **not** embed Supabase URL/publishable key in the `.exe` / asar.  
Anyone unpacking the app should not find keys there.

## How it works

1. **Web deploy** generates `desktop-config.json` at build time from CI secrets (`write-desktop-config.mjs`).
2. File is served at: `https://timeflow.mechlintech.com/desktop-config.json`
3. **Desktop app** on startup calls `getSupabaseConfig()`:
   - **Local dev:** reads `.env` if present
   - **Packaged / no .env:** fetches the remote JSON

## Important honesty

- The publishable key is still downloadable from that URL (and visible in network traffic).
- That is normal for client apps. **Database access is protected by RLS**, not by hiding the publishable key.
- The **secret / service_role key must never** appear in desktop, web JS, or this JSON.

## Local desktop `.env` (developers only)

```env
SUPABASE_URL=https://yxkniwzsinqyjdqqzyjs.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
# Optional: test remote config even with .env present
# DESKTOP_CONFIG_FORCE_REMOTE=true
# DESKTOP_CONFIG_URL=https://timeflow.mechlintech.com/desktop-config.json
```

## After changing publishable key

1. Update GitHub secret `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Redeploy web (regenerates `desktop-config.json`)
3. Rebuild desktop **without** baking keys — users get new key on next launch via fetch
