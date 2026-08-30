# How the desktop app gets Supabase keys (no keys in the .exe)

## What you wanted

Keys must **not** sit inside the packaged desktop build so unpacking the app does not reveal them.  
The app must also **not** use local credential files — only the site.

## What we implemented

| Mode | Where keys come from |
|------|----------------------|
| **All runs** (dev + installed) | HTTP fetch of `https://timeflow.mechlintech.com/desktop-config.json` at startup |

Web `npm run build` / Docker build runs `scripts/write-desktop-config.mjs`, which writes `public/desktop-config.json` from CI env (`VITE_` / `NEXT_PUBLIC_` Supabase URL + publishable key). That file is **gitignored** and lives only on the web server.

Electron preload: `getSupabaseConfig()` → remote JSON only. If the host is down, the UI shows a clear “Unable to connect to TimeFlow servers” message (no `.env` / HTTP status dump).

## Honest limit

Anyone can still open `desktop-config.json` in a browser and see the **publishable** key. That does **not** mean full DB access if **RLS is correct**. The secret/service_role must never be in that file or the desktop app.

## What you do

1. Redeploy **web** (so `desktop-config.json` is published with the new publishable key).
2. Rebuild **desktop** as usual — do **not** put secrets into the installer.
3. Confirm: `https://timeflow.mechlintech.com/desktop-config.json` returns JSON with `supabaseUrl` + `supabasePublishableKey`.

See also: [DESKTOP_CONFIG.md](DESKTOP_CONFIG.md)
