import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Clock, TrendingUp, Users, FolderKanban, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfDay, endOfDay } from 'date-fns'
import { motion } from 'framer-motion'
import Loader from '../components/Loader'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type TimeEntry = Tables<'time_entries'>

interface DashboardProps {
  user: Profile
}

export default function Dashboard({ user }: DashboardProps) {
  const ENTRIES_PER_PAGE = 10
  const [recentEntries, setRecentEntries] = useState<(TimeEntry & { profile?: Profile })[]>([])
  const [entriesPage, setEntriesPage] = useState(1)
  const [entriesTotalCount, setEntriesTotalCount] = useState(0)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [todayHours, setTodayHours] = useState(0)
  const [totalHours, setTotalHours] = useState(0)
  const [activeProjects, setActiveProjects] = useState(0)
  const [teamOnline, setTeamOnline] = useState(0)
  const [teamTotal, setTeamTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [user.id])

  const fetchRecentEntriesPage = async (page: number) => {
    setEntriesLoading(true)
    try {
      const from = (page - 1) * ENTRIES_PER_PAGE
      const to = from + ENTRIES_PER_PAGE - 1
      const { data: entries, error } = await supabase
        .from('time_entries')
        .select(`
          *,
          profile:profiles!time_entries_user_id_fkey(*),
          project_time_entries(
            project_id,
            billable,
            projects(name)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw error
      setRecentEntries(entries ?? [])
    } catch (e) {
      console.error('Error fetching entries page:', e)
    } finally {
      setEntriesLoading(false)
    }
  }

  useEffect(() => {
    if (entriesPage > 1) fetchRecentEntriesPage(entriesPage)
  }, [entriesPage])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const todayStart = startOfDay(new Date()).toISOString()
      const todayEnd = endOfDay(new Date()).toISOString()

      // Total count for pagination
      const { count: entriesCount } = await supabase
        .from('time_entries')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
      setEntriesTotalCount(entriesCount ?? 0)
      setEntriesPage(1)

      // Fetch first page of recent time entries
      const from = 0
      const to = ENTRIES_PER_PAGE - 1
      const { data: entries, error: entriesError } = await supabase
        .from('time_entries')
        .select(`
          *,
          profile:profiles!time_entries_user_id_fkey(*),
          project_time_entries(
            project_id,
            billable,
            projects(name)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (entriesError) throw entriesError

      // Calculate today's hours - always for current user only
      const { data: todayEntries, error: todayError } = await supabase
        .from('time_entries')
        .select('duration, user_id')
        .eq('user_id', user.id)
        .gte('start_time', todayStart)
        .lte('start_time', todayEnd)

      if (todayError) throw todayError

      // Database stores duration in seconds, convert to hours
      const todayTotal = todayEntries?.reduce((sum, entry) => sum + (entry.duration || 0), 0) || 0
      setTodayHours(todayTotal / 3600) // Convert seconds to hours

      // Calculate total hours - always for current user only
      const { data: allEntries, error: allError } = await supabase
        .from('time_entries')
        .select('duration, user_id')
        .eq('user_id', user.id)

      if (allError) throw allError

      // Database stores duration in seconds, convert to hours
      const total = allEntries?.reduce((sum, entry) => sum + (entry.duration || 0), 0) || 0
      setTotalHours(total / 3600)

      setRecentEntries(entries || [])

      // Fetch active projects count - only projects assigned to current user
      const { data: userProjects } = await supabase
        .from('project_members')
        .select('project_id, projects!inner(status)')
        .eq('user_id', user.id)
        .eq('projects.status', 'active')

      setActiveProjects(userProjects?.length || 0)

      // Fetch team members based on user role
      let teamUserIds: string[] = []
      
      if (user.role === 'admin') {
        // Admin can see all users
        const { data: allUsers } = await supabase
          .from('profiles')
          .select('id')
        teamUserIds = allUsers?.map(u => u.id) || []
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Manager/HR can see their team members - users who have this manager assigned
        const { data: teamMembers } = await supabase
          .from('profiles')
          .select('id')
          .eq('manager_id', user.id)
        teamUserIds = [user.id, ...(teamMembers?.map(m => m.id) || [])]
      } else {
        // Employee can only see themselves
        teamUserIds = [user.id]
      }

      setTeamTotal(teamUserIds.length)

      // Count online users (users who have logged time today)
      if (teamUserIds.length > 0) {
        const { data: onlineUsers } = await supabase
          .from('time_entries')
          .select('user_id', { distinct: true })
          .in('user_id', teamUserIds)
          .gte('start_time', todayStart)
          .lte('start_time', todayEnd)

        setTeamOnline(onlineUsers?.length || 0)
      } else {
        setTeamOnline(0)
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0h 0m'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  if (loading) {
    return <Loader size="lg" text="Loading dashboard..." />
  }

  return (
    <div className="space-y-6">
      {/* Header with Refresh Button */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard</h1>
        <button
          onClick={() => fetchDashboardData()}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh data"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm">Refresh</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          whileHover={{ y: -4 }}
          className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <TrendingUp className="w-5 h-5 text-green-500 dark:text-green-400" />
          </div>
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Today's Hours</h3>
          <p className="text-3xl font-bold text-gray-800 dark:text-white">{todayHours.toFixed(1)}h</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          whileHover={{ y: -4 }}
          className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Total Hours</h3>
          <p className="text-3xl font-bold text-gray-800 dark:text-white">{totalHours.toFixed(1)}h</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          whileHover={{ y: -4 }}
          className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <FolderKanban className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Active Projects</h3>
          <p className="text-3xl font-bold text-gray-800 dark:text-white">{activeProjects}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.4 }}
          whileHover={{ y: -4 }}
          className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
              <Users className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Team Online</h3>
          <p className="text-3xl font-bold text-gray-800 dark:text-white">{teamOnline}/{teamTotal}</p>
        </motion.div>
      </div>

      {/* Recent Time Entries */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.5 }}
        className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
      >
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Recent Time Entries</h2>
        </div>
        <div className="p-6">
          {recentEntries.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p>No time entries found. Time entries are tracked by your external time tracking application.</p>
            </div>
          ) : (
            <>
              {entriesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader size="md" text="Loading entries..." />
                </div>
              ) : (
                <div className="space-y-4">
                  {recentEntries.map((entry, index) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      whileHover={{ x: 4 }}
                      className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 dark:text-gray-200">
                              {(() => {
                                const entryWithProjects = entry as any
                                if (entryWithProjects.project_time_entries && entryWithProjects.project_time_entries.length > 0) {
                                  const projectNames = entryWithProjects.project_time_entries
                                    .map((pte: any) => pte.projects?.name)
                                    .filter(Boolean)
                                  if (projectNames.length > 0) {
                                    return projectNames.length === 1 
                                      ? projectNames[0]
                                      : `${projectNames[0]} +${projectNames.length - 1} more`
                                  }
                                }
                                return 'No Project'
                              })()}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {format(new Date(entry.start_time), 'MMM d, yyyy • h:mm a')}
                              {entry.end_time &&
                                ` - ${format(new Date(entry.end_time), 'h:mm a')}`}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-800 dark:text-white">
                          {formatDuration(entry.duration)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Duration</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
              {entriesTotalCount > ENTRIES_PER_PAGE && (
                <div className="mt-6 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Showing {(entriesPage - 1) * ENTRIES_PER_PAGE + 1}–
                    {Math.min(entriesPage * ENTRIES_PER_PAGE, entriesTotalCount)} of {entriesTotalCount} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEntriesPage((p) => Math.max(1, p - 1))}
                      disabled={entriesPage <= 1 || entriesLoading}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" /> Previous
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-300 px-2">
                      Page {entriesPage} of {Math.ceil(entriesTotalCount / ENTRIES_PER_PAGE) || 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEntriesPage((p) => Math.min(Math.ceil(entriesTotalCount / ENTRIES_PER_PAGE), p + 1))}
                      disabled={entriesPage >= Math.ceil(entriesTotalCount / ENTRIES_PER_PAGE) || entriesLoading}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

