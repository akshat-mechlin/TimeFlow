# Key rotation checklist (C-02 / H-05)

The TimeFlow audit found a **service_role** JWT in git history (`delete-sc/cleanup.js`) and hardcoded anon keys in source. Treat those keys as compromised.

## Tracker Supabase project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → project `yxkniwzsinqyjdqqzyjs` → **Project Settings → API**.
2. **Rotate the `service_role` secret** (or regenerate JWT secret / API keys per current Dashboard flow).
3. Optionally rotate the **anon / publishable** key if it was widely leaked beyond intended apps.
4. Update GitHub Actions secrets:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
5. Update self-hosted deploy `.env` / CI secrets and redeploy web + desktop.
6. Update local developer `.env` files from `.env.example` (never commit secrets).

## Cleanup script

`delete-sc/cleanup.js` now reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env. Copy `delete-sc/.env.example` → `delete-sc/.env`.

## Git history scrub (if secrets were pushed)

```bash
# Example only — coordinate with team before rewriting history
git filter-repo --path TimeFlow/delete-sc/cleanup.js --invert-paths
# or use BFG Repo-Cleaner to replace the leaked JWT string
```

Force-push only after team agreement; rotate keys **before** relying on history rewrite.

## Desktop app

Rebuild Electron with env-injected anon key (`SUPABASE_URL` / `SUPABASE_ANON_KEY`). Old binaries may still embed previous keys until users upgrade.

## Confirm done

- [x] New service_role in Dashboard; old key invalid *(owner confirmed 31 Aug 2026 — audit v1.3)*
- [x] CI/CD secrets updated *(owner confirmed with key rotation)*
- [ ] Web + desktop redeployed *(confirm if publishable key also rotated)*
- [x] No JWT secrets remain in current tree (`rg eyJ` should not match live keys)
