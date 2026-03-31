import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, startOfDay, endOfDay } from 'date-fns'
import {
  MessageSquare,
  Send,
  RefreshCw,
  Sparkles,
  Hash,
  FolderKanban,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  ClipboardList,
  Pencil,
  Trash2,
  X,
  Filter,
  Download,
  FileText,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import Loader from '../components/Loader'
import { useToast } from '../contexts/ToastContext'
import {
  applyTemplatePlaceholders,
  buildCommunicationHubCsv,
  downloadCsvFile,
  extractHashtagsFromBody,
  HUB_EOD_NOTIFICATION_TITLE,
  parseTagInput,
  type TemplatePlaceholders,
} from '../lib/teamUpdatesHub'
import { notifySystem } from '../lib/notifications'
import { downloadCommunicationHubPdf } from '../lib/communicationHubPdf'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type HubDepartment = Tables<'hub_departments'>
type HubTemplate = Tables<'hub_update_templates'>
type HubUpdate = Tables<'hub_team_updates'>
type HubComment = Tables<'hub_team_update_comments'>

interface TeamUpdatesHubProps {
  user: Profile
}

type HubTemplateType = Tables<'hub_update_templates'>['template_type']
type HubViewTab = 'compose' | 'feed' | 'templates'

type UpdateRow = HubUpdate & {
  author: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  department: Pick<HubDepartment, 'id' | 'name' | 'code'> | null
  projects: { name: string } | null
  template: { template_type: HubTemplateType; name: string } | null
}

/** High-contrast fields for dark mode (explicit text + placeholder colors). */
const fieldClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400'

const labelClass = 'text-xs font-semibold text-gray-800 dark:text-gray-100 mb-1'

function profileBelongsToHubDept(profileTeam: string | null | undefined, dept: HubDepartment): boolean {
  if (dept.code === 'general') return !profileTeam || profileTeam.trim() === ''
  return (profileTeam ?? '').trim().toLowerCase() === dept.name.trim().toLowerCase()
}

export default function TeamUpdatesHub({ user }: TeamUpdatesHubProps) {
  const { showSuccess, showError } = useToast()
  const [schemaReady, setSchemaReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<HubDepartment[]>([])
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<HubTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [updates, setUpdates] = useState<UpdateRow[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [workHints, setWorkHints] = useState<string>('')
  const [filterTag, setFilterTag] = useState('')
  const [filterUserId, setFilterUserId] = useState('')
  const [filterProjectId, setFilterProjectId] = useState('')
  const [filterTemplateType, setFilterTemplateType] = useState<HubTemplateType | ''>('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [authorOptions, setAuthorOptions] = useState<{ id: string; full_name: string }[]>([])
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [templateForm, setTemplateForm] = useState<{
    id: string | null
    name: string
    template_type: HubTemplateType
    body: string
  } | null>(null)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [commentsByUpdate, setCommentsByUpdate] = useState<Record<string, (HubComment & { author: Pick<Profile, 'full_name'> | null })[]>>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [activeTab, setActiveTab] = useState<HubViewTab>('compose')

  const activeDept = useMemo(() => departments.find((d) => d.id === departmentId) ?? null, [departments, departmentId])

  const isAdmin = user.role === 'admin'
  const canManageTemplates =
    isAdmin || user.role === 'manager' || user.role === 'hr'

  const placeholderCtx = useMemo((): TemplatePlaceholders | null => {
    if (!activeDept) return null
    const projectName = projects.find((p) => p.id === projectId)?.name
    return {
      userName: user.full_name,
      departmentName: activeDept.name,
      projectName,
      date: new Date(),
    }
  }, [activeDept, user.full_name, projects, projectId])

  const loadProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('project_id, projects(id, name)')
      .eq('user_id', user.id)
    if (error) {
      console.error(error)
      return
    }
    const list =
      data
        ?.map((row) => {
          const p = row.projects as { id: string; name: string } | null
          return p ? { id: p.id, name: p.name } : null
        })
        .filter(Boolean) as { id: string; name: string }[]
    setProjects(list)
  }, [user.id])

  const loadWorkHints = useCallback(async () => {
    const start = startOfDay(new Date()).toISOString()
    const { data, error } = await supabase
      .from('time_entries')
      .select('description, duration')
      .eq('user_id', user.id)
      .gte('start_time', start)
      .order('start_time', { ascending: false })
      .limit(12)
    if (error) {
      console.error(error)
      return
    }
    const bullets =
      data
        ?.filter((e) => e.description && (e.duration ?? 0) > 0)
        .map((e) => `• ${e.description}`) ?? []
    if (bullets.length) {
      setWorkHints(['Today from your time tracker (suggested bullets):', ...bullets].join('\n'))
    } else {
      setWorkHints('')
    }
  }, [user.id])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    try {
      const { error: rpcError } = await supabase.rpc('hub_ensure_department_membership')
      if (rpcError) {
        if (rpcError.message?.includes('schema cache') || rpcError.code === 'PGRST202') {
          setSchemaReady(false)
          return
        }
        throw rpcError
      }

      const { data: depts, error: deptErr } = await supabase.from('hub_departments').select('*').order('name')
      if (deptErr) throw deptErr
      const list = depts ?? []
      setDepartments(list)

      const ut = user.team?.trim() ?? ''
      setDepartmentId((prev) => {
        if (!list.length) return null
        if (prev && list.some((d) => d.id === prev)) return prev
        if (ut) {
          const byTeam = list.find(
            (d) => d.name.trim().toLowerCase() === ut.toLowerCase() || d.code === ut.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          )
          if (byTeam) return byTeam.id
        }
        return list.find((d) => d.code === 'general')?.id ?? list[0].id
      })

      await loadProjects()
      await loadWorkHints()
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('hub_') || msg.includes('does not exist')) {
        setSchemaReady(false)
      }
    } finally {
      setLoading(false)
    }
  }, [user.id, loadProjects, loadWorkHints])

  /** Same visibility rules as Team Members: employees see only themselves; managers/HR see their reporting tree; admins see all — then filter by hub team bucket. */
  const loadAuthorFilterOptions = useCallback(async () => {
    if (!departmentId) return
    const dept = departments.find((d) => d.id === departmentId)
    if (!dept) return

    try {
      let query = supabase.from('profiles').select('id, full_name, team')

      if (user.role === 'employee') {
        query = query.eq('id', user.id)
      } else if (user.role === 'manager' || user.role === 'hr') {
        const { data: direct } = await supabase.from('profiles').select('id').eq('manager_id', user.id)
        const ids = [user.id, ...(direct?.map((r) => r.id) ?? [])]
        query = query.in('id', ids)
      }

      const { data, error } = await query.order('full_name')
      if (error) throw error

      const filtered = (data ?? []).filter((p) => profileBelongsToHubDept(p.team, dept))
      setAuthorOptions(filtered.map((p) => ({ id: p.id, full_name: p.full_name })))
    } catch (e) {
      console.error(e)
    }
  }, [departmentId, departments, user.id, user.role])

  const loadTemplates = useCallback(async () => {
    if (!departmentId) return
    const { data, error } = await supabase
      .from('hub_update_templates')
      .select('*')
      .or(`department_id.eq.${departmentId},department_id.is.null`)
      .order('is_system', { ascending: false })
    if (error) {
      console.error(error)
      return
    }
    setTemplates(data ?? [])
    const daily = data?.find((t) => t.template_type === 'daily')
    setSelectedTemplateId(daily?.id ?? data?.[0]?.id ?? null)
  }, [departmentId])

  const loadUpdates = useCallback(async () => {
    if (!departmentId) return
    const { data, error } = await supabase
      .from('hub_team_updates')
      .select(
        `
        *,
        author:profiles!hub_team_updates_user_id_fkey(id, full_name, email),
        department:hub_departments!hub_team_updates_department_id_fkey(id, name, code),
        projects(name),
        template:hub_update_templates!hub_team_updates_template_id_fkey(template_type, name)
      `,
      )
      .eq('department_id', departmentId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(80)
    if (error) {
      console.error(error)
      return
    }
    setUpdates((data ?? []) as UpdateRow[])
  }, [departmentId])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (departmentId) {
      loadTemplates()
      loadUpdates()
      loadAuthorFilterOptions()
    }
  }, [departmentId, loadTemplates, loadUpdates, loadAuthorFilterOptions])

  /** In-app EOD nudge: one system notification per local day if user has no hub post today (any accessible hub). */
  useEffect(() => {
    if (!schemaReady || loading || !departmentId) return
    let cancelled = false
    const run = async () => {
      const dayStart = startOfDay(new Date()).toISOString()
      const dayEnd = endOfDay(new Date()).toISOString()
      try {
        const { count: posted, error: e1 } = await supabase
          .from('hub_team_updates')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd)
        if (cancelled || e1 || (posted ?? 0) > 0) return

        const { count: already, error: e2 } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('type', 'system')
          .eq('title', HUB_EOD_NOTIFICATION_TITLE)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd)
        if (cancelled || e2 || (already ?? 0) > 0) return

        await notifySystem(
          user.id,
          HUB_EOD_NOTIFICATION_TITLE,
          'You have not posted a Communication Hub update today. Submit one from the Communication Hub when you are ready.',
        )
      } catch (err) {
        console.error('EOD hub reminder:', err)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [schemaReady, loading, departmentId, user.id])

  useEffect(() => {
    const t = templates.find((x) => x.id === selectedTemplateId)
    if (!t || !placeholderCtx) return
    setBody(applyTemplatePlaceholders(t.body, placeholderCtx))
  }, [selectedTemplateId, templates, placeholderCtx])

  const applyWorkHints = () => {
    if (!workHints) return
    setBody((prev) => (prev ? `${prev}\n\n${workHints}` : workHints))
  }

  const submitUpdate = async () => {
    if (!departmentId || !body.trim()) return
    setPosting(true)
    try {
      const fromInput = parseTagInput(tagInput)
      const fromBody = extractHashtagsFromBody(body)
      const tags = [...new Set([...fromInput, ...fromBody].map((t) => t.toLowerCase()))]
      const { error } = await supabase.from('hub_team_updates').insert({
        department_id: departmentId,
        user_id: user.id,
        template_id: selectedTemplateId,
        project_id: projectId || null,
        title: title.trim() || null,
        body: body.trim(),
        tags,
        status: 'published',
      })
      if (error) throw error
      showSuccess('Update posted')
      setTitle('')
      setTagInput('')
      await loadUpdates()
      const tpl = templates.find((x) => x.id === selectedTemplateId)
      if (tpl && placeholderCtx) {
        setBody(applyTemplatePlaceholders(tpl.body, placeholderCtx))
      }
    } catch (e) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Could not post update')
    } finally {
      setPosting(false)
    }
  }

  const loadComments = async (updateId: string) => {
    const { data, error } = await supabase
      .from('hub_team_update_comments')
      .select('*, author:profiles!hub_team_update_comments_user_id_fkey(full_name)')
      .eq('update_id', updateId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error(error)
      return
    }
    setCommentsByUpdate((prev) => ({ ...prev, [updateId]: (data ?? []) as typeof prev[string] }))
  }

  const toggleThread = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setCommentDraft('')
    if (!commentsByUpdate[id]) void loadComments(id)
  }

  const postComment = async (updateId: string) => {
    const text = commentDraft.trim()
    if (!text) return
    const { error } = await supabase.from('hub_team_update_comments').insert({
      update_id: updateId,
      user_id: user.id,
      body: text,
    })
    if (error) {
      console.error(error)
      showError(error.message)
      return
    }
    showSuccess('Reply posted')
    setCommentDraft('')
    await loadComments(updateId)
  }

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    updates.forEach((u) => {
      if (u.project_id && u.projects?.name) map.set(u.project_id, u.projects.name)
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [updates])

  const filteredUpdates = useMemo(() => {
    return updates.filter((u) => {
      if (filterTag && !u.tags?.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))) {
        return false
      }
      if (filterUserId && u.user_id !== filterUserId) return false
      if (filterProjectId && u.project_id !== filterProjectId) return false
      if (filterTemplateType && u.template?.template_type !== filterTemplateType) return false
      if (filterDateFrom && u.created_at) {
        if (new Date(u.created_at) < startOfDay(new Date(filterDateFrom))) return false
      }
      if (filterDateTo && u.created_at) {
        if (new Date(u.created_at) > endOfDay(new Date(filterDateTo))) return false
      }
      return true
    })
  }, [updates, filterTag, filterUserId, filterProjectId, filterTemplateType, filterDateFrom, filterDateTo])

  const templatesEditable = useMemo(
    () => templates.filter((t) => t.department_id === departmentId || (isAdmin && t.department_id == null)),
    [templates, departmentId, isAdmin],
  )

  const canEditTemplateRow = (t: HubTemplate) => {
    if (isAdmin) return true
    if (user.role !== 'manager' && user.role !== 'hr') return false
    return t.department_id === departmentId
  }

  const openNewTemplateForm = () => {
    setTemplateForm({
      id: null,
      name: '',
      template_type: 'custom',
      body: 'Update — {Day}, {Date}\n\n{User Name} · {Department}\n\n',
    })
  }

  const openEditTemplate = (t: HubTemplate) => {
    if (!canEditTemplateRow(t)) return
    setTemplateForm({ id: t.id, name: t.name, template_type: t.template_type, body: t.body })
  }

  const saveTemplateForm = async () => {
    if (!templateForm || !departmentId) return
    const { id, name, template_type, body } = templateForm
    if (!name.trim() || !body.trim()) {
      showError('Name and body are required')
      return
    }
    setTemplateSaving(true)
    try {
      if (id) {
        const { error } = await supabase
          .from('hub_update_templates')
          .update({
            name: name.trim(),
            template_type,
            body: body.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
        if (error) throw error
        showSuccess('Template saved')
      } else {
        const { error } = await supabase.from('hub_update_templates').insert({
          department_id: departmentId,
          name: name.trim(),
          template_type,
          body: body.trim(),
          is_system: false,
          created_by: user.id,
        })
        if (error) throw error
        showSuccess('Template created')
      }
      setTemplateForm(null)
      await loadTemplates()
    } catch (e) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Could not save template')
    } finally {
      setTemplateSaving(false)
    }
  }

  const deleteTemplate = async (t: HubTemplate) => {
    if (!canEditTemplateRow(t)) return
    if (t.is_system && !isAdmin) {
      showError('Only admins can delete system templates')
      return
    }
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    setTemplateSaving(true)
    try {
      const { error } = await supabase.from('hub_update_templates').delete().eq('id', t.id)
      if (error) throw error
      showSuccess('Template deleted')
      if (selectedTemplateId === t.id) setSelectedTemplateId(null)
      setTemplateForm(null)
      await loadTemplates()
    } catch (e) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Could not delete template')
    } finally {
      setTemplateSaving(false)
    }
  }

  const filtersActive =
    filterTag ||
    filterUserId ||
    filterProjectId ||
    filterTemplateType ||
    filterDateFrom ||
    filterDateTo

  const clearFilters = () => {
    setFilterTag('')
    setFilterUserId('')
    setFilterProjectId('')
    setFilterTemplateType('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  const exportFilteredCsv = () => {
    const csv = buildCommunicationHubCsv(filteredUpdates)
    downloadCsvFile(csv, `communication-hub-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`)
    showSuccess(`Exported ${filteredUpdates.length} row(s)`)
  }

  const hubFilterSummaryLines = useMemo(() => {
    const lines: string[] = []
    if (filterTag) lines.push(`Tag contains "${filterTag}"`)
    if (filterUserId) {
      const name = authorOptions.find((a) => a.id === filterUserId)?.full_name ?? filterUserId
      lines.push(`Author: ${name}`)
    }
    if (filterProjectId) {
      const name = projectOptions.find((p) => p.id === filterProjectId)?.name ?? filterProjectId
      lines.push(`Project: ${name}`)
    }
    if (filterTemplateType) lines.push(`Template: ${filterTemplateType}`)
    if (filterDateFrom) lines.push(`From ${filterDateFrom}`)
    if (filterDateTo) lines.push(`To ${filterDateTo}`)
    return lines
  }, [
    filterTag,
    filterUserId,
    filterProjectId,
    filterTemplateType,
    filterDateFrom,
    filterDateTo,
    authorOptions,
    projectOptions,
  ])

  const exportFilteredPdf = () => {
    downloadCommunicationHubPdf({
      updates: filteredUpdates,
      teamHubName: activeDept?.name ?? '—',
      exportedByName: user.full_name,
      filterLines: hubFilterSummaryLines,
    })
    showSuccess(`PDF ready · ${filteredUpdates.length} update(s)`)
  }

  useEffect(() => {
    if (!canManageTemplates && activeTab === 'templates') {
      setActiveTab('compose')
    }
  }, [canManageTemplates, activeTab])

  if (!schemaReady) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-6 flex gap-4">
          <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Communication Hub database not installed</h1>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
              Run the SQL migration in Supabase (SQL Editor, CLI, or MCP apply_migration) to create hub tables and policies. The
              migration file is{' '}
              <code className="text-xs bg-white/60 dark:bg-black/30 px-1 rounded">
                supabase/migrations/20260323180708_team_communication_hub.sql
              </code>
              . After applying, refresh this page (or reload schema in the dashboard).
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader size="lg" text="Loading Communication Hub..." />
      </div>
    )
  }

  if (!departments.length) {
    return (
      <div className="p-6 max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Team updates</h1>
        <p className="text-gray-600 dark:text-gray-400">
          No hub workspace is available for your profile yet. Admins should ensure a <strong>General</strong> hub exists, or set
          your <strong>Team</strong> on your profile (User Management) — opening this page again will create the matching hub
          automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            Communication Hub
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
            Department-scoped updates, templates, and threads — integrated with TimeFlow.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void bootstrap()
              void loadUpdates()
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={exportFilteredCsv}
            disabled={!filteredUpdates.length}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportFilteredPdf}
            disabled={!filteredUpdates.length}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('compose')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'compose'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Compose
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'feed'
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Feed & Filters
          </button>
          {canManageTemplates && (
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'templates'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Templates
            </button>
          )}
        </div>
      </div>

      {activeTab === 'compose' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-4xl">
          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <label className={`block ${labelClass}`}>Team hub</label>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-1.5 leading-snug">
              Uses your profile <strong>Team</strong> and <strong>Role</strong> (same as User Management). Each option is a hub
              bucket tied to that team name.
            </p>
            <select value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value)} className={fieldClass}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.code === 'general' ? ' (no team on profile)' : ''}
                </option>
              ))}
            </select>
            {canManageTemplates && (
              <button
                type="button"
                onClick={() => setShowTemplateManager((v) => !v)}
                className="mt-3 w-full text-left text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                {showTemplateManager ? 'Hide template manager' : 'Manage templates for this department'}
              </button>
            )}
          </div>

          {canManageTemplates && showTemplateManager && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                <ClipboardList className="w-4 h-4 text-purple-500" />
                Templates
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Placeholders: {'{User Name}'}, {'{Department}'}, {'{Project}'}, {'{Date}'}, {'{Day}'}.
              </p>
              <ul className="space-y-2 max-h-48 overflow-y-auto text-sm">
                {templatesEditable.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="text-gray-900 dark:text-gray-100 font-medium">{t.name}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs ml-2">
                        {t.template_type}
                        {t.is_system ? ' · system' : ''}
                        {t.department_id == null ? ' · global' : ''}
                      </span>
                    </div>
                    {canEditTemplateRow(t) && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditTemplate(t)}
                          className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {(!t.is_system || isAdmin) && (
                          <button
                            type="button"
                            onClick={() => void deleteTemplate(t)}
                            disabled={templateSaving}
                            className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={openNewTemplateForm}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                + New template
              </button>
              {templateForm && (
                <div className="mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {templateForm.id ? 'Edit template' : 'New template'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTemplateForm(null)}
                      className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>
                  <input
                    className={fieldClass}
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((f) => (f ? { ...f, name: e.target.value } : f))}
                    placeholder="Template name"
                  />
                  <select
                    className={fieldClass}
                    value={templateForm.template_type}
                    onChange={(e) =>
                      setTemplateForm((f) =>
                        f ? { ...f, template_type: e.target.value as HubTemplateType } : f,
                      )
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="sprint">Sprint</option>
                    <option value="custom">Custom</option>
                  </select>
                  <textarea
                    className={`${fieldClass} min-h-[160px] text-sm font-sans leading-relaxed`}
                    value={templateForm.body}
                    onChange={(e) => setTemplateForm((f) => (f ? { ...f, body: e.target.value } : f))}
                    spellCheck
                  />
                  <button
                    type="button"
                    disabled={templateSaving}
                    onClick={() => void saveTemplateForm()}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {templateSaving ? 'Saving…' : 'Save template'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              New update
            </h2>
            <div>
              <label className={`block ${labelClass}`}>Template</label>
              <select
                value={selectedTemplateId ?? ''}
                onChange={(e) => setSelectedTemplateId(e.target.value || null)}
                className={fieldClass}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.template_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block ${labelClass}`}>Title (optional)</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={fieldClass}
                placeholder="Short headline"
              />
            </div>
            <div>
              <label className={`flex items-center gap-1 ${labelClass}`}>
                <FolderKanban className="w-3 h-3 opacity-90" />
                Project (optional)
              </label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldClass}>
                <option value="">— None —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {workHints && (
              <button
                type="button"
                onClick={applyWorkHints}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Insert today&apos;s time-tracker summaries into the body
              </button>
            )}
            <div>
              <label className={`block ${labelClass}`}>Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                spellCheck
                className={`${fieldClass} min-h-[280px] text-base leading-relaxed font-sans resize-y`}
              />
            </div>
            <div>
              <label className={`flex items-center gap-1 ${labelClass}`}>
                <Hash className="w-3 h-3 opacity-90" />
                Tags (comma or space, optional)
              </label>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                className={fieldClass}
                placeholder="blocker, urgent, completed"
              />
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1.5 leading-snug">
                Hashtags in the body are picked up automatically.
              </p>
            </div>
            <button
              type="button"
              disabled={posting || !body.trim()}
              onClick={() => void submitUpdate()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2.5 font-medium disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {posting ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </motion.div>
      )}

      {activeTab === 'feed' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                Filters
              </span>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <div>
                <label className={`block ${labelClass}`}>Tag contains</label>
                <input
                  value={filterTag}
                  onChange={(e) => setFilterTag(e.target.value)}
                  placeholder="e.g. blocker"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={`block ${labelClass}`}>Author</label>
                <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className={fieldClass}>
                  <option value="">Everyone (visible to you)</option>
                  {authorOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block ${labelClass}`}>Project</label>
                <select
                  value={filterProjectId}
                  onChange={(e) => setFilterProjectId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">All projects</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block ${labelClass}`}>Template type</label>
                <select
                  value={filterTemplateType}
                  onChange={(e) => setFilterTemplateType((e.target.value as HubTemplateType | '') || '')}
                  className={fieldClass}
                >
                  <option value="">Any type</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="sprint">Sprint</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className={`block ${labelClass}`}>From date</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={`block ${labelClass}`}>To date</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
            {filtersActive && (
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Showing {filteredUpdates.length} of {updates.length} loaded updates
              </p>
            )}
          </div>

          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredUpdates.map((u) => (
                <motion.article
                  key={u.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 overflow-hidden shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleThread(u.id)}
                    className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors"
                  >
                    <div className="mt-0.5 text-gray-500 dark:text-gray-400">
                      {expandedId === u.id ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {u.author?.full_name ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy · HH:mm') : ''}
                        </span>
                        {u.template?.template_type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                            {u.template.template_type}
                          </span>
                        )}
                        {u.projects?.name && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200">
                            {u.projects.name}
                          </span>
                        )}
                      </div>
                      {u.title && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{u.title}</p>}
                      <pre className="mt-2 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap font-sans leading-relaxed">
                        {u.body}
                      </pre>
                      {u.tags?.length ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {u.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </button>
                  {expandedId === u.id && (
                    <div className="border-t border-gray-200 dark:border-gray-600 px-4 py-3 bg-gray-50 dark:bg-gray-950">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">Thread</p>
                      <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
                        {(commentsByUpdate[u.id] ?? []).map((c) => (
                          <div key={c.id} className="text-sm">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{c.author?.full_name ?? 'User'}</span>
                            <span className="text-gray-600 dark:text-gray-400 text-xs ml-2">
                              {c.created_at ? format(new Date(c.created_at), 'HH:mm') : ''}
                            </span>
                            <p className="text-gray-900 dark:text-gray-100 mt-0.5 whitespace-pre-wrap leading-relaxed">
                              {c.body}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void postComment(u.id)
                            }
                          }}
                          className={`${fieldClass} flex-1`}
                          placeholder="Reply…"
                        />
                        <button
                          type="button"
                          onClick={() => void postComment(u.id)}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                </motion.article>
              ))}
            </AnimatePresence>
            {!filteredUpdates.length && (
              <p className="text-center text-gray-700 dark:text-gray-200 py-12">
                {updates.length === 0
                  ? 'No updates yet. Be the first to post.'
                  : 'No updates match these filters. Try clearing filters or load more with Refresh.'}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-300 px-1 leading-relaxed">
            Integrations (Teams / Slack sync), approvals, mandatory EOD rules, and exports can build on these tables and RLS.
            Optional compose hints use today&apos;s time entries from your tracker.
          </p>
        </motion.div>
      )}

      {canManageTemplates && activeTab === 'templates' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 max-w-4xl">
          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <label className={`block ${labelClass}`}>Team hub</label>
            <select value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value)} className={fieldClass}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.code === 'general' ? ' (no team on profile)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
              Manage templates for the selected team hub.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
              <ClipboardList className="w-4 h-4 text-purple-500" />
              Templates
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Placeholders: {'{User Name}'}, {'{Department}'}, {'{Project}'}, {'{Date}'}, {'{Day}'}.
            </p>
            <ul className="space-y-2 max-h-72 overflow-y-auto text-sm">
              {templatesEditable.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  <div className="min-w-0">
                    <span className="text-gray-900 dark:text-gray-100 font-medium">{t.name}</span>
                    <span className="text-gray-500 dark:text-gray-400 text-xs ml-2">
                      {t.template_type}
                      {t.is_system ? ' · system' : ''}
                      {t.department_id == null ? ' · global' : ''}
                    </span>
                  </div>
                  {canEditTemplateRow(t) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditTemplate(t)}
                        className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {(!t.is_system || isAdmin) && (
                        <button
                          type="button"
                          onClick={() => void deleteTemplate(t)}
                          disabled={templateSaving}
                          className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={openNewTemplateForm}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              + New template
            </button>
            {templateForm && (
              <div className="mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {templateForm.id ? 'Edit template' : 'New template'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTemplateForm(null)}
                    className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
                <input
                  className={fieldClass}
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((f) => (f ? { ...f, name: e.target.value } : f))}
                  placeholder="Template name"
                />
                <select
                  className={fieldClass}
                  value={templateForm.template_type}
                  onChange={(e) =>
                    setTemplateForm((f) =>
                      f ? { ...f, template_type: e.target.value as HubTemplateType } : f,
                    )
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="sprint">Sprint</option>
                  <option value="custom">Custom</option>
                </select>
                <textarea
                  className={`${fieldClass} min-h-[180px] text-sm font-sans leading-relaxed`}
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((f) => (f ? { ...f, body: e.target.value } : f))}
                  spellCheck
                />
                <button
                  type="button"
                  disabled={templateSaving}
                  onClick={() => void saveTemplateForm()}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {templateSaving ? 'Saving…' : 'Save template'}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  )
}
