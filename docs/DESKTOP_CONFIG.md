# Desktop Supabase config (no keys in the installer)

## Goal

Packaged Electron builds must **not** embed Supabase URL/publishable key in the `.exe` / asar.  
The app loads publishable config **only** from the web host.

## How it works

1. **Web deploy** generates `desktop-config.json` at build time from CI secrets (`write-desktop-config.mjs`).
2. File is served at: `https://timeflow.mechlintech.com/desktop-config.json`
3. **Desktop app** on startup always calls `getSupabaseConfig()` → HTTP fetch of that URL (no local Supabase credentials, no offline cache).

## When the website is unreachable

The app shows a user-facing message such as:

> Unable to connect to TimeFlow servers.  
> Please check your internet connection and try again…

Restore the Cloudflare tunnel / origin and redeploy web so `desktop-config.json` is reachable again.

## Important honesty

- The publishable key is still downloadable from that URL (and visible in network traffic).
- That is normal for client apps. **Database access is protected by RLS**, not by hiding the publishable key.
- The **secret / service_role key must never** appear in desktop, web JS, or this JSON.

## After changing publishable key

1. Update GitHub secret `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Redeploy web (regenerates `desktop-config.json`)
3. Desktop users pick up the new key on next launch via fetch — no desktop rebuild required for key rotation
