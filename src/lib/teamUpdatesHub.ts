import { format } from 'date-fns'

export type TemplatePlaceholders = {
  userName: string
  departmentName: string
  projectName?: string
  date: Date
}

const PLACEHOLDER_KEYS = [
  ['{User Name}', (p: TemplatePlaceholders) => p.userName],
  ['{Department}', (p: TemplatePlaceholders) => p.departmentName],
  ['{Project}', (p: TemplatePlaceholders) => p.projectName ?? ''],
  ['{Date}', (p: TemplatePlaceholders) => format(p.date, 'MMMM d, yyyy')],
  ['{Day}', (p: TemplatePlaceholders) => format(p.date, 'EEEE')],
] as const

export function applyTemplatePlaceholders(template: string, ctx: TemplatePlaceholders): string {
  let out = template
  for (const [key, fn] of PLACEHOLDER_KEYS) {
    out = out.split(key).join(fn(ctx))
  }
  return out
}

export function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
}

export function extractHashtagsFromBody(body: string): string[] {
  const matches = body.match(/#([\w-]+)/g)
  if (!matches) return []
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))]
}

/** Fixed title for in-app EOD reminder notifications (dedupe by title + day). */
export const HUB_EOD_NOTIFICATION_TITLE = 'EOD team update reminder'

export function csvEscape(value: string | null | undefined): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export type HubCsvRow = {
  created_at: string | null
  author?: { full_name?: string | null; email?: string | null } | null
  title: string | null
  body: string
  tags: string[] | null
  projects?: { name: string } | null
  template?: { template_type: string } | null
}

export function buildCommunicationHubCsv(rows: HubCsvRow[]): string {
  const headers = ['Created', 'Author', 'Email', 'Title', 'Template type', 'Project', 'Tags', 'Body']
  const lines = [headers.join(',')]
  for (const u of rows) {
    lines.push(
      [
        csvEscape(u.created_at ? format(new Date(u.created_at), 'yyyy-MM-dd HH:mm') : ''),
        csvEscape(u.author?.full_name ?? ''),
        csvEscape(u.author?.email ?? ''),
        csvEscape(u.title ?? ''),
        csvEscape(u.template?.template_type ?? ''),
        csvEscape(u.projects?.name ?? ''),
        csvEscape((u.tags ?? []).join('; ')),
        csvEscape(u.body),
      ].join(','),
    )
  }
  return lines.join('\r\n')
}

export function downloadCsvFile(content: string, filename: string) {
  const bom = '\ufeff'
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
