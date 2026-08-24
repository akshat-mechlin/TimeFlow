import { supabase } from './supabase'

export const ACTIVITY_LOG_TYPES = [
  'login',
  'logout',
  'tracking_start',
  'tracking_stop',
  'idle_continue',
  'idle_stop',
  'screenshot',
  'camera',
  'project_selected',
  'task_selected',
  'manual_edit',
  'profile_update',
  'project_saved',
  'project_deleted',
  'task_saved',
  'user_created',
  'user_updated',
  'user_deleted',
  'setting_changed',
  'group_saved',
  'devtools_attempt',
] as const

export type ActivityLogType = (typeof ACTIVITY_LOG_TYPES)[number]

export const ACTIVITY_LOG_TYPE_LABELS: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  tracking_start: 'Started tracking',
  tracking_stop: 'Stopped tracking',
  idle_continue: 'Resumed after break',
  idle_stop: 'Stopped after inactivity',
  screenshot: 'Screenshot',
  camera: 'Camera photo',
  project_selected: 'Project selected',
  task_selected: 'Task selected',
  manual_edit: 'Hours edited',
  profile_update: 'Profile updated',
  project_saved: 'Project saved',
  project_deleted: 'Project removed',
  task_saved: 'Task updated',
  user_created: 'User added',
  user_updated: 'User updated',
  user_deleted: 'User removed',
  setting_changed: 'Setting changed',
  group_saved: 'Team group updated',
  version_check_passed: 'App version OK',
  version_check_failed: 'App version blocked',
  devtools_attempt: 'DevTools access attempt',
}

export type LogSource = 'desktop' | 'website' | 'other'

export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
  desktop: 'Desktop app',
  website: 'Website',
  other: 'Other',
}

export function resolveLogSource(
  metadata?: Record<string, unknown> | null,
  userAgent?: string | null
): LogSource {
  const source = metadata?.source
  if (source === 'desktop' || userAgent === 'TimeFlow Desktop') return 'desktop'
  if (source === 'website') return 'website'
  return 'other'
}

export interface WriteUserLogParams {
  userId: string
  logType: string
  message: string
  source?: LogSource
  metadata?: Record<string, unknown>
  deviceInfo?: string | null
  userAgent?: string | null
}

export function formatDurationForLog(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  if (parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`)
  }
  return parts.join(' ')
}

export function formatHoursInputForLog(hoursValue: number): string {
  if (!Number.isFinite(hoursValue) || hoursValue < 0) return '0 minutes'
  return formatDurationForLog(Math.round(hoursValue * 3600))
}

export function roleLabelForLog(role: string): string {
  if (!role) return 'User'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export async function writeUserLog({
  userId,
  logType,
  message,
  source = 'website',
  metadata = {},
  deviceInfo = null,
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null,
}: WriteUserLogParams): Promise<void> {
  if (!userId || !message) return

  const resolvedSource = metadata.source === 'desktop' || metadata.source === 'website' || metadata.source === 'other'
    ? metadata.source
    : source

  try {
    const { error } = await supabase.from('user_logs').insert({
      user_id: userId,
      log_type: logType,
      log_message: message,
      metadata: {
        ...metadata,
        source: resolvedSource,
        recorded_at: new Date().toISOString(),
      },
      device_info: deviceInfo,
      user_agent: userAgent,
    })

    if (error) {
      console.warn('Failed to write activity log:', error.message)
    }
  } catch (error) {
    console.warn('Failed to write activity log:', error)
  }
}
