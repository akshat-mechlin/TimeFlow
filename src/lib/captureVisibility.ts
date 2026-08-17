export type CaptureProfileFlags = {
  enable_screenshot_capture?: boolean | null
  enable_camera_capture?: boolean | null
}

export function isCameraCaptureType(type?: string | null): boolean {
  return type === 'camera' || type === 'webcam'
}

export function canShowScreenshots(profile?: CaptureProfileFlags | null): boolean {
  return profile?.enable_screenshot_capture ?? true
}

export function canShowCameraShots(profile?: CaptureProfileFlags | null): boolean {
  return profile?.enable_camera_capture ?? true
}

export function canShowCaptureType(
  type: string | null | undefined,
  profile?: CaptureProfileFlags | null
): boolean {
  return isCameraCaptureType(type) ? canShowCameraShots(profile) : canShowScreenshots(profile)
}

export function filterVisibleCaptures<T extends { type?: string | null }>(
  items: T[],
  profile?: CaptureProfileFlags | null
): T[] {
  return items.filter((item) => canShowCaptureType(item.type, profile))
}

export function visibleScreenshotTypeFilter(
  typeFilter: 'all' | 'screenshot' | 'camera',
  profile?: CaptureProfileFlags | null
): 'all' | 'screenshot' | 'camera' | 'none' {
  const showScreenshots = canShowScreenshots(profile)
  const showCamera = canShowCameraShots(profile)

  if (typeFilter === 'screenshot') return showScreenshots ? 'screenshot' : 'none'
  if (typeFilter === 'camera') return showCamera ? 'camera' : 'none'
  if (showScreenshots && showCamera) return 'all'
  if (showScreenshots) return 'screenshot'
  if (showCamera) return 'camera'
  return 'none'
}
