// Send attendance and tracker reports to each manager via Microsoft 365 (Graph API)
// Invoke with body: { startDate?, endDate? } for date-range HTML report (admin only), or { weekly: true } for previous-week HTML report (manager or admin).
// For cron/scheduled: body { cronSecret, weekly?: true } for weekly; { cronSecret, monthly: true } for previous month (e.g. 1st); { cronSecret, monthlyAuto: true } for automation (1st → previous month, 25th → current month to date).
// Cron secret may also be sent as header X-Cron-Secret (same value as CRON_SECRET). Values are trimmed when comparing (avoids copy/paste whitespace from the Dashboard).
// Report mode for cron may be sent as header X-Cron-Report: weekly | monthly | monthlyAuto (if JSON body is empty or not parsed, e.g. some clients strip bodies).
// Requires: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_FROM_EMAIL; optional CRON_SECRET for scheduled runs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { format, parseISO, startOfDay, endOfDay, eachDayOfInterval, startOfWeek, subWeeks, addDays, subMonths, startOfMonth, endOfMonth } from 'https://esm.sh/date-fns@3.0.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-report',
}

interface Profile {
  id: string
  full_name: string | null
  email: string | null
  manager_id: string | null
  role: string
}

interface TimeEntry {
  id: string
  user_id: string
  start_time: string
  end_time: string | null
  duration: number | null
  description: string | null
  profile?: Profile
  project_time_entries?: Array<{
    project_id: string | null
    billable?: boolean
    projects?: { name: string } | null
  }>
}

function getMicrosoftToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) throw new Error(data.error_description || data.error)
      return data.access_token
    })
}

function sendGraphMail(
  token: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: toEmail } }],
      },
      saveToSentItems: true,
    }),
  }).then((r) => {
    if (!r.ok) return r.text().then((t) => { throw new Error(t) })
  })
}

function attendanceStatus(hours: number): string {
  if (hours >= 8) return 'Present'
  if (hours >= 4) return 'Half day'
  return 'Absent'
}

function buildReportHtml(
  manager: Profile,
  startStr: string,
  endStr: string,
  dateHeaders: string,
  attendanceRows: string,
  trackerRows: string,
  leaveRowsHtml: string,
  isWeekly: boolean,
  recipientLabel?: string,
  isAllEmployees?: boolean
): string {
  const greeting = recipientLabel ?? manager.full_name ?? 'Manager'
  const scopeText = isAllEmployees ? 'for all employees' : 'for your team'
  const periodLabel = isWeekly
    ? `Week: ${startStr} to ${endStr} (Mon–Sat)`
    : `Period: ${startStr} to ${endStr}`
  const reportTitle = isWeekly ? 'Weekly Team Report' : 'TimeFlow Reports'
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${reportTitle} – ${startStr} to ${endStr}</title>
</head>
<body style="margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;color:#1e293b;">
  <div style="max-width:960px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);border-radius:12px;padding:24px;margin-bottom:24px;color:#fff;">
      <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;">TimeFlow</h1>
      <p style="margin:0;font-size:14px;opacity:0.95;">${reportTitle}</p>
    </div>
    <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <p style="margin:0 0 8px 0;font-size:16px;">Hi ${greeting},</p>
      <p style="margin:0;font-size:14px;color:#64748b;">Below is the <strong>Attendance</strong>, <strong>Time by project</strong>, and <strong>Leaves</strong> ${scopeText} for ${periodLabel}.</p>
    </div>

    <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="padding:16px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;color:#1e40af;">Attendance</h2>
        <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">Status and hours per day</p>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#e0e7ff;">
              <th style="border:1px solid #c7d2fe;padding:10px 8px;text-align:left;font-weight:600;color:#3730a3;">Employee</th>
              ${dateHeaders}
              <th style="border:1px solid #c7d2fe;padding:10px 8px;text-align:center;font-weight:600;color:#3730a3;">Total</th>
            </tr>
          </thead>
          <tbody>${attendanceRows}</tbody>
        </table>
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="padding:16px 20px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;color:#166534;">Time by project</h2>
        <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">Hours logged per project per employee</p>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#dcfce7;">
              <th style="border:1px solid #bbf7d0;padding:10px 8px;text-align:left;font-weight:600;color:#166534;">Employee</th>
              <th style="border:1px solid #bbf7d0;padding:10px 8px;text-align:left;font-weight:600;color:#166534;">Project</th>
              <th style="border:1px solid #bbf7d0;padding:10px 8px;text-align:right;font-weight:600;color:#166534;">Hours</th>
            </tr>
          </thead>
          <tbody>${trackerRows}</tbody>
        </table>
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="padding:16px 20px;background:#fef3c7;border-bottom:1px solid #fde68a;">
        <h2 style="margin:0;font-size:16px;font-weight:600;color:#92400e;">Approved leaves</h2>
        <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">Leave requests approved in this period</p>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#fef9c3;">
              <th style="border:1px solid #fde68a;padding:10px 8px;text-align:left;font-weight:600;color:#92400e;">Employee</th>
              <th style="border:1px solid #fde68a;padding:10px 8px;text-align:left;font-weight:600;color:#92400e;">Leave type</th>
              <th style="border:1px solid #fde68a;padding:10px 8px;text-align:left;font-weight:600;color:#92400e;">Period</th>
              <th style="border:1px solid #fde68a;padding:10px 8px;text-align:left;font-weight:600;color:#92400e;">Reason</th>
            </tr>
          </thead>
          <tbody>${leaveRowsHtml}</tbody>
        </table>
      </div>
    </div>

    <p style="margin:0;font-size:12px;color:#94a3b8;">This is an automated report from TimeFlow. You can view full details in the app.</p>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const rawBody = await req.text()
    let body: {
      startDate?: string
      endDate?: string
      weekly?: boolean
      monthly?: boolean
      monthlyAuto?: boolean
      cronSecret?: string
    } = {}
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody)
        body = typeof parsed === 'object' && parsed !== null ? (parsed as typeof body) : {}
      } catch {
        return new Response(
          JSON.stringify({
            error:
              'Invalid JSON body. Send JSON or omit the body and use headers X-Cron-Secret + X-Cron-Report (weekly | monthly | monthlyAuto) for cron.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const cronReportMode = (req.headers.get('x-cron-report') ?? '').trim().toLowerCase()

    let role: 'admin' | 'manager'
    let authUser: { id: string } | null = null
    let profile: { role?: string; full_name?: string; email?: string; id?: string } | null = null

    const cronSecretEnv = (Deno.env.get('CRON_SECRET') ?? '').trim()
    const cronFromBody = typeof body.cronSecret === 'string' ? body.cronSecret.trim() : ''
    const cronFromHeader = (req.headers.get('x-cron-secret') ?? '').trim()
    const providedCronSecret = cronFromBody || cronFromHeader

    let wantsWeekly = body.weekly === true
    let wantsMonthly = body.monthly === true
    let wantsMonthlyAuto = body.monthlyAuto === true

    if (cronSecretEnv && providedCronSecret === cronSecretEnv) {
      // Header-based mode only for verified cron (avoid JWT clients spoofing X-Cron-Report).
      if (cronReportMode === 'weekly') wantsWeekly = true
      if (cronReportMode === 'monthly') wantsMonthly = true
      if (cronReportMode === 'monthlyauto' || cronReportMode === 'monthly_auto') wantsMonthlyAuto = true
      // Scheduled run: no JWT. Only weekly, monthly, or monthlyAuto is allowed.
      if (!wantsWeekly && !wantsMonthly && !wantsMonthlyAuto) {
        return new Response(
          JSON.stringify({
            error:
              'Scheduled run requires weekly, monthly, or monthlyAuto: set in JSON body or header X-Cron-Report (weekly | monthly | monthlyAuto).',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      role = 'admin'
    } else if (providedCronSecret) {
      // Caller intended cron auth but secret mismatch or CRON_SECRET missing on the function
      const msg = cronSecretEnv
        ? 'Invalid cronSecret (check it matches Edge Function secret CRON_SECRET exactly).'
        : 'CRON_SECRET is not set for this Edge Function. Add it under Project Settings → Edge Functions → Secrets, then redeploy send-manager-reports.'
      return new Response(JSON.stringify({ error: msg }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Missing authorization header' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: { user: userData }, error: authError } = await supabase.auth.getUser(
        authHeader.replace('Bearer ', '')
      )
      if (authError || !userData) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      authUser = userData
      const { data: profileData } = await supabase
        .from('profiles')
        .select('role, full_name, email, id')
        .eq('id', authUser.id)
        .single()
      profile = profileData as typeof profile
      role = (profile?.role === 'admin' || profile?.role === 'manager') ? profile.role : (profile?.role as 'admin' | 'manager')
      if (role !== 'admin' && role !== 'manager') {
        return new Response(
          JSON.stringify({ error: 'Only admins and managers can send reports' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const tenantId = Deno.env.get('MICROSOFT_TENANT_ID')
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')
    const fromEmail = Deno.env.get('MICROSOFT_FROM_EMAIL')
    if (!tenantId || !clientId || !clientSecret || !fromEmail) {
      return new Response(
        JSON.stringify({
          error:
            'Microsoft 365 email not configured. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_FROM_EMAIL in Supabase secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isWeekly = wantsWeekly
    const isMonthlyCron = wantsMonthly
    const isMonthlyAuto = wantsMonthlyAuto
    // Date-range report (e.g. one month): admin only. Weekly report: manager or admin. Monthly cron / monthlyAuto: no user (scheduled).
    if (!isWeekly && !isMonthlyCron && !isMonthlyAuto && role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only admins can send date-range (e.g. monthly) reports. Use "Send weekly report now" for your team.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    let start: Date
    let end: Date
    if (isWeekly) {
      const today = new Date()
      const lastMonday = startOfWeek(today, { weekStartsOn: 1 })
      const prevWeekMonday = subWeeks(lastMonday, 1)
      const prevWeekSaturday = addDays(prevWeekMonday, 5)
      start = startOfDay(prevWeekMonday)
      end = endOfDay(prevWeekSaturday)
    } else if (isMonthlyAuto) {
      // Automation: run on 1st (previous month) and 25th (current month to date). Use UTC for consistent cron behavior.
      const now = new Date()
      const dayUtc = now.getUTCDate()
      if (dayUtc === 1) {
        const prevMonth = subMonths(now, 1)
        start = startOfDay(startOfMonth(prevMonth))
        end = endOfDay(endOfMonth(prevMonth))
      } else if (dayUtc === 25 || dayUtc === 18) {
        // 25th = production; 18th = optional test day (same: current month to date)
        start = startOfDay(startOfMonth(now))
        end = endOfDay(now)
      } else {
        return new Response(
          JSON.stringify({ error: 'monthlyAuto is intended to be run only on the 1st (previous month), 18th (test), or 25th (current month to date) of the month (UTC).' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else if (isMonthlyCron) {
      const prevMonth = subMonths(new Date(), 1)
      start = startOfDay(startOfMonth(prevMonth))
      end = endOfDay(endOfMonth(prevMonth))
    } else {
      end = body.endDate ? endOfDay(parseISO(body.endDate)) : endOfDay(new Date())
      start = body.startDate ? startOfDay(parseISO(body.startDate)) : startOfDay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    }
    const startStr = format(start, 'yyyy-MM-dd')
    const endStr = format(end, 'yyyy-MM-dd')

    // Fetch HR and Payroll report recipients from system_settings
    const { data: reportSettings } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['report_hr_emails', 'report_payroll_emails'])
    const hrEmails: string[] = []
    const payrollEmails: string[] = []
    reportSettings?.forEach((row: { setting_key: string; setting_value: unknown }) => {
      const v = row.setting_value
      const arr = Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return [] } })() : [])
      const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').map((e) => String(e).trim()).filter(Boolean) : []
      if (row.setting_key === 'report_hr_emails') hrEmails.push(...list)
      if (row.setting_key === 'report_payroll_emails') payrollEmails.push(...list)
    })

    // If caller is a manager, send only to themselves. If admin (or cron), send to all managers.
    let managers: Profile[]
    if (role === 'manager' && authUser) {
      const p = profile as { id?: string; full_name?: string; email?: string } | null
      if (!p?.email?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Your profile has no email. Add an email to receive the report.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      managers = [{ id: authUser.id, full_name: p.full_name || null, email: p.email.trim(), manager_id: null, role: 'manager' }]
    } else {
      const { data: allManagers } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'manager')
        .not('email', 'is', null)
      managers = (allManagers || []) as Profile[]
    }

    const token = await getMicrosoftToken(tenantId, clientId, clientSecret)
    let sent = 0

    for (const manager of managers as Profile[]) {
      const managerEmail = manager.email!.trim()
      const { data: team } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('manager_id', manager.id)
      const teamIds = [manager.id, ...(team || []).map((t: { id: string }) => t.id)]

      const { data: timeEntries } = await supabase
        .from('time_entries')
        .select(`
          id, user_id, start_time, end_time, duration, description,
          profile:profiles!time_entries_user_id_fkey(id, full_name, email),
          project_time_entries(project_id, billable, projects(name))
        `)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())
        .in('user_id', teamIds)
        .order('start_time', { ascending: true })

      const entries = (timeEntries || []) as TimeEntry[]

      // Fetch approved leaves overlapping the period for this team
      const { data: leaveRows } = await supabase
        .from('leave_requests')
        .select('user_id, start_date, end_date, reason, leave_types(name)')
        .eq('status', 'approved')
        .lte('start_date', endStr)
        .gte('end_date', startStr)
        .in('user_id', teamIds)
      const leavesByUser = new Map<string, Array<{ start: string; end: string; typeName: string; reason: string }>>()
      ;(leaveRows || []).forEach((l: { user_id: string; start_date: string; end_date: string; reason: string; leave_types: { name: string } | null }) => {
        const list = leavesByUser.get(l.user_id) || []
        list.push({
          start: l.start_date,
          end: l.end_date,
          typeName: l.leave_types?.name || 'Leave',
          reason: l.reason || '',
        })
        leavesByUser.set(l.user_id, list)
      })

      const days = eachDayOfInterval({ start, end })
      const byUserDay = new Map<string, { hours: number; status: string }>()
      const byUserProject = new Map<string, Map<string, number>>()

      for (const entry of entries) {
        const dateStr = format(new Date(entry.start_time), 'yyyy-MM-dd')
        const key = `${entry.user_id}-${dateStr}`
        const hours = (entry.duration || 0) / 3600
        const existing = byUserDay.get(key)
        const totalHours = (existing?.hours ?? 0) + hours
        byUserDay.set(key, {
          hours: totalHours,
          status: attendanceStatus(totalHours),
        })

        const name = entry.profile?.full_name || 'Unknown'
        if (!byUserProject.has(entry.user_id)) {
          byUserProject.set(entry.user_id, new Map())
        }
        const userProj = byUserProject.get(entry.user_id)!
        const projNames = entry.project_time_entries?.map(
          (pte) => pte.projects?.name || 'Default Project'
        ) || ['Default Project']
        const n = projNames.length || 1
        const hoursPerProject = hours / n
        for (const p of projNames) {
          userProj.set(p, (userProj.get(p) || 0) + hoursPerProject)
        }
      }

      const userNames = new Map<string, string>()
      entries.forEach((e) => {
        if (e.profile?.full_name) userNames.set(e.user_id, e.profile.full_name)
      })
      teamIds.forEach((id) => {
        const p = (team || []).find((t: { id: string }) => t.id === id) || manager
        if (p && (p as Profile).full_name) userNames.set(id, (p as Profile).full_name!)
      })

      let attendanceRows = ''
      teamIds.forEach((userId, rowIndex) => {
        const name = userNames.get(userId) || 'Unknown'
        let rowCells = ''
        let weekTotal = 0
        for (const d of days) {
          const dateStr = format(d, 'yyyy-MM-dd')
          const dayKey = `${userId}-${dateStr}`
          const cell = byUserDay.get(dayKey)
          const h = cell?.hours ?? 0
          const status = cell?.status ?? 'Absent'
          weekTotal += h
          rowCells += `<td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px">${status}</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px">${h > 0 ? h.toFixed(1) + 'h' : '—'}</td>`
        }
        const rowBg = rowIndex % 2 === 1 ? 'background:#f8fafc' : ''
        attendanceRows += `<tr style="${rowBg}"><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${name}</td>${rowCells}<td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px;font-weight:600">${weekTotal > 0 ? weekTotal.toFixed(1) + 'h' : '—'}</td></tr>`
      })

      const dateHeaders = days
        .map(
          (d) =>
            `<th colspan="2" style="border:1px solid #c7d2fe;padding:8px;text-align:center;font-size:12px;font-weight:600;color:#3730a3">${format(d, 'MMM d')}</th>`
        )
        .join('')

      let trackerRows = ''
      for (const [userId, projMap] of byUserProject) {
        const name = userNames.get(userId) || 'Unknown'
        let totalH = 0
        const projects = Array.from(projMap.entries())
        projects.forEach(([p, h], i) => {
          totalH += h
          trackerRows += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${i === 0 ? name : ''}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${p}</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:right;font-size:12px">${h.toFixed(1)}h</td></tr>`
        })
        if (projects.length > 0) {
          trackerRows += `<tr style="background:#f0fdf4"><td style="border:1px solid #e2e8f0;padding:8px"></td><td style="border:1px solid #e2e8f0;padding:8px;font-weight:bold;font-size:12px">Subtotal</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:right;font-weight:bold;font-size:12px">${totalH.toFixed(1)}h</td></tr>`
        }
      }
      if (trackerRows === '') {
        trackerRows = '<tr><td colspan="3" style="padding:16px;color:#64748b;font-size:12px">No time entries in this period.</td></tr>'
      }

      let leaveRowsHtml = ''
      for (const userId of teamIds) {
        const name = userNames.get(userId) || 'Unknown'
        const userLeaves = leavesByUser.get(userId) || []
        if (userLeaves.length === 0) {
          leaveRowsHtml += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${name}</td><td colspan="3" style="border:1px solid #e2e8f0;padding:8px;color:#64748b;font-size:12px">None</td></tr>`
        } else {
          userLeaves.forEach((lev, i) => {
            leaveRowsHtml += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${i === 0 ? name : ''}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.typeName}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.start} to ${lev.end}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.reason || '—'}</td></tr>`
          })
        }
      }
      if (leaveRowsHtml === '') {
        leaveRowsHtml = '<tr><td colspan="4" style="padding:16px;color:#64748b;font-size:12px">No approved leaves in this period.</td></tr>'
      }

      if (isWeekly) {
        const subject = `TimeFlow Weekly Report: ${startStr} to ${endStr}`
        const html = buildReportHtml(manager, startStr, endStr, dateHeaders, attendanceRows, trackerRows, leaveRowsHtml, true)
        try {
          await sendGraphMail(token, fromEmail, managerEmail, subject, html)
          sent++
        } catch (e) {
          console.error(`Failed to send weekly report to ${managerEmail}:`, e)
        }
      } else {
        const subject = `TimeFlow Reports: ${startStr} to ${endStr}`
        const html = buildReportHtml(manager, startStr, endStr, dateHeaders, attendanceRows, trackerRows, leaveRowsHtml, false)
        try {
          await sendGraphMail(token, fromEmail, managerEmail, subject, html)
          sent++
        } catch (e) {
          console.error(`Failed to send to ${managerEmail}:`, e)
        }
      }
    }

    // HR and Payroll: one organization-wide report (all employees) each, no manager filter. Greeting "HR Team" / "Payroll Team".
    const allRecipientEmails = [
      ...hrEmails.map((e) => ({ email: e.trim(), label: 'HR Team' as const })),
      ...payrollEmails.map((e) => ({ email: e.trim(), label: 'Payroll Team' as const })),
    ].filter((x) => x.email)
    // Dedupe by email (if same address in both lists, send once with first label)
    const seenEmails = new Set<string>()
    const uniqueRecipients = allRecipientEmails.filter((x) => {
      if (seenEmails.has(x.email)) return false
      seenEmails.add(x.email)
      return true
    })
    if (uniqueRecipients.length > 0) {
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name')
      const teamIdsAll = (allProfiles || []).map((p: { id: string }) => p.id)
      const userNamesAll = new Map<string, string>()
      ;(allProfiles || []).forEach((p: { id: string; full_name: string | null }) => {
        if (p.full_name) userNamesAll.set(p.id, p.full_name)
      })

      const { data: timeEntriesAll } = await supabase
        .from('time_entries')
        .select(`
          id, user_id, start_time, end_time, duration, description,
          profile:profiles!time_entries_user_id_fkey(id, full_name, email),
          project_time_entries(project_id, billable, projects(name))
        `)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())
        .in('user_id', teamIdsAll)
        .order('start_time', { ascending: true })
      const entriesAll = (timeEntriesAll || []) as TimeEntry[]

      const { data: leaveRowsAll } = await supabase
        .from('leave_requests')
        .select('user_id, start_date, end_date, reason, leave_types(name)')
        .eq('status', 'approved')
        .lte('start_date', endStr)
        .gte('end_date', startStr)
        .in('user_id', teamIdsAll)
      const leavesByUserAll = new Map<string, Array<{ start: string; end: string; typeName: string; reason: string }>>()
      ;(leaveRowsAll || []).forEach((l: { user_id: string; start_date: string; end_date: string; reason: string; leave_types: { name: string } | null }) => {
        const list = leavesByUserAll.get(l.user_id) || []
        list.push({
          start: l.start_date,
          end: l.end_date,
          typeName: l.leave_types?.name || 'Leave',
          reason: l.reason || '',
        })
        leavesByUserAll.set(l.user_id, list)
      })

      const daysAll = eachDayOfInterval({ start, end })
      const byUserDayAll = new Map<string, { hours: number; status: string }>()
      const byUserProjectAll = new Map<string, Map<string, number>>()

      for (const entry of entriesAll) {
        const dateStr = format(new Date(entry.start_time), 'yyyy-MM-dd')
        const key = `${entry.user_id}-${dateStr}`
        const hours = (entry.duration || 0) / 3600
        const existing = byUserDayAll.get(key)
        const totalHours = (existing?.hours ?? 0) + hours
        byUserDayAll.set(key, {
          hours: totalHours,
          status: attendanceStatus(totalHours),
        })
        if (!byUserProjectAll.has(entry.user_id)) {
          byUserProjectAll.set(entry.user_id, new Map())
        }
        const userProj = byUserProjectAll.get(entry.user_id)!
        const projNames = entry.project_time_entries?.map(
          (pte) => pte.projects?.name || 'Default Project'
        ) || ['Default Project']
        const n = projNames.length || 1
        const hoursPerProject = hours / n
        for (const p of projNames) {
          userProj.set(p, (userProj.get(p) || 0) + hoursPerProject)
        }
      }
      entriesAll.forEach((e) => {
        if (e.profile?.full_name) userNamesAll.set(e.user_id, e.profile.full_name)
      })

      let attendanceRowsAll = ''
      teamIdsAll.forEach((userId, rowIndex) => {
        const name = userNamesAll.get(userId) || 'Unknown'
        let rowCells = ''
        let weekTotal = 0
        for (const d of daysAll) {
          const dateStr = format(d, 'yyyy-MM-dd')
          const dayKey = `${userId}-${dateStr}`
          const cell = byUserDayAll.get(dayKey)
          const h = cell?.hours ?? 0
          const status = cell?.status ?? 'Absent'
          weekTotal += h
          rowCells += `<td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px">${status}</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px">${h > 0 ? h.toFixed(1) + 'h' : '—'}</td>`
        }
        const rowBg = rowIndex % 2 === 1 ? 'background:#f8fafc' : ''
        attendanceRowsAll += `<tr style="${rowBg}"><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${name}</td>${rowCells}<td style="border:1px solid #e2e8f0;padding:8px;text-align:center;font-size:12px;font-weight:600">${weekTotal > 0 ? weekTotal.toFixed(1) + 'h' : '—'}</td></tr>`
      })

      const dateHeadersAll = daysAll
        .map(
          (d) =>
            `<th colspan="2" style="border:1px solid #c7d2fe;padding:8px;text-align:center;font-size:12px;font-weight:600;color:#3730a3">${format(d, 'MMM d')}</th>`
        )
        .join('')

      let trackerRowsAll = ''
      for (const [userId, projMap] of byUserProjectAll) {
        const name = userNamesAll.get(userId) || 'Unknown'
        let totalH = 0
        const projects = Array.from(projMap.entries())
        projects.forEach(([p, h], i) => {
          totalH += h
          trackerRowsAll += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${i === 0 ? name : ''}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${p}</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:right;font-size:12px">${h.toFixed(1)}h</td></tr>`
        })
        if (projects.length > 0) {
          trackerRowsAll += `<tr style="background:#f0fdf4"><td style="border:1px solid #e2e8f0;padding:8px"></td><td style="border:1px solid #e2e8f0;padding:8px;font-weight:bold;font-size:12px">Subtotal</td><td style="border:1px solid #e2e8f0;padding:8px;text-align:right;font-weight:bold;font-size:12px">${totalH.toFixed(1)}h</td></tr>`
        }
      }
      if (trackerRowsAll === '') {
        trackerRowsAll = '<tr><td colspan="3" style="padding:16px;color:#64748b;font-size:12px">No time entries in this period.</td></tr>'
      }

      let leaveRowsHtmlAll = ''
      for (const userId of teamIdsAll) {
        const name = userNamesAll.get(userId) || 'Unknown'
        const userLeaves = leavesByUserAll.get(userId) || []
        if (userLeaves.length === 0) {
          leaveRowsHtmlAll += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${name}</td><td colspan="3" style="border:1px solid #e2e8f0;padding:8px;color:#64748b;font-size:12px">None</td></tr>`
        } else {
          userLeaves.forEach((lev, i) => {
            leaveRowsHtmlAll += `<tr><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${i === 0 ? name : ''}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.typeName}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.start} to ${lev.end}</td><td style="border:1px solid #e2e8f0;padding:8px;font-size:12px">${lev.reason || '—'}</td></tr>`
          })
        }
      }
      if (leaveRowsHtmlAll === '') {
        leaveRowsHtmlAll = '<tr><td colspan="4" style="padding:16px;color:#64748b;font-size:12px">No approved leaves in this period.</td></tr>'
      }

      const dummyProfile: Profile = { id: '', full_name: null, email: null, manager_id: null, role: 'employee' }
      const subjectHrPayroll = isWeekly
        ? `TimeFlow Weekly Report (All employees): ${startStr} to ${endStr}`
        : `TimeFlow Reports (All employees): ${startStr} to ${endStr}`

      for (const { email: toEmail, label } of uniqueRecipients) {
        const html = buildReportHtml(
          dummyProfile,
          startStr,
          endStr,
          dateHeadersAll,
          attendanceRowsAll,
          trackerRowsAll,
          leaveRowsHtmlAll,
          isWeekly,
          label,
          true
        )
        try {
          await sendGraphMail(token, fromEmail, toEmail, subjectHrPayroll, html)
          sent++
        } catch (e) {
          console.error(`Failed to send all-employees report to ${toEmail}:`, e)
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: isWeekly
          ? `Weekly reports sent to ${sent} recipient(s).`
          : `Reports sent to ${sent} recipient(s) (managers and HR/Payroll if configured).`,
        sent,
        period: { startDate: startStr, endDate: endStr },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
