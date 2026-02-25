// Weekly manager reports: runs on schedule (e.g. every Monday) or manually by admin.
// Sends previous week (Mon–Sat) report as HTML + Excel to each manager and to HR/Payroll.
// Invoke: POST with Authorization Bearer <admin JWT> OR body: { cronSecret: "<CRON_SECRET>" }
// Requires: MICROSOFT_* secrets, optional CRON_SECRET for scheduled runs

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import {
  format,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  startOfWeek,
  subWeeks,
  addDays,
} from 'https://esm.sh/date-fns@3.0.6'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function sendGraphMailWithAttachment(
  token: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  htmlBody: string,
  attachmentName: string,
  attachmentBase64: string,
  contentType: string
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
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: attachmentName,
            contentType,
            contentBytes: attachmentBase64,
          },
        ],
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let isCron = false
    const body = (await req.json().catch(() => ({}))) as { cronSecret?: string }
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret && body.cronSecret === cronSecret) {
      isCron = true
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Missing authorization or cron secret' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(
        authHeader.replace('Bearer ', '')
      )
      if (authError || !authUser) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authUser.id)
        .single()
      const role = (profile as { role?: string } | null)?.role
      if (role !== 'admin') {
        return new Response(
          JSON.stringify({ error: 'Only admins can trigger weekly reports manually' }),
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
            'Microsoft 365 email not configured. Set MICROSOFT_* secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Previous week: Monday 00:00 to Saturday 23:59
    const today = new Date()
    const lastMonday = startOfWeek(today, { weekStartsOn: 1 })
    const prevWeekMonday = subWeeks(lastMonday, 1)
    const prevWeekSaturday = addDays(prevWeekMonday, 5)
    const start = startOfDay(prevWeekMonday)
    const end = endOfDay(prevWeekSaturday)
    const startStr = format(start, 'yyyy-MM-dd')
    const endStr = format(end, 'yyyy-MM-dd')

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
    const extraRecipients = [...new Set([...hrEmails, ...payrollEmails])]

    const { data: allManagers } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'manager')
      .not('email', 'is', null)
    const managers = (allManagers || []) as Profile[]

    if (managers.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No managers with email found.', sent: 0, period: { startStr, endStr } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = await getMicrosoftToken(tenantId, clientId, clientSecret)
    const days = eachDayOfInterval({ start, end })
    const dayNames = days.map((d) => format(d, 'EEE'))
    let sent = 0

    for (const manager of managers) {
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

      const byUserDay = new Map<string, { hours: number; status: string }>()
      const byUserProject = new Map<string, Map<string, number>>()
      const userNames = new Map<string, string>()

      teamIds.forEach((id) => {
        const p = (team || []).find((t: { id: string }) => t.id === id) || manager
        if (p && (p as Profile).full_name) userNames.set(id, (p as Profile).full_name!)
      })
      entries.forEach((e) => {
        if (e.profile?.full_name) userNames.set(e.user_id, e.profile.full_name)
      })

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

      // Build Excel sheets
      const wb = XLSX.utils.book_new()

      // Sheet 1: Summary (Employee, Total Week Hours)
      const summaryData: (string | number)[][] = [['Employee', 'Total Week Hours']]
      for (const userId of teamIds) {
        const name = userNames.get(userId) || 'Unknown'
        let weekTotal = 0
        for (const d of days) {
          const dateStr = format(d, 'yyyy-MM-dd')
          const cell = byUserDay.get(`${userId}-${dateStr}`)
          weekTotal += cell?.hours ?? 0
        }
        summaryData.push([name, Math.round(weekTotal * 100) / 100])
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary')

      // Sheet 2: Project-wise
      const projData: (string | number)[][] = [['Employee', 'Project', 'Hours']]
      for (const [userId, projMap] of byUserProject) {
        const name = userNames.get(userId) || 'Unknown'
        for (const [projName, h] of projMap) {
          projData.push([name, projName, Math.round(h * 100) / 100])
        }
      }
      if (projData.length === 1) projData.push(['No entries', '', ''])
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projData), 'Project-wise')

      // Sheet 3: Leaves
      const leaveData: string[][] = [['Employee', 'Leave Type', 'Start', 'End', 'Reason']]
      for (const userId of teamIds) {
        const name = userNames.get(userId) || 'Unknown'
        const userLeaves = leavesByUser.get(userId) || []
        if (userLeaves.length === 0) {
          leaveData.push([name, 'None', '', '', ''])
        } else {
          userLeaves.forEach((lev) => {
            leaveData.push([name, lev.typeName, lev.start, lev.end, lev.reason || ''])
          })
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(leaveData), 'Leaves')

      // Sheet 4: Day-wise (Mon–Sat)
      const dayWiseHeader = ['Employee', ...dayNames, 'Total']
      const dayWiseData: (string | number)[][] = [dayWiseHeader]
      for (const userId of teamIds) {
        const name = userNames.get(userId) || 'Unknown'
        const row: (string | number)[] = [name]
        let total = 0
        for (const d of days) {
          const dateStr = format(d, 'yyyy-MM-dd')
          const cell = byUserDay.get(`${userId}-${dateStr}`)
          const h = cell?.hours ?? 0
          total += h
          row.push(Math.round(h * 100) / 100)
        }
        row.push(Math.round(total * 100) / 100)
        dayWiseData.push(row)
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dayWiseData), 'Day-wise')

      const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
      const attachmentName = `TimeFlow_Report_${startStr}_to_${endStr}.xlsx`

      const subject = `TimeFlow Weekly Report: ${startStr} to ${endStr}`
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;color:#333">
  <h1 style="color:#2563eb">TimeFlow Weekly Report</h1>
  <p>Hi ${manager.full_name || 'Manager'},</p>
  <p>Please find attached the <strong>Excel report</strong> for your team for the week <strong>${startStr}</strong> to <strong>${endStr}</strong> (Monday–Saturday).</p>
  <p>The attachment contains:</p>
  <ul>
    <li><strong>Summary</strong> – Total week hours per employee</li>
    <li><strong>Project-wise</strong> – Hours per project per employee</li>
    <li><strong>Leaves</strong> – Approved leaves in the period</li>
    <li><strong>Day-wise</strong> – Hours per day (Mon–Sat) per employee</li>
  </ul>
  <p style="margin-top:28px;font-size:12px;color:#64748b">This is an automated weekly report from TimeFlow.</p>
</body>
</html>`

      const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const recipients = [managerEmail, ...extraRecipients.filter((e) => e !== managerEmail)]
      for (const toEmail of recipients) {
        try {
          await sendGraphMailWithAttachment(
            token,
            fromEmail,
            toEmail,
            subject,
            html,
            attachmentName,
            xlsxBase64,
            contentType
          )
          sent++
        } catch (e) {
          console.error(`Failed to send weekly report to ${toEmail}:`, e)
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: `Weekly reports sent to ${sent} recipient(s).`,
        sent,
        period: { startDate: startStr, endDate: endStr },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
