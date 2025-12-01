import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Download, Calendar, Clock, CheckCircle, XCircle, User, X, RefreshCw } from 'lucide-react'
import { format, parseISO, subDays, subHours, addHours } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import Loader from '../components/Loader'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type TimeEntry = Tables<'time_entries'> & { profile?: Profile }

interface AttendanceProps {
  user: Profile
}

interface AttendanceRecord {
  id: string
  user_id: string
  date: string // Date in IST (YYYY-MM-DD format)
  clock_in_time: string | null
  clock_out_time: string | null
  status: 'present' | 'half_day' | 'late' | 'absent'
  duration: number // in seconds
  profile?: Profile
  timeEntries?: Array<{
    id: string
    start_time: string
    end_time: string | null
    duration: number | null
    description: string | null
    projects?: Array<{
      project_id: string
      project_name: string
      task_name?: string
    }>
    activity?: {
      totalKeystrokes: number
      totalMouseMovements: number
      productivityScore: number
    }
  }>
}

export default function Attendance({ user }: AttendanceProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([user.id])
  const [activeDateRange, setActiveDateRange] = useState<'today' | 'last7' | 'last30' | 'custom'>('today')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const selectedUserIdsRef = useRef<string[]>(selectedUserIds)
  const userDropdownRef = useRef<HTMLDivElement>(null)

  const IST_TIMEZONE = 'Asia/Kolkata'
  const TRACKER_RESET_HOUR = 6 // 6 AM IST

  // Keep ref in sync with state
  useEffect(() => {
    selectedUserIdsRef.current = selectedUserIds
  }, [selectedUserIds])

  // Handle clicks outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false)
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
    fetchTeamMembers()
  }, [user.id])

  useEffect(() => {
    // Fetch attendance records when filters change
    fetchAttendanceRecords()
  }, [selectedUserIds, startDate, endDate])

  const fetchTeamMembers = async () => {
    try {
      if (user.role === 'admin') {
        // Admin can see all users
        const { data } = await supabase.from('profiles').select('*').order('full_name')
        setTeamMembers(data || [])
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Manager can see their team members
        const { data: managed } = await supabase
          .from('employee_managers')
          .select('employee_id, profiles:profiles!employee_managers_employee_id_fkey(*)')
          .eq('manager_id', user.id)

        const members = managed?.map((m: any) => m.profiles).filter(Boolean) || []
        setTeamMembers([user, ...members])
      } else {
        // Employee can only see themselves
        setTeamMembers([user])
      }
    } catch (error) {
      console.error('Error fetching team members:', error)
    }
  }

  // Get attendance period for a given date in IST
  // Period: 6 AM IST of date to 5:59:59 AM IST of next day
  const getAttendancePeriod = (dateStr: string) => {
    // Parse the date string as IST date
    const dateInIST = fromZonedTime(`${dateStr} 00:00:00`, IST_TIMEZONE)
    
    // Start: 6 AM IST of the date
    const periodStart = addHours(dateInIST, TRACKER_RESET_HOUR)
    
    // End: 5:59:59 AM IST of next day (which is 6 AM - 1 second)
    const nextDay = addHours(dateInIST, 24)
    const periodEnd = addHours(nextDay, TRACKER_RESET_HOUR - 1)
    
    return { periodStart, periodEnd }
  }


  const fetchAttendanceRecords = async () => {
    try {
      setLoading(true)
      
      // Get current selectedUserIds from ref to avoid closure issues with real-time subscriptions
      const currentSelectedUserIds = selectedUserIdsRef.current
      
      // Parse date range (these are IST dates)
      const startIST = parseISO(startDate)
      const endIST = parseISO(endDate)
      
      // Get the attendance period for start date (6 AM IST of start date)
      const { periodStart: startPeriodStart } = getAttendancePeriod(startDate)
      
      // Get the attendance period for end date (5:59:59 AM IST of next day after end date)
      const { periodEnd: endPeriodEnd } = getAttendancePeriod(endDate)
      
      // Fetch time entries that might fall in any of these attendance periods
      // We need to fetch a wider range to account for entries that might belong to different attendance dates
      const queryStart = subHours(startPeriodStart, 6) // Fetch from 6 hours before to be safe
      const queryEnd = endPeriodEnd

      // Fetch time entries for the selected user and date range with project and activity info
      let query = supabase
        .from('time_entries')
        .select(`
          *,
          profile:profiles!time_entries_user_id_fkey(*),
          project_time_entries(
            project_id,
            billable,
            projects(
              id,
              name,
              task_id,
              tasks(name)
            )
          ),
          screenshots(
            id,
            activity_logs(
              keystrokes,
              mouse_movements,
              productivity_score
            )
          )
        `)
        .gte('start_time', queryStart.toISOString())
        .lte('start_time', queryEnd.toISOString())
        .order('start_time', { ascending: false })

      // Apply user filter - if specific users selected, filter by them
      // IMPORTANT: Use currentSelectedUserIds to ensure we use the latest state
      if (currentSelectedUserIds.length > 0) {
        query = query.in('user_id', currentSelectedUserIds)
      }

      const { data: timeEntries, error } = await query.limit(1000)

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Fetched time entries:', timeEntries?.length || 0)

      // Calculate attendance records from time entries
      const attendanceMap = new Map<string, AttendanceRecord>()

      // Get all unique user IDs from time entries
      const userIds = new Set<string>()
      const entries = (timeEntries || []) as Array<TimeEntry & { profile?: Profile }>
      entries.forEach((entry) => {
        if (entry.user_id) {
          userIds.add(entry.user_id)
        }
      })

      // IMPORTANT: Always use currentSelectedUserIds from ref to ensure we use the latest state
      // If filtering by specific users, only include those users
      // If no users selected (empty array) AND user has permission, show all users from time entries
      // Otherwise, only show the selected users
      let usersToProcess: string[]
      if (currentSelectedUserIds.length > 0) {
        // Filter by selected users only
        usersToProcess = currentSelectedUserIds
      } else {
        // No users selected - show all users found in time entries
        // But only if user has permission to see all users
        if (user.role === 'admin' || user.role === 'manager' || user.role === 'hr') {
          usersToProcess = Array.from(userIds)
        } else {
          // Employee can only see themselves
          usersToProcess = [user.id]
        }
      }

      // For each user, calculate attendance for each day in the date range
      for (const userId of usersToProcess) {
        // Get user profile from teamMembers or from time entries
        const userEntries = entries.filter((e) => e.user_id === userId)
        const userProfile = teamMembers.find(m => m.id === userId) || userEntries[0]?.profile

        // Generate all dates in the range (IST dates)
        const currentDate = new Date(startIST)
        while (currentDate <= endIST) {
          const dateStr = format(currentDate, 'yyyy-MM-dd')
          
          // Get attendance period for this date
          const { periodStart, periodEnd } = getAttendancePeriod(dateStr)

          // Find time entries that fall within this attendance period
          const dayEntries = userEntries.filter((entry) => {
            const entryStart = new Date(entry.start_time)
            // Entry belongs to this attendance period if it starts within the period
            return entryStart >= periodStart && entryStart < periodEnd
          })

          if (dayEntries.length > 0) {
            // Calculate clock in (earliest start_time in IST)
            const clockIn = dayEntries.reduce((earliest, entry) => {
              const entryTime = new Date(entry.start_time)
              return !earliest || entryTime < earliest ? entryTime : earliest
            }, null as Date | null)

            // Calculate clock out (latest end_time in IST, or current time if still running)
            const clockOut = dayEntries.reduce((latest, entry) => {
              const entryTime = entry.end_time ? new Date(entry.end_time) : new Date()
              return !latest || entryTime > latest ? entryTime : latest
            }, null as Date | null)

            // Calculate total duration in seconds
            const totalDuration = dayEntries.reduce((sum, entry) => {
              return sum + (entry.duration || 0)
            }, 0)

            // Convert duration to hours
            const hoursWorked = totalDuration / 3600

            // Determine status based on hours worked
            // 8+ hours = Present, 4-8 hours = Half Day, <4 hours = Absent
            let status: 'present' | 'half_day' | 'absent' = 'absent'
            if (hoursWorked >= 8) {
              status = 'present'
            } else if (hoursWorked >= 4) {
              status = 'half_day'
            } else {
              // Less than 4 hours = Absent
              status = 'absent'
            }

            // Process time entries with project/task and activity info
            const processedEntries = dayEntries.map((entry: any) => {
              // Extract project and task information
              const projects = (entry.project_time_entries || []).map((pte: any) => ({
                project_id: pte.project_id,
                project_name: pte.projects?.name || 'No Project',
                task_name: pte.projects?.tasks?.name || null,
              }))

              // Calculate activity totals from screenshots
              let totalKeystrokes = 0
              let totalMouseMovements = 0
              let productivityScore = 0
              let activityCount = 0

              if (entry.screenshots) {
                entry.screenshots.forEach((screenshot: any) => {
                  if (screenshot.activity_logs && screenshot.activity_logs.length > 0) {
                    screenshot.activity_logs.forEach((log: any) => {
                      totalKeystrokes += log.keystrokes || 0
                      totalMouseMovements += log.mouse_movements || 0
                      productivityScore += log.productivity_score || 0
                      activityCount++
                    })
                  }
                })
              }

              // Calculate average productivity score
              const avgProductivityScore = activityCount > 0 ? productivityScore / activityCount : 0

              return {
                id: entry.id,
                start_time: entry.start_time,
                end_time: entry.end_time,
                duration: entry.duration,
                description: entry.description,
                projects: projects.length > 0 ? projects : [{ project_id: null, project_name: 'No Project', task_name: null }],
                activity: {
                  totalKeystrokes,
                  totalMouseMovements,
                  productivityScore: Math.round(avgProductivityScore * 10) / 10,
                },
              }
            })

            attendanceMap.set(`${userId}-${dateStr}`, {
              id: `${userId}-${dateStr}`,
              user_id: userId,
              date: dateStr,
              clock_in_time: clockIn?.toISOString() || null,
              clock_out_time: clockOut?.toISOString() || null,
              status,
              duration: totalDuration,
              profile: userProfile,
              timeEntries: processedEntries,
            })
          } else {
            // No time entries for this day - mark as absent
            attendanceMap.set(`${userId}-${dateStr}`, {
              id: `${userId}-${dateStr}`,
              user_id: userId,
              date: dateStr,
              clock_in_time: null,
              clock_out_time: null,
              status: 'absent',
              duration: 0,
              profile: userProfile,
            })
          }

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1)
        }
      }

      // Convert map to array and sort by date (descending)
      const attendanceRecords = Array.from(attendanceMap.values()).sort((a, b) => {
        return new Date(b.date).getTime() - new Date(a.date).getTime()
      })

      console.log('Calculated attendance records:', attendanceRecords.length)
      setRecords(attendanceRecords)
    } catch (error) {
      console.error('Error fetching attendance:', error)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (duration: number) => {
    if (!duration || duration === 0) return '—'
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  const filteredRecords = records.filter((record) =>
    record.profile?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.profile?.team?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleExportCSV = () => {
    // Create CSV headers
    const headers = ['Employee Name', 'Department', 'Date', 'Clock In Time', 'Status', 'Hours Worked']
    
    // Create CSV rows
    const rows = filteredRecords.map((record) => {
      const clockInIST = record.clock_in_time 
        ? toZonedTime(new Date(record.clock_in_time), IST_TIMEZONE)
        : null
      const hoursWorked = (record.duration || 0) / 3600
      
      return [
        record.profile?.full_name || 'Unknown',
        record.profile?.team || '—',
        record.date ? format(parseISO(record.date), 'MMM d, yyyy') : '—',
        clockInIST ? format(clockInIST, 'hh:mm a') : '—',
        record.status.charAt(0).toUpperCase() + record.status.slice(1).replace('_', ' '),
        hoursWorked.toFixed(2) + 'h'
      ]
    })
    
    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    
    // Generate filename with date range
    const filename = `attendance-report_${format(parseISO(startDate), 'yyyy-MM-dd')}_${format(parseISO(endDate), 'yyyy-MM-dd')}.csv`
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Export Report Section - At Top */}
      {(user.role === 'admin' || user.role === 'hr' || user.role === 'manager') && (
        <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Export Attendance Report</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export {filteredRecords.length} {filteredRecords.length === 1 ? 'record' : 'records'} 
                {startDate !== endDate && (
                  <span> from {format(parseISO(startDate), 'MMM d, yyyy')} to {format(parseISO(endDate), 'MMM d, yyyy')}</span>
                )}
                {startDate === endDate && (
                  <span> for {format(parseISO(startDate), 'MMM d, yyyy')}</span>
                )}
                {selectedUserIds.length > 0 && selectedUserIds.length < teamMembers.length && (
                  <span> for {selectedUserIds.length} selected {selectedUserIds.length === 1 ? 'employee' : 'employees'}</span>
                )}
              </p>
            </div>
            <button 
              onClick={handleExportCSV}
              disabled={filteredRecords.length === 0}
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              <span>Export to CSV</span>
            </button>
          </div>
        </div>
      )}

      {/* Filters Section */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm relative z-30">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-4 flex-1 min-w-[300px]">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Search Employees or Departments"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <button
              onClick={() => fetchAttendanceRecords()}
              disabled={loading}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm">Refresh</span>
            </button>
          </div>
          
        </div>

        {/* Date Range and User Filters */}
        <div className="flex items-center justify-between space-x-4 mt-4 flex-wrap">
          <div className="flex items-center space-x-4 flex-wrap">
            {/* User Filter - Multiple select with checkboxes */}
            <div className="relative flex items-center space-x-2" ref={userDropdownRef}>
              <User className="w-4 h-4 text-gray-500" />
            <div className="relative z-[100]">
              <button
                type="button"
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 min-w-[200px] text-left bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors"
              >
                <span className="text-sm">
                  {selectedUserIds.length === 0
                    ? `Select All (${teamMembers.length} members)`
                    : selectedUserIds.length === 1
                    ? teamMembers.find(m => m.id === selectedUserIds[0])?.full_name || 'Select Users'
                    : `${selectedUserIds.length} members selected`}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showUserDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-[90]"
                    onClick={() => setShowUserDropdown(false)}
                  ></div>
                  <div 
                    className="absolute z-[100] mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Select All Option */}
                    {(user.role === 'admin' || user.role === 'manager' || user.role === 'hr') && (
                      <label className="flex items-center space-x-2 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded cursor-pointer border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={teamMembers.length > 0 && selectedUserIds.length === teamMembers.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserIds(teamMembers.map(m => m.id))
                            } else {
                              setSelectedUserIds([])
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Select All</span>
                        <span className="text-xs text-gray-500">({teamMembers.length} members)</span>
                      </label>
                    )}
                    
                    {/* Individual Members */}
                    {teamMembers.map((member) => (
                      <label
                        key={member.id}
                        className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(member.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserIds([...selectedUserIds, member.id])
                            } else {
                              setSelectedUserIds(selectedUserIds.filter(id => id !== member.id))
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{member.full_name}</span>
                        {member.id === user.id && (
                          <span className="text-xs text-gray-500">(Me)</span>
                        )}
                        <span className="text-xs text-gray-500">({member.role})</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Date Range Picker */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-white dark:text-white" />
            <span className="text-sm text-gray-600 dark:text-gray-400">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const newStartDate = e.target.value
                setStartDate(newStartDate)
                // Ensure start date is not after end date
                if (newStartDate > endDate) {
                  setEndDate(newStartDate)
                }
              }}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const newEndDate = e.target.value
                setEndDate(newEndDate)
                // Ensure end date is not before start date
                if (newEndDate < startDate) {
                  setStartDate(newEndDate)
                }
              }}
              min={startDate}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

            {/* Quick Date Range Buttons */}
            <div className="flex items-center space-x-2">
              {activeDateRange === 'today' ? (
                <div className="px-[2px] py-[2px] bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-lg">
                  <button
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd')
                      setStartDate(today)
                      setEndDate(today)
                      setActiveDateRange('today')
                    }}
                    className="px-3 py-1 text-sm rounded-lg bg-white dark:bg-gray-800 text-blue-600 dark:text-white font-medium w-full"
                  >
                    Today
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const today = format(new Date(), 'yyyy-MM-dd')
                    setStartDate(today)
                    setEndDate(today)
                    setActiveDateRange('today')
                  }}
                  className="px-3 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Today
                </button>
              )}
              {activeDateRange === 'last7' ? (
                <div className="px-[2px] py-[2px] bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-lg">
                  <button
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd')
                      const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
                      setStartDate(weekAgo)
                      setEndDate(today)
                      setActiveDateRange('last7')
                    }}
                    className="px-3 py-1 text-sm rounded-lg bg-white dark:bg-gray-800 text-blue-600 dark:text-white font-medium w-full"
                  >
                    Last 7 Days
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const today = format(new Date(), 'yyyy-MM-dd')
                    const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
                    setStartDate(weekAgo)
                    setEndDate(today)
                    setActiveDateRange('last7')
                  }}
                  className="px-3 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Last 7 Days
                </button>
              )}
              {activeDateRange === 'last30' ? (
                <div className="px-[2px] py-[2px] bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-lg">
                  <button
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd')
                      const monthAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
                      setStartDate(monthAgo)
                      setEndDate(today)
                      setActiveDateRange('last30')
                    }}
                    className="px-3 py-1 text-sm rounded-lg bg-white dark:bg-gray-800 text-blue-600 dark:text-white font-medium w-full"
                  >
                    Last 30 Days
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const today = format(new Date(), 'yyyy-MM-dd')
                    const monthAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
                    setStartDate(monthAgo)
                    setEndDate(today)
                    setActiveDateRange('last30')
                  }}
                  className="px-3 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Last 30 Days
                </button>
              )}
            </div>
          </div>
          
          {/* Clear Filter Button - Rightmost side */}
          {(selectedUserIds.length !== 1 || selectedUserIds[0] !== user.id || startDate !== format(new Date(), 'yyyy-MM-dd') || endDate !== format(new Date(), 'yyyy-MM-dd') || searchTerm) && (
            <button
              onClick={() => {
                // Reset to default: show current user for today
                setSelectedUserIds([user.id])
                setStartDate(format(new Date(), 'yyyy-MM-dd'))
                setEndDate(format(new Date(), 'yyyy-MM-dd'))
                setSearchTerm('')
                setActiveDateRange('today')
              }}
              className="flex items-center space-x-2 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden backdrop-blur-sm relative z-10">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
              Attendance Records
            </h2>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {filteredRecords.length} {filteredRecords.length === 1 ? 'record' : 'records'} found
              {startDate !== endDate && (
                <span className="ml-2">
                  ({format(parseISO(startDate), 'MMM d')} - {format(parseISO(endDate), 'MMM d, yyyy')})
                </span>
              )}
              {startDate === endDate && (
                <span className="ml-2">
                  ({format(parseISO(startDate), 'MMM d, yyyy')})
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Employee Name</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Department</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Date</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Clock In Time</span>
                </th>
                {/* <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  Clock Out Time
                </th> */}
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Status</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Duration</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Project/Task</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12">
                    <Loader size="md" text="Loading attendance records" />
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-white dark:text-white" />
                    <p className="text-lg font-medium mb-2">No attendance records found</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      {startDate === endDate ? (
                        <>No time entries for {format(parseISO(startDate), 'MMMM d, yyyy')}</>
                      ) : (
                        <>No time entries between {format(parseISO(startDate), 'MMM d, yyyy')} and {format(parseISO(endDate), 'MMM d, yyyy')}</>
                      )}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                  // Convert times to IST for display
                  const clockInIST = record.clock_in_time 
                    ? toZonedTime(new Date(record.clock_in_time), IST_TIMEZONE)
                    : null
                  
                  // Aggregate project/task info from all time entries
                  const allProjects = new Map<string, { name: string; tasks: Set<string> }>()
                  
                  if (record.timeEntries && record.timeEntries.length > 0) {
                    record.timeEntries.forEach((entry) => {
                      entry.projects?.forEach((proj) => {
                        if (proj.project_id) {
                          if (!allProjects.has(proj.project_id)) {
                            allProjects.set(proj.project_id, { name: proj.project_name, tasks: new Set() })
                          }
                          if (proj.task_name) {
                            allProjects.get(proj.project_id)!.tasks.add(proj.task_name)
                          }
                        }
                      })
                    })
                  }

                  return (
                    <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold mr-3">
                              {record.profile?.full_name?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {record.profile?.full_name || 'Unknown'}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 dark:text-gray-400">{record.profile?.team || '—'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {record.date ? format(parseISO(record.date), 'MMM d, yyyy') : '—'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                            <Clock className="w-4 h-4" />
                            <span>
                              {clockInIST
                                ? format(clockInIST, 'hh:mm a')
                                : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.status === 'present' ? (
                          <span className="inline-flex items-center space-x-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
                            <CheckCircle className="w-4 h-4" />
                            <span>Present</span>
                          </span>
                        ) : record.status === 'half_day' ? (
                          <span className="inline-flex items-center space-x-1 px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded-full text-sm font-medium">
                            <Clock className="w-4 h-4" />
                            <span>Half Day</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded-full text-sm font-medium">
                            <XCircle className="w-4 h-4" />
                            <span>Absent</span>
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {formatDuration(record.duration)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-600 dark:text-gray-400 max-w-xs">
                          {allProjects.size > 0 ? (
                            <div className="space-y-1">
                              {Array.from(allProjects.entries()).slice(0, 2).map(([projectId, proj]) => (
                                <div key={projectId} className="flex flex-col">
                                  <span className="font-medium text-gray-900 dark:text-gray-100">{proj.name}</span>
                                  {proj.tasks.size > 0 && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {Array.from(proj.tasks).slice(0, 2).join(', ')}
                                      {proj.tasks.size > 2 && ` +${proj.tasks.size - 2} more`}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {allProjects.size > 2 && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  +{allProjects.size - 2} more project{allProjects.size - 2 > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">No Project</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
