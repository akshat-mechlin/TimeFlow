import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { format, startOfWeek } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { supabase } from '../lib/supabase'
import Loader from './Loader'
import { formatDurationForLog, LOG_SOURCE_LABELS, type LogSource } from '../lib/userLogs'
import { screenshotPreviewUrl } from '../lib/screenshotStorage'
import { canShowCameraShots, canShowScreenshots } from '../lib/captureVisibility'
import type { Tables } from '../types/database'

const IST_TIMEZONE = 'Asia/Kolkata'
const PAGE_SIZE = 50

type Profile = Tables<'profiles'>
type DatePreset = 'today' | 'week' | 'custom' | 'all'
type SourceFilter = 'all' | LogSource

interface ApiLogRow {
  id: string
  created_at: string
  ip_address: string | null
  action: string
  log_type: string
  actor_id: string | null
  actor_email: string | null
  actor_name: string
  source: LogSource
  message: string
  details: Record<string, unknown> | null
  total_count: number
}

const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'desktop', label: 'Desktop app' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other (not desktop or website)' },
]

const ACTION_OPTIONS = [
  { value: 'all', label: 'All activity' },
  { value: 'time_entry', label: 'All time entries' },
  { value: 'time_entry_created', label: 'Time entry created' },
  { value: 'time_entry_updated', label: 'Time entry sent' },
  { value: 'time_entry_deleted', label: 'Time entry deleted' },
  { value: 'screenshot', label: 'All screenshots' },
  { value: 'screenshot_created', label: 'Screenshot saved' },
  { value: 'screenshot_deleted', label: 'Screenshot deleted' },
  { value: 'camera', label: 'All camera photos' },
  { value: 'camera_created', label: 'Camera photo saved' },
  { value: 'camera_deleted', label: 'Camera photo deleted' },
  { value: 'security', label: 'All security events' },
  { value: 'devtools_attempt', label: 'DevTools access attempt' },
]

function normalizeTimeInput(value: string, fallback: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback
}

function istDateTime(dateStr: string, timeStr: string, endOfMinute = false): string {
  const time = normalizeTimeInput(timeStr, endOfMinute ? '23:59' : '00:00')
  const suffix = endOfMinute ? ':59.999' : ':00'
  return fromZonedTime(`${dateStr}T${time}${suffix}`, IST_TIMEZONE).toISOString()
}

function istDayStart(dateStr: string): string {
  return istDateTime(dateStr, '00:00')
}

function istDayEnd(dateStr: string): string {
  return istDateTime(dateStr, '23:59', true)
}

function todayIstDate(): string {
  return format(toZonedTime(new Date(), IST_TIMEZONE), 'yyyy-MM-dd')
}

function weekStartIstDate(): string {
  const nowIst = toZonedTime(new Date(), IST_TIMEZONE)
  return format(startOfWeek(nowIst, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

function actionLabel(action: string): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label
    || action.replace(/_/g, ' ')
}

function actionIcon(action: string) {
  const className = 'w-3.5 h-3.5'
  if (action === 'devtools_attempt' || action.startsWith('security')) return <ShieldAlert className={className} />
  if (action.includes('deleted')) return <Trash2 className={className} />
  if (action.includes('updated')) return <Pencil className={className} />
  if (action.startsWith('camera')) return <Camera className={className} />
  if (action.startsWith('screenshot')) return <Monitor className={className} />
  if (action.includes('created')) return <Plus className={className} />
  return <Clock className={className} />
}

function compactDuration(totalSeconds: unknown): string {
  const seconds = Number(totalSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
  if (seconds < 60) return '<1m'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function extraSummary(log: ApiLogRow): string {
  const details = log.details || {}
  if (log.action.startsWith('time_entry')) {
    const parts: string[] = []
    if (details.duration != null && Number(details.duration) > 0) {
      parts.push(compactDuration(details.duration))
    }
    if (details.day_total_seconds != null) {
      const status = typeof details.attendance_status === 'string' ? details.attendance_status : ''
      parts.push(`day ${compactDuration(details.day_total_seconds)} / 8h${status ? ` · ${status}` : ''}`)
    }
    return parts.length > 0 ? parts.join(' · ') : '—'
  }
  if (log.action === 'devtools_attempt') {
    return details.trigger ? String(details.trigger).replace(/_/g, ' ') : 'Security'
  }
  if (details.type) return String(details.type)
  if (details.is_manual_entry) return 'Manual'
  if (details.app_version) return `v${details.app_version}`
  return '—'
}

function captureImageUrl(log: ApiLogRow): string | null {
  if (!log.action.startsWith('screenshot') && !log.action.startsWith('camera')) return null
  const details = log.details || {}
  const type = details.type || (log.action.startsWith('camera') ? 'camera' : 'screenshot')
  return screenshotPreviewUrl(details.storage_path, type)
}

function securityEvidenceUrls(log: ApiLogRow): { screenshot: string | null; camera: string | null } {
  if (log.action !== 'devtools_attempt') return { screenshot: null, camera: null }
  const details = log.details || {}
  return {
    screenshot: screenshotPreviewUrl(
      details.screenshot_storage_path || details.storage_path,
      'screenshot',
    ),
    camera: screenshotPreviewUrl(details.camera_storage_path, 'camera'),
  }
}

function actionStyles(action: string): string {
  if (action === 'devtools_attempt' || action.startsWith('security')) {
    return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
  if (action.includes('deleted')) {
    return 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  }
  if (action.includes('updated')) {
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  }
  if (action.startsWith('camera')) {
    return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
  }
  if (action.startsWith('screenshot')) {
    return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
  }
  return 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function sourceBadgeStyles(source: LogSource): string {
  if (source === 'desktop') return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
  if (source === 'website') return 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function formatDetailTime(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${format(toZonedTime(date, IST_TIMEZONE), 'MMM d, yyyy')} at ${format(toZonedTime(date, IST_TIMEZONE), 'h:mm a')} IST`
}

function detailRows(log: ApiLogRow): { label: string; value: string }[] {
  const details = log.details || {}
  const rows: { label: string; value: string }[] = [
    { label: 'Person', value: log.actor_name },
  ]
  if (log.actor_email) rows.push({ label: 'Email', value: log.actor_email })
  rows.push({ label: 'What happened', value: actionLabel(log.action) })
  rows.push({ label: 'Came from', value: LOG_SOURCE_LABELS[log.source] || log.source })

  const operation = details.operation
  if (operation) rows.push({ label: 'Operation', value: String(operation) })

  if (details.is_manual_entry != null) {
    rows.push({ label: 'Manual entry', value: details.is_manual_entry ? 'Yes' : 'No' })
  }
  if (details.duration != null && details.duration !== '') {
    rows.push({ label: 'This entry', value: formatDurationForLog(Number(details.duration) || 0) })
  }
  if (details.day_total_seconds != null && details.day_total_seconds !== '') {
    const hours = (Number(details.day_total_seconds) || 0) / 3600
    const status = typeof details.attendance_status === 'string'
      ? details.attendance_status
      : getAttendanceStatus(hours)
    rows.push({
      label: 'Day total (Attendance)',
      value: `${formatDurationForLog(Number(details.day_total_seconds) || 0)} / 8 hours · ${status}`,
    })
    if (details.attendance_date) {
      rows.push({ label: 'Attendance date', value: String(details.attendance_date) })
    }
  }
  const startTime = formatDetailTime(details.start_time)
  if (startTime) rows.push({ label: 'Started', value: startTime })
  const endTime = formatDetailTime(details.end_time)
  if (endTime) rows.push({ label: 'Stopped', value: endTime })
  if (details.description) rows.push({ label: 'Note', value: String(details.description) })
  if (details.app_version) rows.push({ label: 'App version', value: String(details.app_version) })
  if (details.type) rows.push({ label: 'Capture type', value: String(details.type) })
  if (details.storage_path) rows.push({ label: 'File path', value: String(details.storage_path) })
  if (details.time_entry_id) rows.push({ label: 'Time entry', value: String(details.time_entry_id) })
  if (details.record_id) rows.push({ label: 'Record ID', value: String(details.record_id) })

  if (log.action === 'devtools_attempt') {
    if (details.trigger) rows.push({ label: 'Trigger', value: String(details.trigger) })
    if (details.screenshot_storage_path) {
      rows.push({ label: 'Screenshot path', value: String(details.screenshot_storage_path) })
    }
    if (details.camera_storage_path) {
      rows.push({ label: 'Camera path', value: String(details.camera_storage_path) })
    }
    if (details.screenshot_id) rows.push({ label: 'Screenshot ID', value: String(details.screenshot_id) })
    if (details.camera_id) rows.push({ label: 'Camera ID', value: String(details.camera_id) })
    if (details.screenshot_error) rows.push({ label: 'Screenshot error', value: String(details.screenshot_error) })
    if (details.camera_error) rows.push({ label: 'Camera error', value: String(details.camera_error) })
    if (details.href) rows.push({ label: 'Page URL', value: String(details.href) })
    if (details.pathname) rows.push({ label: 'Path', value: String(details.pathname) })
    if (details.platform) rows.push({ label: 'Platform', value: String(details.platform) })
    if (details.user_agent) rows.push({ label: 'User agent', value: String(details.user_agent) })
    if (details.device_info) rows.push({ label: 'Device', value: String(details.device_info) })
    if (details.timezone) rows.push({ label: 'Timezone', value: String(details.timezone) })
    if (details.language) rows.push({ label: 'Language', value: String(details.language) })
    if (details.screen_width != null && details.screen_height != null) {
      rows.push({
        label: 'Screen',
        value: `${details.screen_width}×${details.screen_height}`,
      })
    }
    if (details.window_inner_width != null && details.window_inner_height != null) {
      rows.push({
        label: 'Window',
        value: `${details.window_inner_width}×${details.window_inner_height}`,
      })
    }
    if (details.actor_email) rows.push({ label: 'Actor email (client)', value: String(details.actor_email) })
    if (details.actor_role) rows.push({ label: 'Role', value: String(details.actor_role) })
    if (details.key) rows.push({ label: 'Key', value: String(details.key) })
    if (details.recorded_at_client) {
      const recorded = formatDetailTime(details.recorded_at_client)
      if (recorded) rows.push({ label: 'Client time', value: recorded })
    }
    const shown = new Set([
      'operation', 'log_message', 'device_info', 'user_agent', 'ip_address', 'trigger', 'href',
      'pathname', 'platform', 'timezone', 'language', 'screen_width', 'screen_height',
      'window_inner_width', 'window_inner_height', 'actor_email', 'actor_role', 'key',
      'recorded_at_client', 'source', 'api_action', 'api_table', 'api_operation', 'actor_id',
      'actor_name', 'record_id', 'ctrl', 'shift', 'alt', 'meta', 'referrer', 'languages',
      'vendor', 'cookie_enabled', 'hardware_concurrency', 'device_memory', 'max_touch_points',
      'online', 'timezone_offset_min', 'screen_avail_width', 'screen_avail_height',
      'screen_color_depth', 'screen_pixel_depth', 'window_outer_width', 'window_outer_height',
      'device_pixel_ratio', 'visibility_state', 'recorded_at',
      'screenshot_storage_path', 'camera_storage_path', 'screenshot_id', 'camera_id',
      'screenshot_error', 'camera_error', 'time_entry_id', 'capture_reason', 'capture_error',
    ])
    for (const [key, value] of Object.entries(details)) {
      if (shown.has(key) || value == null || value === '') continue
      if (typeof value === 'object') {
        rows.push({ label: key.replace(/_/g, ' '), value: JSON.stringify(value) })
      } else {
        rows.push({ label: key.replace(/_/g, ' '), value: String(value) })
      }
    }
  }

  return rows
}

interface TimeEntrySlice {
  id: string
  user_id: string
  start_time: string
  duration: number | null
}

function attendanceDateFrom(iso: string): string {
  return format(toZonedTime(new Date(iso), IST_TIMEZONE), 'yyyy-MM-dd')
}

function getAttendancePeriod(dateStr: string) {
  const periodStart = fromZonedTime(`${dateStr} 00:00:00`, IST_TIMEZONE)
  const periodEnd = fromZonedTime(`${dateStr} 23:59:59.999`, IST_TIMEZONE)
  return { periodStart, periodEnd }
}

function getAttendanceStatus(hoursWorked: number): 'Present' | 'Half day' | 'Under 4 hours' {
  if (hoursWorked >= 8) return 'Present'
  if (hoursWorked >= 4) return 'Half day'
  return 'Under 4 hours'
}

function attendanceDayTotal(
  entries: TimeEntrySlice[],
  userId: string,
  dateStr: string,
  currentRecordId: string | null,
  currentDuration: number
): number {
  const { periodStart, periodEnd } = getAttendancePeriod(dateStr)
  return entries.reduce((sum, entry) => {
    if (entry.user_id !== userId) return sum
    const started = new Date(entry.start_time)
    if (started < periodStart || started >= periodEnd) return sum
    const duration = currentRecordId && entry.id === currentRecordId
      ? currentDuration
      : Number(entry.duration) || 0
    return sum + duration
  }, 0)
}

async function attachDayTotals(logs: ApiLogRow[]): Promise<ApiLogRow[]> {
  const timeLogs = logs.filter((log) => log.action.startsWith('time_entry') && log.actor_id)
  if (timeLogs.length === 0) return logs

  const userIds = [...new Set(timeLogs.map((log) => log.actor_id as string))]
  const attendanceDates = timeLogs.map((log) => {
    const startTime = typeof log.details?.start_time === 'string' ? log.details.start_time : log.created_at
    return attendanceDateFrom(startTime)
  })
  const { periodStart } = getAttendancePeriod(attendanceDates.reduce((min, date) => date < min ? date : min))
  const { periodEnd } = getAttendancePeriod(attendanceDates.reduce((max, date) => date > max ? date : max))

  const { data: entries } = await supabase
    .from('time_entries')
    .select('id, user_id, start_time, duration')
    .in('user_id', userIds)
    .gte('start_time', periodStart.toISOString())
    .lte('start_time', periodEnd.toISOString())

  const dayEntries = (entries || []) as TimeEntrySlice[]

  return logs.map((log) => {
    if (!log.action.startsWith('time_entry') || !log.actor_id) return log

    const details = log.details || {}
    const recordId = typeof details.record_id === 'string' ? details.record_id : null
    const eventDuration = Number(details.duration) || 0
    const startTime = typeof details.start_time === 'string' ? details.start_time : log.created_at
    const dateStr = attendanceDateFrom(startTime)
    const dayTotal = attendanceDayTotal(dayEntries, log.actor_id, dateStr, recordId, eventDuration)

    return {
      ...log,
      details: {
        ...details,
        day_total_seconds: dayTotal,
        attendance_date: dateStr,
        attendance_status: getAttendanceStatus(dayTotal / 3600),
      },
    }
  })
}

export default function ActivityLogsTab() {
  const [logs, setLogs] = useState<ApiLogRow[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('week')
  const [customStart, setCustomStart] = useState(todayIstDate())
  const [customEnd, setCustomEnd] = useState(todayIstDate())
  const [startTime, setStartTime] = useState('00:00')
  const [endTime, setEndTime] = useState('23:59')
  const [employeeId, setEmployeeId] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const dateRange = useMemo(() => {
    const fromTime = normalizeTimeInput(startTime, '00:00')
    const toTime = normalizeTimeInput(endTime, '23:59')
    if (datePreset === 'all') return { start: null, end: null }
    if (datePreset === 'today') {
      const today = todayIstDate()
      return { start: istDateTime(today, fromTime), end: istDateTime(today, toTime, true) }
    }
    if (datePreset === 'week') {
      return {
        start: istDateTime(weekStartIstDate(), fromTime),
        end: istDateTime(todayIstDate(), toTime, true),
      }
    }
    return {
      start: istDateTime(customStart || todayIstDate(), fromTime),
      end: istDateTime(customEnd || todayIstDate(), toTime, true),
    }
  }, [datePreset, customStart, customEnd, startTime, endTime])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  useEffect(() => {
    const loadEmployees = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, enable_screenshot_capture, enable_camera_capture')
        .order('full_name')
      setEmployees((data as Profile[]) || [])
    }
    loadEmployees()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [datePreset, customStart, customEnd, startTime, endTime, employeeId, actionFilter, sourceFilter, searchTerm])

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true)
        setError(null)

        const { data, error: fetchError } = await supabase.rpc('get_tracker_crud_logs', {
          p_limit: PAGE_SIZE,
          p_offset: (page - 1) * PAGE_SIZE,
          p_action: actionFilter === 'all' ? null : actionFilter,
          p_search: searchTerm.trim() || null,
          p_user_id: employeeId === 'all' ? null : employeeId,
          p_source: sourceFilter === 'all' ? null : sourceFilter,
          p_start: dateRange.start,
          p_end: dateRange.end,
        })

        if (fetchError) throw fetchError

        const rows = await attachDayTotals((data || []) as ApiLogRow[])
        const actorIds = [...new Set(rows.map((log) => log.actor_id).filter(Boolean))] as string[]
        const visibilityByUser = new Map<string, Profile>()
        if (actorIds.length > 0) {
          const { data: visibilityProfiles } = await supabase
            .from('profiles')
            .select('id, enable_screenshot_capture, enable_camera_capture')
            .in('id', actorIds)
          for (const person of visibilityProfiles || []) {
            visibilityByUser.set(person.id, person as Profile)
          }
        }
        const visibleRows = rows.filter((log) => {
          const person = log.actor_id ? visibilityByUser.get(log.actor_id) : undefined
          if (log.action.startsWith('screenshot') && !canShowScreenshots(person)) return false
          if (log.action.startsWith('camera') && !canShowCameraShots(person)) return false
          return true
        })
        setLogs(visibleRows)
        setTotalCount(visibleRows[0]?.total_count ? Number(visibleRows[0].total_count) : 0)
      } catch (err: any) {

        setError(err.message || 'Could not load activity logs.')
        setLogs([])
        setTotalCount(0)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [dateRange.start, dateRange.end, employeeId, actionFilter, sourceFilter, searchTerm, page, refreshKey])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Activity Logs</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Time entries, screenshots, camera photos, and security events (including DevTools attempts).
          </p>
        </div>
        <button
          onClick={() => {
            setPage(1)
            setRefreshKey((current) => current + 1)
          }}
          className="inline-flex items-center space-x-2 self-start px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Date range</label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="custom">Custom dates</option>
            <option value="all">All time</option>
          </select>
          {datePreset !== 'all' && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All employees</option>
            {employees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || person.email}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Activity type</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Came from</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or email"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      {datePreset === 'custom' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16">
          <Loader size="md" text="Loading activity logs" />
        </div>
      ) : error ? (
        <div className="py-12 text-center text-red-600 dark:text-red-400">{error}</div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center text-gray-500 dark:text-gray-400">
          <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="font-medium">No time entry, screenshot, or camera activity for these filters.</p>
          <p className="text-sm mt-1">Try This week or All time.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full min-w-[880px]">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Activity</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">What happened</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Detail</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider"> </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {logs.map((log) => {
                  const details = detailRows(log)
                  const createdAtIst = toZonedTime(new Date(log.created_at), IST_TIMEZONE)
                  const source = (['desktop', 'website', 'other'].includes(log.source) ? log.source : 'other') as LogSource
                  const isExpanded = expandedId === log.id

                  return (
                    <Fragment key={log.id}>
                      <tr
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/60 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                          <div>{format(createdAtIst, 'MMM d, yyyy')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{format(createdAtIst, 'h:mm a')} IST</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{log.actor_name}</div>
                          {log.actor_email && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">{log.actor_email}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${actionStyles(log.action)}`}>
                            {actionIcon(log.action)}
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 max-w-md">
                          {log.message}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceBadgeStyles(source)}`}>
                            {LOG_SOURCE_LABELS[source]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {extraSummary(log)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          {isExpanded ? 'Hide' : 'Details'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50 dark:bg-gray-700/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex flex-col lg:flex-row gap-4">
                              {(() => {
                                const evidence = securityEvidenceUrls(log)
                                const singleCapture = captureImageUrl(log)
                                if (evidence.screenshot || evidence.camera) {
                                  return (
                                    <div className="shrink-0 flex flex-col sm:flex-row gap-3">
                                      {evidence.screenshot && (
                                        <div>
                                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Screenshot at attempt</p>
                                          <a
                                            href={evidence.screenshot}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(event) => event.stopPropagation()}
                                            className="block"
                                          >
                                            <img
                                              src={evidence.screenshot}
                                              alt="Screenshot at DevTools attempt"
                                              className="max-h-64 max-w-full lg:max-w-sm rounded-lg border border-gray-200 dark:border-gray-600 object-contain bg-black/40"
                                            />
                                          </a>
                                        </div>
                                      )}
                                      {evidence.camera && (
                                        <div>
                                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Camera at attempt</p>
                                          <a
                                            href={evidence.camera}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(event) => event.stopPropagation()}
                                            className="block"
                                          >
                                            <img
                                              src={evidence.camera}
                                              alt="Camera at DevTools attempt"
                                              className="max-h-64 max-w-full lg:max-w-sm rounded-lg border border-gray-200 dark:border-gray-600 object-contain bg-black/40"
                                            />
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  )
                                }
                                if (!singleCapture) return null
                                return (
                                  <div className="shrink-0">
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                      {log.action.startsWith('camera') ? 'Camera photo' : 'Screenshot'}
                                    </p>
                                    <a
                                      href={singleCapture}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      className="block"
                                    >
                                      <img
                                        src={singleCapture}
                                        alt={log.action.startsWith('camera') ? 'Camera photo' : 'Screenshot'}
                                        className="max-h-64 max-w-full lg:max-w-sm rounded-lg border border-gray-200 dark:border-gray-600 object-contain bg-black/40"
                                      />
                                    </a>
                                  </div>
                                )
                              })()}
                              <dl className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm flex-1">
                                {details.map((item) => (
                                  <div key={item.label} className="rounded-lg bg-white dark:bg-gray-800 px-3 py-2">
                                    <dt className="text-xs text-gray-500 dark:text-gray-400">{item.label}</dt>
                                    <dd className="text-gray-800 dark:text-gray-100 font-medium break-all">{item.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {logs.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
              {(page - 1) * PAGE_SIZE + logs.length} of {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 text-gray-700 dark:text-gray-200"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 text-gray-700 dark:text-gray-200"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
