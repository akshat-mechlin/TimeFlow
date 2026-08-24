/** Allowed OAuth desktop callback targets (H-01). */
const ALLOWED_CALLBACKS = [
  /^tracker:\/\/callback\/?$/i,
  /^http:\/\/127\.0\.0\.1:5174\/callback\/?$/i,
  /^http:\/\/localhost:5174\/callback\/?$/i,
]

export function isAllowedOAuthCallback(callbackUrl: string): boolean {
  const trimmed = callbackUrl.trim()
  if (!trimmed) return false
  return ALLOWED_CALLBACKS.some((re) => re.test(trimmed))
}

export function sanitizeOAuthCallback(callbackUrl: string | null | undefined): string | null {
  if (!callbackUrl) return null
  return isAllowedOAuthCallback(callbackUrl) ? callbackUrl.trim() : null
}
