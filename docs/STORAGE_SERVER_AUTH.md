# Screenshot / attachment storage server auth contract (H-03)

Clients now send:

```http
Authorization: Bearer <supabase_access_token>
POST /upload
```

Form fields: `type`, `uuid`, `filename`, `file`.

## Required server behavior

1. Reject requests without a valid Bearer token (401).
2. Verify the JWT against the Tracker Supabase project JWT secret (or JWKS).
3. Enforce `uuid` in the request equals the token `sub` (user id), **or** the caller is an admin (optional claim / DB check).
4. Prefer short-lived signed GET URLs for `/file` instead of open query-param access.

## Sample Express middleware

```js
import jwt from 'jsonwebtoken'

export function requireSupabaseUser(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing bearer token' })

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
    req.userId = payload.sub
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// In upload handler:
// if (req.body.uuid !== req.userId) return res.status(403).json({ error: 'uuid mismatch' })
```

Deploy this on `timeflowstorage.mechlintech.com` before enforcing auth in production (clients already send the header when a session exists).

## Owner action

- [ ] Deploy JWT verification on storage host
- [ ] Confirm uploads from web + desktop succeed with auth
- [ ] Confirm unauthenticated uploads fail
