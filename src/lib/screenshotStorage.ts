const SCREENSHOT_STORAGE_BASE_URL = 'https://timeflowstorage.mechlintech.com'.replace(/\/$/, '')

export function normalizeScreenshotStoragePath(storagePath: string, screenshotType?: string): string {
  const isCamera = screenshotType === 'camera' || screenshotType === 'webcam'
  let finalPath = storagePath
  if (isCamera && !finalPath.startsWith('camera/')) {
    finalPath = `camera/${finalPath}`
  } else if (!isCamera && finalPath.startsWith('camera/')) {
    finalPath = finalPath.replace(/^camera\//, '')
  }
  return finalPath
}

export function buildScreenshotStorageServerUrl(normalizedPath: string): string | null {
  if (!SCREENSHOT_STORAGE_BASE_URL) return null
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length < 3) return null
  const folderType = segments[0]
  if (folderType !== 'screenshots' && folderType !== 'camera') return null
  const uuid = segments[1]
  const fileName = segments.slice(2).join('/')
  if (!uuid || !fileName) return null
  const params = new URLSearchParams({
    type: folderType,
    uuid,
    file: fileName,
  })
  return `${SCREENSHOT_STORAGE_BASE_URL}/file?${params.toString()}`
}

export function screenshotPreviewUrl(storagePath?: unknown, screenshotType?: unknown): string | null {
  if (!storagePath || typeof storagePath !== 'string') return null
  const type = typeof screenshotType === 'string' ? screenshotType : undefined
  return buildScreenshotStorageServerUrl(normalizeScreenshotStoragePath(storagePath, type))
}
