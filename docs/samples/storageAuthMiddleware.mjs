/**
 * Sample middleware for timeflowstorage — deploy on the storage host (not part of TimeFlow web build).
 * Requires: npm i jsonwebtoken
 */
import jwt from 'jsonwebtoken'

export function requireSupabaseUser(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
    req.userId = payload.sub
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function assertUuidMatchesUser(req, res, next) {
  const uuid = req.body?.uuid || req.query?.uuid
  if (!uuid || uuid !== req.userId) {
    return res.status(403).json({ error: 'uuid must match authenticated user' })
  }
  return next()
}
