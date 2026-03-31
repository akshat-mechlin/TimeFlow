import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Plus, Trash2, Building2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Loader from './Loader'
import { useToast } from '../contexts/ToastContext'
import { HUB_DEFAULT_DAILY_TEMPLATE_BODY } from '../lib/hubDefaultTemplate'
import type { Tables } from '../types/database'

type HubDepartment = Tables<'hub_departments'>
type Profile = Tables<'profiles'>

function slugTeam(t: string) {
  return t
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function CommunicationHubAdminSection() {
  const { showSuccess, showError } = useToast()
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<HubDepartment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: d, error: de }, { data: p, error: pe }] = await Promise.all([
        supabase.from('hub_departments').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      if (de) throw de
      if (pe) throw pe
      setDepartments(d ?? [])
      setProfiles(p ?? [])
      setSelectedDeptId((prev) => {
        const list = d ?? []
        if (prev && list.some((x) => x.id === prev)) return prev
        return list[0]?.id ?? null
      })
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Failed to load Communication Hub data'
      if (msg.includes('hub_') || msg.includes('schema')) {
        showError('Communication Hub tables missing. Run migrations first.')
      } else {
        showError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    void load()
  }, [load])

  const distinctProfileTeams = useMemo(() => {
    const set = new Set<string>()
    profiles.forEach((p) => {
      const t = p.team?.trim()
      if (t) set.add(t)
    })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [profiles])

  const syncHubFromProfileTeams = async () => {
    setBusy(true)
    try {
      const existing = new Map(departments.map((d) => [d.code, d]))
      for (const teamName of distinctProfileTeams) {
        const code = slugTeam(teamName) || 'team'
        if (existing.has(code)) continue
        const { data: dept, error } = await supabase
          .from('hub_departments')
          .insert({ name: teamName, code })
          .select('id')
          .single()
        if (error) {
          const { data: alt } = await supabase.from('hub_departments').select('id').eq('code', code).maybeSingle()
          if (alt) existing.set(code, { id: alt.id } as HubDepartment)
          continue
        }
        if (dept) {
          existing.set(code, { id: dept.id } as HubDepartment)
          await supabase.from('hub_update_templates').insert({
            department_id: dept.id,
            name: 'Daily EOD Update',
            template_type: 'daily',
            body: HUB_DEFAULT_DAILY_TEMPLATE_BODY,
            is_system: true,
          })
        }
      }
      showSuccess('Synced hub departments for profile teams')
      await load()
    } catch (e: unknown) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  const createHubForTeamName = async () => {
    const name = newTeamName.trim()
    if (!name) {
      showError('Enter a team name (should match profile Team field).')
      return
    }
    const code = slugTeam(name) || 'team'
    setBusy(true)
    try {
      const { data: dept, error } = await supabase.from('hub_departments').insert({ name, code }).select('id').single()
      if (error) throw error
      await supabase.from('hub_update_templates').insert({
        department_id: dept.id,
        name: 'Daily EOD Update',
        template_type: 'daily',
        body: HUB_DEFAULT_DAILY_TEMPLATE_BODY,
        is_system: true,
      })
      showSuccess('Hub workspace created — assign users via User Management (Team field)')
      setNewTeamName('')
      await load()
      setSelectedDeptId(dept.id)
    } catch (e: unknown) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Could not create hub')
    } finally {
      setBusy(false)
    }
  }

  const deleteDepartment = async () => {
    if (!selectedDeptId) return
    const dept = departments.find((d) => d.id === selectedDeptId)
    if (
      !window.confirm(
        `Delete hub "${dept?.name ?? 'this'}"? This removes all updates and templates for it. User profiles are unchanged.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('hub_departments').delete().eq('id', selectedDeptId)
      if (error) throw error
      showSuccess('Hub deleted')
      setSelectedDeptId(null)
      await load()
    } catch (e: unknown) {
      console.error(e)
      showError(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  const membersOnSelectedTeam = useMemo(() => {
    if (!selectedDeptId) return []
    const dept = departments.find((d) => d.id === selectedDeptId)
    if (!dept) return []
    return profiles.filter((p) => {
      if (dept.code === 'general') return !p.team || p.team.trim() === ''
      return (p.team ?? '').trim().toLowerCase() === dept.name.trim().toLowerCase()
    })
  }, [selectedDeptId, departments, profiles])

  if (loading) {
    return (
      <div className="py-12">
        <Loader size="md" text="Loading Communication Hub" />
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm'

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Communication Hub</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Hub buckets mirror <strong>Team</strong> on user profiles. Add users to a team in User Management — no separate hub
              membership list.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800/50 space-y-3">
        <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Hub workspaces
        </h3>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Distinct teams on profiles: <strong>{distinctProfileTeams.length}</strong> —{' '}
          <button
            type="button"
            disabled={busy || distinctProfileTeams.length === 0}
            onClick={() => void syncHubFromProfileTeams()}
            className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            Create missing hubs from those team names
          </button>
        </p>
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedDeptId(d.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedDeptId === d.id
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                  : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {d.name} <span className="text-gray-500 dark:text-gray-400">({d.code})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end border-t border-gray-200 dark:border-gray-600 pt-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">New hub (team name)</label>
            <input
              className={inputClass}
              placeholder="Must match Team field on profiles, e.g. Engineering"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createHubForTeamName()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Create hub
          </button>
        </div>
      </div>

      {selectedDeptId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800/50">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="font-semibold text-gray-800 dark:text-white">
                Profiles on this team ({membersOnSelectedTeam.length})
              </h3>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteDepartment()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete hub
              </button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Sourced from <code className="text-[11px]">profiles.team</code>. Edit users in User Management.
            </p>
            <ul className="max-h-64 overflow-y-auto text-sm space-y-1">
              {membersOnSelectedTeam.map((p) => (
                <li key={p.id} className="text-gray-800 dark:text-gray-200">
                  {p.full_name}{' '}
                  <span className="text-gray-500 dark:text-gray-400 text-xs">({p.email}) · {p.role}</span>
                </li>
              ))}
              {membersOnSelectedTeam.length === 0 && (
                <li className="text-gray-500 dark:text-gray-400">No profiles with this team (or General / empty team).</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
