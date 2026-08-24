# Self-hosted runner hardening (M-03)

Authoritative deploy: `.github/workflows/deployment.yml` (self-hosted Windows + Docker).

## Checklist

- [ ] Runner machine is dedicated or least-privilege service account
- [ ] Only trusted org repos can use the runner labels
- [ ] DockerHub token is scoped / rotatable; stored only as GitHub Actions secret
- [ ] Disk cleanup after builds (`docker system prune`) is enabled
- [ ] OS patches applied regularly
- [ ] No interactive browsing / untrusted downloads on the runner host
- [ ] Branch protection on `main` (required reviews) configured in GitHub UI
- [ ] HSTS / TLS terminated at reverse proxy in front of port 5173 if exposed externally

Secrets are injected only as Docker build-args for public anon URL/key (expected for SPA). Never bake `service_role` into images.
