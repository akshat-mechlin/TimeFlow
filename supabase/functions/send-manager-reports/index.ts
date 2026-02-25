// Send attendance and tracker reports to each manager via Microsoft 365 (Graph API)
// Requires: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_FROM_EMAIL
// Invoke with body: { startDate?: string (YYYY-MM-DD), endDate?: string (YYYY-MM-DD) }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { format, parseISO, startOfDay, endOfDay, eachDayOfInterval } from 'https://esm.sh/date-fns@3.0.6'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
      .select('role, full_name, email')
      .eq('id', authUser.id)
      .single()
    const role = (profile as { role?: string; full_name?: string; email?: string } | null)?.role
    if (role !== 'admin' && role !== 'manager') {
      return new Response(
        JSON.stringify({ error: 'Only admins and managers can send reports' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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

    const body = (await req.json().catch(() => ({}))) as { startDate?: string; endDate?: string }
    const end = body.endDate
      ? endOfDay(parseISO(body.endDate))
      : endOfDay(new Date())
    const start = body.startDate
      ? startOfDay(parseISO(body.startDate))
      : startOfDay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
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
    const extraRecipients = [...new Set([...hrEmails, ...payrollEmails])]

    // If caller is a manager, send only to themselves. If admin, send to all managers.
    let managers: Profile[]
    if (role === 'manager') {
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
      if (!allManagers || allManagers.length === 0) {
        return new Response(
          JSON.stringify({ message: 'No managers with email found.', sent: 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      managers = allManagers as Profile[]
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
      for (const userId of teamIds) {
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
          rowCells += `<td style="border:1px solid #ddd;padding:6px;text-align:center">${status}</td><td style="border:1px solid #ddd;padding:6px;text-align:center">${h > 0 ? h.toFixed(1) + 'h' : '—'}</td>`
        }
        attendanceRows += `<tr><td style="border:1px solid #ddd;padding:6px">${name}</td>${rowCells}<td style="border:1px solid #ddd;padding:6px;text-align:center">${weekTotal > 0 ? weekTotal.toFixed(1) + 'h' : '—'}</td></tr>`
      }

      const dateHeaders = days
        .map(
          (d) =>
            `<th colspan="2" style="border:1px solid #ddd;padding:6px">${format(d, 'MMM d')}</th>`
        )
        .join('')

      let trackerRows = ''
      for (const [userId, projMap] of byUserProject) {
        const name = userNames.get(userId) || 'Unknown'
        let totalH = 0
        const projects = Array.from(projMap.entries())
        projects.forEach(([p, h], i) => {
          totalH += h
          trackerRows += `<tr><td style="border:1px solid #ddd;padding:6px">${i === 0 ? name : ''}</td><td style="border:1px solid #ddd;padding:6px">${p}</td><td style="border:1px solid #ddd;padding:6px;text-align:right">${h.toFixed(1)}h</td></tr>`
        })
        if (projects.length > 0) {
          trackerRows += `<tr style="background:#f8fafc"><td style="border:1px solid #ddd;padding:6px"></td><td style="border:1px solid #ddd;padding:6px;font-weight:bold">Subtotal</td><td style="border:1px solid #ddd;padding:6px;text-align:right;font-weight:bold">${totalH.toFixed(1)}h</td></tr>`
        }
      }
      if (trackerRows === '') {
        trackerRows = '<tr><td colspan="3" style="padding:12px;color:#666">No time entries in this period.</td></tr>'
      }

      let leaveRowsHtml = ''
      for (const userId of teamIds) {
        const name = userNames.get(userId) || 'Unknown'
        const userLeaves = leavesByUser.get(userId) || []
        if (userLeaves.length === 0) {
          leaveRowsHtml += `<tr><td style="border:1px solid #ddd;padding:6px">${name}</td><td colspan="3" style="border:1px solid #ddd;padding:6px;color:#666">None</td></tr>`
        } else {
          userLeaves.forEach((lev, i) => {
            leaveRowsHtml += `<tr><td style="border:1px solid #ddd;padding:6px">${i === 0 ? name : ''}</td><td style="border:1px solid #ddd;padding:6px">${lev.typeName}</td><td style="border:1px solid #ddd;padding:6px">${lev.start} to ${lev.end}</td><td style="border:1px solid #ddd;padding:6px">${lev.reason || '—'}</td></tr>`
          })
        }
      }
      if (leaveRowsHtml === '') {
        leaveRowsHtml = '<tr><td colspan="4" style="padding:12px;color:#666">No approved leaves in this period.</td></tr>'
      }

      const subject = `TimeFlow Reports: ${startStr} to ${endStr}`
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;color:#333">
  <h1 style="color:#2563eb">TimeFlow Reports</h1>
  <p>Hi ${manager.full_name || 'Manager'},</p>
  <p>Please find below the <strong>Attendance</strong> and <strong>Tracker</strong> reports for your team for the period <strong>${startStr}</strong> to <strong>${endStr}</strong>.</p>

  <h2 style="color:#1e40af;margin-top:28px">Attendance Report</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="border:1px solid #ddd;padding:8px">Employee</th>
        ${dateHeaders}
        <th style="border:1px solid #ddd;padding:8px">Total</th>
      </tr>
    </thead>
    <tbody>${attendanceRows}</tbody>
  </table>

  <h2 style="color:#1e40af;margin-top:28px">Tracker Report (Time by project)</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="border:1px solid #ddd;padding:8px">Employee</th>
        <th style="border:1px solid #ddd;padding:8px">Project</th>
        <th style="border:1px solid #ddd;padding:8px">Hours</th>
      </tr>
    </thead>
    <tbody>${trackerRows}</tbody>
  </table>

  <h2 style="color:#1e40af;margin-top:28px">Leaves (approved)</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="border:1px solid #ddd;padding:8px">Employee</th>
        <th style="border:1px solid #ddd;padding:8px">Leave type</th>
        <th style="border:1px solid #ddd;padding:8px">Period</th>
        <th style="border:1px solid #ddd;padding:8px">Reason</th>
      </tr>
    </thead>
    <tbody>${leaveRowsHtml}</tbody>
  </table>

  <p style="margin-top:28px;font-size:12px;color:#64748b">This is an automated email from TimeFlow. You can view full reports in the app.</p>
</body>
</html>`

      try {
        await sendGraphMail(token, fromEmail, managerEmail, subject, html)
        sent++
      } catch (e) {
        console.error(`Failed to send to ${managerEmail}:`, e)
      }
      for (const toEmail of extraRecipients) {
        if (!toEmail || toEmail === managerEmail) continue
        try {
          await sendGraphMail(token, fromEmail, toEmail, subject, html)
          sent++
        } catch (e) {
          console.error(`Failed to send to ${toEmail}:`, e)
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: `Reports sent to ${sent} manager(s).`,
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
