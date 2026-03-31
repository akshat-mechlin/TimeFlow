import { format } from 'date-fns'
import jsPDF from 'jspdf'
import type { HubCsvRow } from './teamUpdatesHub'

const PRIMARY: [number, number, number] = [79, 70, 229]
const SLATE: [number, number, number] = [30, 41, 59]
const SLATE_MUTED: [number, number, number] = [71, 85, 105]
const CARD_BG: [number, number, number] = [248, 250, 252]
const BORDER: [number, number, number] = [226, 232, 240]
const ACCENT: [number, number, number] = [99, 102, 241]

function splitLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  const t = text.replace(/\r\n/g, '\n').trim() || '—'
  const lines = doc.splitTextToSize(t, maxWidth)
  return Array.isArray(lines) ? lines : [lines]
}

function measureUpdateBlock(doc: jsPDF, u: HubCsvRow, innerW: number): number {
  let h = 10
  h += 5
  if (u.title?.trim()) h += 6
  const metaParts = [
    u.template?.template_type ? `Type: ${u.template.template_type}` : '',
    u.projects?.name ? `Project: ${u.projects.name}` : '',
    u.tags?.length ? `Tags: ${u.tags.join(', ')}` : '',
  ].filter(Boolean)
  const meta = metaParts.join('   ')
  if (meta) {
    h += splitLines(doc, meta, innerW).length * 4 + 2
  }
  h += splitLines(doc, u.body ?? '', innerW).length * 4.15 + 2
  if (u.author?.email) h += 4.5
  h += 8
  return h
}

/**
 * Landscape PDF export: branded header, summary panel, and card-style entries.
 */
export function downloadCommunicationHubPdf(opts: {
  updates: HubCsvRow[]
  teamHubName: string
  exportedByName: string
  filterLines: string[]
}): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const margin = 14
  const cw = pw - 2 * margin
  const innerW = cw - 14

  let y = margin

  const drawHeaderBand = () => {
    doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2])
    doc.rect(0, 0, pw, 30, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(17)
    doc.setFont('helvetica', 'bold')
    doc.text('Communication Hub', margin, 14)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('Team updates report', margin, 21)
    const rightY1 = 13
    const rightY2 = 19
    const rightY3 = 25
    doc.text(`Generated ${format(new Date(), 'MMM d, yyyy · h:mm a')}`, pw - margin, rightY1, { align: 'right' })
    doc.text(`Team hub: ${opts.teamHubName}`, pw - margin, rightY2, { align: 'right' })
    doc.text(`${opts.updates.length} update(s)`, pw - margin, rightY3, { align: 'right' })
  }

  drawHeaderBand()
  y = 38

  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2])
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary', margin, y)
  y += 6

  doc.setFillColor(CARD_BG[0], CARD_BG[1], CARD_BG[2])
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2])
  const summaryText = [
    `Exported by: ${opts.exportedByName}`,
    opts.filterLines.length
      ? `Active filters: ${opts.filterLines.join('  ·  ')}`
      : 'Active filters: none (all visible updates in this hub)',
  ]
  let summaryH = 10
  for (const line of summaryText) {
    summaryH += splitLines(doc, line, cw - 10).length * 4.2
  }
  summaryH += 6
  doc.roundedRect(margin, y - 4, cw, summaryH, 2, 2, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(SLATE_MUTED[0], SLATE_MUTED[1], SLATE_MUTED[2])
  let sy = y + 4
  for (const line of summaryText) {
    const lines = splitLines(doc, line, cw - 10)
    doc.text(lines, margin + 5, sy)
    sy += lines.length * 4.2
  }
  y += summaryH + 8

  const ensureSpace = (needed: number) => {
    if (y + needed <= ph - margin - 10) return
    doc.addPage()
    y = margin
    doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2])
    doc.rect(0, 0, pw, 11, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Communication Hub (continued)', margin, 7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2])
    y = 16
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Updates', margin, y)
  y += 8

  for (const u of opts.updates) {
    const blockH = measureUpdateBlock(doc, u, innerW)
    ensureSpace(blockH)

    doc.setFillColor(CARD_BG[0], CARD_BG[1], CARD_BG[2])
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2])
    doc.roundedRect(margin, y, cw, blockH, 2, 2, 'FD')

    let cy = y + 8
    const x0 = margin + 7

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2])
    const when = u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy · HH:mm') : '—'
    const who = u.author?.full_name ?? 'Unknown'
    doc.text(`${when}   ·   ${who}`, x0, cy)
    cy += 5.5

    if (u.title?.trim()) {
      doc.setFontSize(10)
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2])
      doc.text(u.title.trim(), x0, cy)
      cy += 6
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(SLATE_MUTED[0], SLATE_MUTED[1], SLATE_MUTED[2])
    const metaParts = [
      u.template?.template_type ? `Type: ${u.template.template_type}` : '',
      u.projects?.name ? `Project: ${u.projects.name}` : '',
      u.tags?.length ? `Tags: ${u.tags.join(', ')}` : '',
    ].filter(Boolean)
    if (metaParts.length) {
      const metaLines = splitLines(doc, metaParts.join('   '), innerW)
      doc.text(metaLines, x0, cy)
      cy += metaLines.length * 4 + 2
    }

    doc.setFontSize(9)
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2])
    const bodyLines = splitLines(doc, u.body ?? '', innerW)
    doc.text(bodyLines, x0, cy)
    cy += bodyLines.length * 4.15 + 2

    if (u.author?.email) {
      doc.setFontSize(7.5)
      doc.setTextColor(148, 163, 184)
      doc.text(u.author.email, x0, cy)
    }

    y += blockH + 5
  }

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5)
    doc.setTextColor(148, 163, 184)
    doc.setFont('helvetica', 'normal')
    doc.text(`TimeFlow · Communication Hub · Page ${p} of ${totalPages}`, pw / 2, ph - 6, { align: 'center' })
  }

  doc.save(`communication-hub-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`)
}
