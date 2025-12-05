import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Calendar, Download, Filter, X, RefreshCw, Search } from 'lucide-react'
import Loader from '../components/Loader'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js'
import { Line, Bar, Pie } from 'react-chartjs-2'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subDays } from 'date-fns'
import type { Tables } from '../types/database'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
)

type Profile = Tables<'profiles'>

interface ReportsProps {
  user: Profile
}

export default function Reports({ user }: ReportsProps) {
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
  })
  const [totalHours, setTotalHours] = useState(0)
  const [billableHours, setBillableHours] = useState(0)
  const [nonBillableHours, setNonBillableHours] = useState(0)
  const [productiveTeams, setProductiveTeams] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lineChartData, setLineChartData] = useState<any>(null)
  const [barChartData, setBarChartData] = useState<any>(null)
  const [pieChartData, setPieChartData] = useState<any>(null)
  
  // Filter states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    user.role === 'employee' ? [user.id] : []
  )
  // Auto-select user's team for non-admin users
  const [selectedTeam, setSelectedTeam] = useState<string>(
    user.role === 'admin' ? 'all' : (user.team || 'all')
  )
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [selectedRole, setSelectedRole] = useState<string>('all')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [teams, setTeams] = useState<string[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [timeEntries, setTimeEntries] = useState<any[]>([])
  const userDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchFilterOptions()
    // Auto-set team for non-admin users
    if (user.role !== 'admin' && user.team) {
      setSelectedTeam(user.team)
    }
  }, [user.id, user.team, user.role])

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false)
        setUserSearchTerm('')
      }
    }

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserDropdown])

  useEffect(() => {
    fetchReportData()
  }, [dateRange, user.id, selectedUserIds, selectedTeam, selectedProject, selectedRole])

  const fetchFilterOptions = async () => {
    try {
      // Fetch team members based on role
      if (user.role === 'admin') {
        const { data } = await supabase.from('profiles').select('*').order('full_name')
        setTeamMembers(data || [])
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Manager can see their team members - get all users who have this manager assigned
        const { data: teamMembers } = await supabase
          .from('profiles')
          .select('*')
          .eq('manager_id', user.id)
          .order('full_name')
        setTeamMembers([user, ...(teamMembers || [])])
      } else {
        setTeamMembers([user])
      }

      // Fetch teams
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('team')
        .not('team', 'is', null)
      
      const uniqueTeams = Array.from(new Set(profilesData?.map(p => p.team).filter(Boolean) || []))
      setTeams(uniqueTeams as string[])

      // Fetch projects
      let projectsQuery = supabase.from('projects').select('id, name').order('name')
      
      if (user.role === 'employee') {
        // Get projects assigned to employee
        const { data: memberProjects } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('user_id', user.id)
        
        const projectIds = memberProjects?.map(p => p.project_id) || []
        if (projectIds.length > 0) {
          projectsQuery = projectsQuery.in('id', projectIds)
        } else {
          setProjects([])
          return
        }
      }
      
      const { data: projectsData } = await projectsQuery
      setProjects(projectsData || [])
    } catch (error) {
      console.error('Error fetching filter options:', error)
    }
  }

  const fetchReportData = async () => {
    try {
      setLoading(true)
      const startDate = format(dateRange.start, 'yyyy-MM-dd')
      const endDate = format(dateRange.end, 'yyyy-MM-dd')

      // Determine which users to filter by based on role and filters
      let userIdsToFilter: string[] = []
      
      // Start with base user set based on role
      if (user.role === 'employee') {
        userIdsToFilter = [user.id]
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Get all team members - users who have this manager assigned
        const { data: teamMembers } = await supabase
          .from('profiles')
          .select('id')
          .eq('manager_id', user.id)
        userIdsToFilter = [user.id, ...(teamMembers?.map((m) => m.id) || [])]
      } else if (user.role === 'admin') {
        // Admin can see all users initially
        const { data: allUsers } = await supabase
          .from('profiles')
          .select('id')
        userIdsToFilter = allUsers?.map(u => u.id) || []
      }

      // Apply user filter (if specific users selected)
      if (selectedUserIds.length > 0 && (user.role === 'admin' || user.role === 'manager' || user.role === 'hr')) {
        userIdsToFilter = selectedUserIds
      }

      // Apply team filter
      // For admins: apply if selectedTeam is not 'all'
      // For non-admins: always apply their team filter
      if (selectedTeam !== 'all') {
        const { data: teamUsers } = await supabase
          .from('profiles')
          .select('id')
          .eq('team', selectedTeam)
        
        const teamUserIds = teamUsers?.map(u => u.id) || []
        // Intersect with current user filter
        userIdsToFilter = userIdsToFilter.filter(id => teamUserIds.includes(id))
      }

      // Apply role filter (for admins)
      if (selectedRole !== 'all' && user.role === 'admin') {
        const { data: roleUsers } = await supabase
          .from('profiles')
          .select('id')
          .eq('role', selectedRole)
        
        const roleUserIds = roleUsers?.map(u => u.id) || []
        // Intersect with current user filter
        userIdsToFilter = userIdsToFilter.filter(id => roleUserIds.includes(id))
      }

      // Build query
      let query = supabase
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
        .gte('start_time', `${startDate}T00:00:00`)
        .lte('start_time', `${endDate}T23:59:59`)

      // Apply user filter to query
      if (userIdsToFilter.length > 0) {
        query = query.in('user_id', userIdsToFilter)
      } else {
        // No users match the filters, return empty result
        query = query.eq('user_id', '00000000-0000-0000-0000-000000000000')
      }

      const { data: fetchedTimeEntries, error: entriesError } = await query

      if (entriesError) {
        console.error('Error fetching time entries:', entriesError)
        throw entriesError
      }

      // Store time entries for export
      setTimeEntries(fetchedTimeEntries || [])

      // Filter by project if selected
      let filteredEntries = fetchedTimeEntries || []
      if (selectedProject !== 'all') {
        filteredEntries = filteredEntries.filter((entry: any) => {
          return entry.project_time_entries?.some((pte: any) => pte.project_id === selectedProject)
        })
      }

      // Use filtered entries for calculations
      const entriesToUse = filteredEntries

      // Prepare pie chart data (by project) - using filteredEntries
      const projectHours: { [key: string]: { name: string; hours: number } } = {}
      const NO_PROJECT_KEY = '__no_project__'

      filteredEntries.forEach((entry: any) => {
        if (entry.project_time_entries && entry.project_time_entries.length > 0) {
          entry.project_time_entries.forEach((pte: any) => {
            const projectId = pte.project_id
            const projectName = pte.projects?.name || 'Unknown Project'
            
            // Handle entries with null project_id (default project)
            const key = projectId || NO_PROJECT_KEY
            const displayName = projectId ? projectName : 'Default Project'
            
            if (!projectHours[key]) {
              projectHours[key] = { name: displayName, hours: 0 }
            }
            projectHours[key].hours += (entry.duration || 0) / 3600
          })
        } else {
          // Entry has no project_time_entries at all - count as Default Project
          if (!projectHours[NO_PROJECT_KEY]) {
            projectHours[NO_PROJECT_KEY] = { name: 'Default Project', hours: 0 }
          }
          projectHours[NO_PROJECT_KEY].hours += (entry.duration || 0) / 3600
        }
      })

      const projectLabels = Object.values(projectHours).map(p => p.name)
      const projectData = Object.values(projectHours).map(p => p.hours)

      // Calculate totals
      const total = entriesToUse.reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600
      setTotalHours(total)

      // Calculate billable vs non-billable
      // Billable hours = time entries that are linked to projects (via project_time_entries)
      // Non-billable hours = time entries that are NOT linked to any project
      const billable = entriesToUse.reduce((sum, entry) => {
        // Check if this time entry is linked to any project
        const hasProject = entry.project_time_entries && entry.project_time_entries.length > 0
        if (hasProject) {
          // If linked to project, check the billable flag (default to true if not specified)
          const isBillable = entry.project_time_entries.some((pte: any) => pte.billable !== false)
          return sum + (isBillable ? (entry.duration || 0) : 0)
        }
        return sum
      }, 0) / 3600
      setBillableHours(billable)
      setNonBillableHours(total - billable)

      // Calculate productive teams - teams that have logged hours in the selected date range
      const teamsWithHours = new Set<string>()
      entriesToUse.forEach((entry) => {
        if (entry.profile?.team) {
          teamsWithHours.add(entry.profile.team)
        }
      })
      setProductiveTeams(teamsWithHours.size)

      // Prepare line chart data (daily hours)
      const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
      const dailyHours = days.map((day) => {
        const dayStart = format(day, 'yyyy-MM-dd')
        const dayEnd = format(day, 'yyyy-MM-dd')
        const dayEntries = entriesToUse.filter((entry) => {
          const entryDate = format(new Date(entry.start_time), 'yyyy-MM-dd')
          return entryDate >= dayStart && entryDate <= dayEnd
        })
        return dayEntries.reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600
      })

      setLineChartData({
        labels: days.map((day) => format(day, 'MMM d')),
        datasets: [
          {
            label: 'Hours Tracked',
            data: dailyHours,
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true,
          },
        ],
      })

      // Prepare bar chart data (weekly hours)
      const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i))
      const weeklyHours = last7Days.map((day) => {
        const dayStart = format(day, 'yyyy-MM-dd')
        const dayEnd = format(day, 'yyyy-MM-dd')
        const dayEntries = entriesToUse.filter((entry) => {
          const entryDate = format(new Date(entry.start_time), 'yyyy-MM-dd')
          return entryDate >= dayStart && entryDate <= dayEnd
        })
        return dayEntries.reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600
      })

      setBarChartData({
        labels: last7Days.map((day) => format(day, 'EEE')),
        datasets: [
          {
            label: 'Hours',
            data: weeklyHours,
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
          },
        ],
      })

      setPieChartData({
        labels: projectLabels.length > 0 ? projectLabels : ['Other'],
        datasets: [
          {
            data: projectData.length > 0 ? projectData : [total],
            backgroundColor: [
              'rgba(59, 130, 246, 0.8)',
              'rgba(99, 102, 241, 0.8)',
              'rgba(139, 92, 246, 0.8)',
              'rgba(168, 85, 247, 0.8)',
              'rgba(236, 72, 153, 0.8)',
            ],
          },
        ],
      })
    } catch (error) {
      console.error('Error fetching report data:', error)
    } finally {
      setLoading(false)
    }
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: '#6B7280',
          usePointStyle: true,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          color: '#6B7280',
        },
        grid: {
          color: 'rgba(107, 114, 128, 0.1)',
        },
      },
      x: {
        ticks: {
          color: '#6B7280',
        },
        grid: {
          color: 'rgba(107, 114, 128, 0.1)',
        },
      },
    },
  }

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'right' as const,
        labels: {
          color: '#6B7280',
          usePointStyle: true,
          padding: 15,
        },
      },
    },
  }

  const handleUserToggle = (userId: string) => {
    setSelectedUserIds(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSelectAllUsers = () => {
    if (selectedUserIds.length === teamMembers.length) {
      setSelectedUserIds([])
    } else {
      setSelectedUserIds(teamMembers.map(m => m.id))
    }
  }

  const clearAllFilters = () => {
    setSelectedUserIds(user.role === 'employee' ? [user.id] : [])
    // For non-admin users, keep their team selected; for admins, reset to 'all'
    setSelectedTeam(user.role === 'admin' ? 'all' : (user.team || 'all'))
    setSelectedProject('all')
    setSelectedRole('all')
  }

  // For non-admin users, team filter is always active (their team), so don't count it as an active filter
  const hasActiveFilters = selectedUserIds.length !== (user.role === 'employee' ? 1 : 0) || 
                           (user.role === 'admin' && selectedTeam !== 'all') || 
                           selectedProject !== 'all' || 
                           selectedRole !== 'all'

  const handleExportCSV = () => {
    // Get entries to export - need to recalculate filtered entries
    let entriesToExport: any[] = []
    
    // Fetch current time entries if not available
    if (!timeEntries || timeEntries.length === 0) {
      return
    }
    
    // Apply project filter if selected
    if (selectedProject !== 'all') {
      entriesToExport = (timeEntries || []).filter((entry: any) => {
        return entry.project_time_entries?.some((pte: any) => pte.project_id === selectedProject)
      })
    } else {
      entriesToExport = timeEntries || []
    }
    
    // Create CSV headers
    const headers = ['Date', 'User', 'Team', 'Project', 'Description', 'Duration (Hours)', 'Billable']
    
    // Create CSV rows
    const rows = entriesToExport.map((entry: any) => {
      const projectNames = entry.project_time_entries?.map((pte: any) => pte.projects?.name || 'N/A').join('; ') || 'N/A'
      const isBillable = entry.project_time_entries && entry.project_time_entries.length > 0
      const hours = (entry.duration || 0) / 3600
      
      return [
        format(new Date(entry.start_time), 'yyyy-MM-dd'),
        entry.profile?.full_name || 'Unknown',
        entry.profile?.team || '—',
        projectNames,
        entry.description || '—',
        hours.toFixed(2),
        isBillable ? 'Yes' : 'No'
      ]
    })
    
    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    
    // Generate filename with date range
    const filename = `time-report_${format(dateRange.start, 'yyyy-MM-dd')}_${format(dateRange.end, 'yyyy-MM-dd')}.csv`
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Export Report Section - At Top */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Export Time Report</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {(() => {
                if (!timeEntries || timeEntries.length === 0) {
                  return `No entries to export from ${format(dateRange.start, 'MMM d, yyyy')} to ${format(dateRange.end, 'MMM d, yyyy')}`
                }
                const entriesCount = selectedProject !== 'all' 
                  ? timeEntries.filter((entry: any) => entry.project_time_entries?.some((pte: any) => pte.project_id === selectedProject)).length
                  : timeEntries.length
                return `Export ${entriesCount} ${entriesCount === 1 ? 'entry' : 'entries'} from ${format(dateRange.start, 'MMM d, yyyy')} to ${format(dateRange.end, 'MMM d, yyyy')}`
              })()}
              {selectedUserIds.length > 0 && selectedUserIds.length < teamMembers.length && (
                <span> for {selectedUserIds.length} selected {selectedUserIds.length === 1 ? 'user' : 'users'}</span>
              )}
              {selectedTeam !== 'all' && (
                <span> in {selectedTeam} team</span>
              )}
              {selectedProject !== 'all' && (
                <span> for {projects.find(p => p.id === selectedProject)?.name || 'selected project'}</span>
              )}
              {selectedRole !== 'all' && (
                <span> with {selectedRole} role</span>
              )}
            </p>
          </div>
            <button 
              onClick={handleExportCSV}
              disabled={loading || timeEntries.length === 0}
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              <span>Export to CSV</span>
            </button>
        </div>
      </div>

      {/* Filters Section */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Filters</h3>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchReportData()}
              disabled={loading}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm">Refresh</span>
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
              >
                <X className="w-4 h-4" />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Date Range */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
              <span>Date Range</span>
            </label>
            <div className="flex items-center space-x-2 h-10">
              <input
                type="date"
                value={format(dateRange.start, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    setDateRange(prev => ({ ...prev, start: new Date(e.target.value) }))
                  } else {
                    setDateRange(prev => ({ ...prev, start: new Date() }))
                  }
                }}
                className="flex-1 px-3 py-2 h-full border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-600 dark:text-gray-400 text-sm flex-shrink-0">to</span>
              <input
                type="date"
                value={format(dateRange.end, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    setDateRange(prev => ({ ...prev, end: new Date(e.target.value) }))
                  } else {
                    setDateRange(prev => ({ ...prev, end: new Date() }))
                  }
                }}
                className="flex-1 px-3 py-2 h-full border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* User Filter (for managers/admins) */}
          {(user.role === 'admin' || user.role === 'manager' || user.role === 'hr') && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                <span>Users</span>
              </label>
              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => {
                    setShowUserDropdown(!showUserDropdown)
                    if (showUserDropdown) {
                      setUserSearchTerm('')
                    }
                  }}
                  className="w-full px-3 py-2 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <span className="truncate">
                    {selectedUserIds.length === 0 
                      ? 'All Users' 
                      : selectedUserIds.length === 1
                      ? teamMembers.find(m => m.id === selectedUserIds[0])?.full_name || '1 selected'
                      : `${selectedUserIds.length} selected`}
                  </span>
                  <Filter className="w-4 h-4 text-gray-400" />
                </button>
                {showUserDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {/* Search Bar */}
                    <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                        />
                      </div>
                    </div>
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                      <label className="flex items-center space-x-2 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(() => {
                            const filtered = teamMembers.filter(m => 
                              m.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                              m.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                            )
                            return filtered.length > 0 && filtered.every(m => selectedUserIds.includes(m.id))
                          })()}
                          onChange={(e) => {
                            const filtered = teamMembers.filter(m => 
                              m.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                              m.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                            )
                            if (e.target.checked) {
                              const newIds = [...new Set([...selectedUserIds, ...filtered.map(m => m.id)])]
                              setSelectedUserIds(newIds)
                            } else {
                              setSelectedUserIds(selectedUserIds.filter(id => !filtered.some(m => m.id === id)))
                            }
                          }}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Select All</span>
                      </label>
                    </div>
                    <div className="p-2 space-y-1">
                      {teamMembers
                        .filter(member => 
                          member.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                          member.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                        )
                        .map((member) => (
                        <label
                          key={member.id}
                          className="flex items-center space-x-2 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(member.id)}
                            onChange={() => handleUserToggle(member.id)}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{member.full_name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Team Filter (only for admins) */}
          {user.role === 'admin' && teams.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                <span>Team/Department</span>
              </label>
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="w-full px-3 py-2 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Teams</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Show team info for non-admin users (read-only) */}
          {user.role !== 'admin' && user.team && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                <span>Team/Department</span>
              </label>
              <div className="w-full px-3 py-2 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm flex items-center">
                {user.team}
              </div>
            </div>
          )}

          {/* Role Filter (for admins only) */}
          {user.role === 'admin' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                <span>Role</span>
              </label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full px-3 py-2 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="employee">Employee</option>
                <option value="accountant">Accountant</option>
              </select>
            </div>
          )}

          {/* Project Filter */}
          {projects.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-1">
                <span>Project</span>
              </label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full px-3 py-2 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12">
          <Loader size="lg" text="Loading reports" />
        </div>
      ) : (
        <>
          {/* Total Hours Chart */}
          {lineChartData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Total Hours Tracked</h2>
              <div className="h-64">
                <Line data={lineChartData} options={chartOptions} />
              </div>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Total Hours</h3>
              <p className="text-3xl font-bold text-gray-800 dark:text-white">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Billable Hours</h3>
              <p className="text-3xl font-bold text-gray-800 dark:text-white">{billableHours.toFixed(1)}h</p>
            </div>
            <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Non-Billable Hours</h3>
              <p className="text-3xl font-bold text-gray-800 dark:text-white">{nonBillableHours.toFixed(1)}h</p>
            </div>
            <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Active Teams</h3>
              <p className="text-3xl font-bold text-gray-800 dark:text-white">{productiveTeams}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Teams with logged hours</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {barChartData && (
              <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Weekly Hours</h2>
                <div className="h-64">
                  <Bar data={barChartData} options={chartOptions} />
                </div>
              </div>
            )}
            {pieChartData && (
              <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Project Distribution</h2>
                <div className="h-64">
                  <Pie data={pieChartData} options={pieChartOptions} />
                </div>
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}
