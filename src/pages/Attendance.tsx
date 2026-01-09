import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, hrmsSupabase } from '../lib/supabase'
import { Search, Download, Calendar, Clock, CheckCircle, XCircle, User, X, RefreshCw, Plus, Edit2, Info, FileText } from 'lucide-react'
import { format, parseISO, subDays, subHours, addHours } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import Loader from '../components/Loader'
import type { Tables } from '../types/database'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
  status: 'present' | 'half_day' | 'late' | 'absent' | 'on_leave'
  duration: number // in seconds
  profile?: Profile
  app_version?: string | null // Tracker app version
  timeEntries?: Array<{
    id: string
    start_time: string
    end_time: string | null
    duration: number | null
    description: string | null
    app_version?: string | null
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
  // HR and Accountant should see all users by default (empty array = Select All)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    (user.role === 'hr' || user.role === 'accountant') ? [] : [user.id]
  )
  const [activeDateRange, setActiveDateRange] = useState<'today' | 'last7' | 'last30' | 'custom'>('today')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selectedUserIdsRef = useRef<string[]>(selectedUserIds)
  const userDropdownRef = useRef<HTMLDivElement>(null)
  const userDropdownButtonRef = useRef<HTMLButtonElement>(null)
  const [userDropdownPosition, setUserDropdownPosition] = useState({ top: 0, left: 0 })
  
  // Time entry modal states
  const [showTimeEntryModal, setShowTimeEntryModal] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null)
  const [timeEntryForm, setTimeEntryForm] = useState({
    user_id: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '',
    duration: '', // Duration in hours (as string for input)
    description: '',
  })

  const IST_TIMEZONE = 'Asia/Kolkata'
  const TRACKER_RESET_HOUR = 6 // 6 AM IST

  // Keep ref in sync with state
  useEffect(() => {
    selectedUserIdsRef.current = selectedUserIds
  }, [selectedUserIds])

  // Auto-set user_id for non-admin users when modal opens
  useEffect(() => {
    if (showTimeEntryModal && timeEntryForm.user_id === '' && 
        !(user.role === 'admin' || user.role === 'hr' || user.role === 'manager' || user.role === 'accountant')) {
      setTimeEntryForm(prev => ({ ...prev, user_id: user.id }))
    }
  }, [showTimeEntryModal, user.id, user.role])

  // Calculate dropdown position when opening
  useEffect(() => {
    if (showUserDropdown && userDropdownButtonRef.current) {
      const buttonRect = userDropdownButtonRef.current.getBoundingClientRect()
      setUserDropdownPosition({
        top: buttonRect.bottom + 4, // 4px gap (mt-1 = 0.25rem = 4px)
        left: buttonRect.left,
      })
    }
  }, [showUserDropdown])

  // Handle clicks outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(event.target as Node) &&
        userDropdownButtonRef.current &&
        !userDropdownButtonRef.current.contains(event.target as Node)
      ) {
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
    // For employees, we can fetch immediately since teamMembers will only contain themselves
    // For others, wait a bit to ensure teamMembers are loaded, or fetch anyway (fallback will handle missing profiles)
    fetchAttendanceRecords()
  }, [selectedUserIds, startDate, endDate])

  const fetchTeamMembers = async () => {
    try {
      if (user.role === 'admin' || user.role === 'hr' || user.role === 'accountant') {
        // Admin, HR, and Accountant can see all users
        const { data } = await supabase.from('profiles').select('*').order('full_name')
        setTeamMembers(data || [])
      } else if (user.role === 'manager') {
        // Manager can see their team members - get all users who have this manager assigned
        const { data: teamMembers } = await supabase
          .from('profiles')
          .select('*')
          .eq('manager_id', user.id)
          .order('full_name')

        setTeamMembers([user, ...(teamMembers || [])])
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
      setError(null)
      
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

      // Determine if we're fetching for all users (Select All mode)
      const isSelectAllMode = currentSelectedUserIds.length === 0 && 
        (user.role === 'admin' || user.role === 'manager' || user.role === 'hr' || user.role === 'accountant')

      // For Select All mode, fetch basic data first to avoid timeout
      // For specific users, fetch full nested data
      const selectQuery = isSelectAllMode 
        ? `id, user_id, start_time, end_time, duration, description, app_version, profile:profiles!time_entries_user_id_fkey(id, full_name, email, team)`
        : `*,
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
          )`
      
      let query = supabase
        .from('time_entries')
        .select(selectQuery)
        .gte('start_time', queryStart.toISOString())
        .lte('start_time', queryEnd.toISOString())
        .order('start_time', { ascending: false })

      // Apply user filter - if specific users selected, filter by them
      // IMPORTANT: Use currentSelectedUserIds to ensure we use the latest state
      if (currentSelectedUserIds.length > 0) {
        query = query.in('user_id', currentSelectedUserIds)
      }

      // Increase limit for Select All mode, but still reasonable
      // Note: For Select All with large date ranges, consider reducing the limit further
      const limit = isSelectAllMode ? 5000 : 1000
      
      const { data: timeEntries, error } = await query.limit(limit)

      if (error) {
        // Handle specific timeout error (PostgreSQL error code 57014)
        if (error.code === '57014' || 
            error.message?.includes('timeout') || 
            error.message?.includes('canceling statement') ||
            error.message?.includes('statement timeout')) {
          throw new Error('Query timeout - the date range or number of users may be too large. Please try selecting fewer users or a smaller date range.')
        }
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Fetched time entries:', timeEntries?.length || 0)

      // Calculate attendance records from time entries
      const attendanceMap = new Map<string, AttendanceRecord>()

      // Get all unique user IDs from time entries
      const userIds = new Set<string>()
      const entries = (timeEntries || []) as unknown as Array<TimeEntry & { profile?: Profile; app_version?: string | null }>
      entries.forEach((entry) => {
        if (entry.user_id) {
          userIds.add(entry.user_id)
        }
      })

      // IMPORTANT: Always use currentSelectedUserIds from ref to ensure we use the latest state
      // If filtering by specific users, only include those users
      // If no users selected (empty array) AND user has permission, show all team members
      // Otherwise, only show the selected users
      let usersToProcess: string[]
      if (currentSelectedUserIds.length > 0) {
        // Filter by selected users only
        usersToProcess = currentSelectedUserIds
      } else {
        // No users selected - show all team members (not just those with time entries)
        // This ensures leave status can be shown for all visible users
        if (user.role === 'admin' || user.role === 'manager' || user.role === 'hr' || user.role === 'accountant') {
          // Include all team members, not just those with time entries
          usersToProcess = teamMembers.map(m => m.id)
        } else {
          // Employee can only see themselves
          usersToProcess = [user.id]
        }
      }

      // For each user, calculate attendance for each day in the date range
      for (const userId of usersToProcess) {
        // Get user profile from teamMembers first, then from time entries
        const userEntries = entries.filter((e) => e.user_id === userId)
        let userProfile = teamMembers.find(m => m.id === userId)
        
        // If not found in teamMembers, try to get from time entries
        if (!userProfile && userEntries.length > 0) {
          userProfile = userEntries[0]?.profile
        }
        
        // If still not found, fetch it directly (fallback)
        if (!userProfile) {
          try {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', userId)
              .single()
            if (profileData) {
              userProfile = profileData
            }
          } catch (error) {
            console.error('Error fetching profile for user:', userId, error)
          }
        }

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
            // Note: In Select All mode, nested data may not be fetched to avoid timeout
            const processedEntries = dayEntries.map((entry: any) => {
              // Extract project and task information (may be missing in Select All mode)
              const projects = (entry.project_time_entries || []).map((pte: any) => ({
                project_id: pte.project_id,
                project_name: pte.projects?.name || 'No Project',
                task_name: pte.projects?.tasks?.name || null,
              })).filter((p: any) => p.project_id !== null && p.project_name !== 'No Project')

              // Calculate activity totals from screenshots (may be missing in Select All mode)
              let totalKeystrokes = 0
              let totalMouseMovements = 0
              let productivityScore = 0
              let activityCount = 0

              if (entry.screenshots && Array.isArray(entry.screenshots)) {
                entry.screenshots.forEach((screenshot: any) => {
                  if (screenshot?.activity_logs && Array.isArray(screenshot.activity_logs)) {
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
                app_version: entry.app_version || null,
                projects: projects.length > 0 ? projects : [],
                activity: {
                  totalKeystrokes,
                  totalMouseMovements,
                  productivityScore: Math.round(avgProductivityScore * 10) / 10,
                },
              }
            })

            // Get the most common app_version from all entries for this day
            const appVersions = processedEntries.map((e) => e.app_version).filter(Boolean) as string[]
            const mostCommonVersion = appVersions.length > 0 
              ? appVersions.reduce((a: string, b: string, _: number, arr: string[]) => 
                  arr.filter((v: string) => v === a).length >= arr.filter((v: string) => v === b).length ? a : b
                )
              : null

            attendanceMap.set(`${userId}-${dateStr}`, {
              id: `${userId}-${dateStr}`,
              user_id: userId,
              date: dateStr,
              clock_in_time: clockIn?.toISOString() || null,
              clock_out_time: clockOut?.toISOString() || null,
              status,
              duration: totalDuration,
              profile: userProfile,
              app_version: mostCommonVersion,
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
      let attendanceRecords = Array.from(attendanceMap.values()).sort((a, b) => {
        return new Date(b.date).getTime() - new Date(a.date).getTime()
      })

      // Fetch approved leave applications from HRMS database
      try {
        // Get all user emails from both attendance records and team members
        // This ensures we fetch leave data for all visible users, not just those with time entries
        const userEmails = new Set<string>()
        
        // Add emails from attendance records
        attendanceRecords.forEach(record => {
          if (record.profile?.email) {
            userEmails.add(record.profile.email.toLowerCase())
          }
        })
        
        // Add emails from team members (all users the current user can see)
        teamMembers.forEach(member => {
          if (member.email) {
            userEmails.add(member.email.toLowerCase())
          }
        })

        if (userEmails.size > 0) {
          // Also try case-insensitive matching by fetching all users and matching manually
          // This handles cases where email casing might differ
          const { data: allHrmsUsers } = await hrmsSupabase
            .from('users')
            .select('id, email')

          // Create case-insensitive email mapping
          const hrmsUsersMap = new Map<string, { id: string; email: string }>()
          if (allHrmsUsers) {
            allHrmsUsers.forEach(hrmsUser => {
              if (hrmsUser.email) {
                const emailLower = hrmsUser.email.toLowerCase()
                // Check if this email matches any of our user emails
                if (userEmails.has(emailLower)) {
                  hrmsUsersMap.set(emailLower, hrmsUser)
                }
              }
            })
          }

          if (hrmsUsersMap.size > 0) {
            // Create email to HRMS user_id mapping
            const emailToHrmsUserId = new Map<string, string>()
            const hrmsUserIds = new Set<string>()
            hrmsUsersMap.forEach((hrmsUser, emailLower) => {
              if (hrmsUser.id) {
                emailToHrmsUserId.set(emailLower, hrmsUser.id)
                hrmsUserIds.add(hrmsUser.id)
              }
            })

            // Fetch approved leave applications for the date range and matching users
            const { data: leaveApplications } = await hrmsSupabase
              .from('leave_applications')
              .select('user_id, start_date, end_date, status')
              .eq('status', 'approved')
              .in('user_id', Array.from(hrmsUserIds))
              .lte('start_date', endDate)
              .gte('end_date', startDate)

            if (leaveApplications && leaveApplications.length > 0) {
              console.log('Found leave applications:', leaveApplications.length)
              
              // Create a case-insensitive map of email -> tracker user_id for quick lookup
              const emailToTrackerUserId = new Map<string, string>()
              teamMembers.forEach(member => {
                if (member.email && member.id) {
                  emailToTrackerUserId.set(member.email.toLowerCase(), member.id)
                }
              })
              
              // Also add from attendance records (in case profile is missing from teamMembers)
              attendanceRecords.forEach(record => {
                if (record.profile?.email && record.user_id) {
                  emailToTrackerUserId.set(record.profile.email.toLowerCase(), record.user_id)
                }
              })

              console.log('Email mappings - Team members:', Array.from(emailToTrackerUserId.keys()))
              console.log('HRMS users found:', Array.from(hrmsUsersMap.keys()))

              // Create a map of user_id -> dates on leave
              const userLeaveDates = new Map<string, Set<string>>()

              leaveApplications.forEach(leave => {
                const hrmsUserId = leave.user_id
                // Find the HRMS user by ID
                const hrmsUser = Array.from(hrmsUsersMap.values()).find(u => u.id === hrmsUserId)
                
                if (hrmsUser && hrmsUser.email) {
                  // Find the tracker user_id by matching email (case-insensitive)
                  const trackerUserId = emailToTrackerUserId.get(hrmsUser.email.toLowerCase())
                  
                  if (trackerUserId) {
                    console.log(`Matched leave for ${hrmsUser.email} -> tracker user ${trackerUserId}, dates: ${leave.start_date} to ${leave.end_date}`)
                    
                    // Generate all dates in the leave range
                    const leaveStart = parseISO(leave.start_date)
                    const leaveEnd = parseISO(leave.end_date)
                    const currentLeaveDate = new Date(leaveStart)

                    while (currentLeaveDate <= leaveEnd) {
                      const dateStr = format(currentLeaveDate, 'yyyy-MM-dd')
                      
                      // Only include dates within the selected date range
                      if (dateStr >= startDate && dateStr <= endDate) {
                        if (!userLeaveDates.has(trackerUserId)) {
                          userLeaveDates.set(trackerUserId, new Set())
                        }
                        userLeaveDates.get(trackerUserId)!.add(dateStr)
                      }

                      currentLeaveDate.setDate(currentLeaveDate.getDate() + 1)
                    }
                  } else {
                    console.warn(`Could not match HRMS user ${hrmsUser.email} to any tracker user`)
                  }
                }
              })

              console.log('User leave dates mapped:', Array.from(userLeaveDates.entries()).map(([id, dates]) => ({ userId: id, dates: Array.from(dates) })))

              // Update existing attendance records to show "on_leave" status
              attendanceRecords = attendanceRecords.map(record => {
                const leaveDates = userLeaveDates.get(record.user_id)
                if (leaveDates && leaveDates.has(record.date)) {
                  return {
                    ...record,
                    status: 'on_leave' as const,
                  }
                }
                return record
              })

              // Create attendance records for leave dates that don't have time entries
              // This ensures users on leave show up even if they have no time entries
              userLeaveDates.forEach((leaveDateSet, trackerUserId) => {
                const userProfile = teamMembers.find(m => m.id === trackerUserId)
                if (userProfile) {
                  leaveDateSet.forEach(dateStr => {
                    // Check if record already exists
                    const existingRecord = attendanceRecords.find(
                      r => r.user_id === trackerUserId && r.date === dateStr
                    )
                    
                    if (!existingRecord) {
                      // Create a new attendance record for this leave date
                      attendanceRecords.push({
                        id: `${trackerUserId}-${dateStr}`,
                        user_id: trackerUserId,
                        date: dateStr,
                        clock_in_time: null,
                        clock_out_time: null,
                        status: 'on_leave',
                        duration: 0,
                        profile: userProfile,
                      })
                    }
                  })
                }
              })

              // Re-sort attendance records after adding leave records
              attendanceRecords = attendanceRecords.sort((a, b) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime()
              })
            }
          }
        }
      } catch (error) {
        console.error('Error fetching leave applications from HRMS:', error)
        // Continue with attendance records even if leave fetch fails
      }

      console.log('Calculated attendance records:', attendanceRecords.length)
      setRecords(attendanceRecords)
    } catch (err: any) {
      console.error('Error fetching attendance:', err)
      const errorMessage = err.message || 'Failed to fetch attendance records. Please try again.'
      setError(errorMessage)
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

  const openAddTimeEntryModal = () => {
    // Only allow manager and admin to add time entries
    if (user.role !== 'manager' && user.role !== 'admin') {
      return
    }
    
    setEditingRecord(null)
    // Default to current user if not admin/HR/manager/accountant
    const canSelectUser = ['admin', 'hr', 'manager', 'accountant'].includes(user.role)
    const defaultUserId = canSelectUser ? '' : user.id
    setTimeEntryForm({
      user_id: defaultUserId,
      date: format(new Date(), 'yyyy-MM-dd'),
      start_time: '',
      duration: '',
      description: '',
    })
    setShowTimeEntryModal(true)
  }

  const openEditTimeEntryModal = (record: AttendanceRecord) => {
    // Only allow manager and admin to edit time entries
    if (user.role !== 'manager' && user.role !== 'admin') {
      return
    }
    
    setEditingRecord(record)
    // Pre-fill with the first time entry if available, or use clock in/out times
    const firstEntry = record.timeEntries && record.timeEntries.length > 0 ? record.timeEntries[0] : null
    
    if (firstEntry) {
      const startTime = new Date(firstEntry.start_time)
      // Convert duration from seconds to hours (with 2 decimal places)
      const durationHours = firstEntry.duration ? (firstEntry.duration / 3600).toFixed(2) : ''
      
      setTimeEntryForm({
        user_id: record.user_id,
        date: record.date,
        start_time: format(startTime, "yyyy-MM-dd'T'HH:mm"),
        duration: durationHours,
        description: firstEntry.description || '',
      })
    } else if (record.clock_in_time) {
      const clockIn = new Date(record.clock_in_time)
      // Convert duration from seconds to hours (with 2 decimal places)
      const durationHours = record.duration ? (record.duration / 3600).toFixed(2) : ''
      
      setTimeEntryForm({
        user_id: record.user_id,
        date: record.date,
        start_time: format(clockIn, "yyyy-MM-dd'T'HH:mm"),
        duration: durationHours,
        description: '',
      })
    } else {
      setTimeEntryForm({
        user_id: record.user_id,
        date: record.date,
        start_time: '',
        duration: '',
        description: '',
      })
    }
    setShowTimeEntryModal(true)
  }

  const handleSaveTimeEntry = () => {
    // Validate first
    if (!timeEntryForm.user_id || !timeEntryForm.date || !timeEntryForm.start_time) {
      alert('Please fill in all required fields (User, Date, and Start Time)')
      return
    }

    if (!timeEntryForm.duration || timeEntryForm.duration.trim() === '') {
      alert('Please enter the duration in hours')
      return
    }

    // Show confirmation modal instead of directly saving
    setShowConfirmationModal(true)
  }

  const handleConfirmSaveTimeEntry = async () => {
    try {
      // Close confirmation modal
      setShowConfirmationModal(false)

      const startTime = new Date(timeEntryForm.start_time)
      
      // Convert duration from hours to seconds
      const hours = parseFloat(timeEntryForm.duration)
      if (isNaN(hours) || hours < 0) {
        alert('Please enter a valid duration (must be a positive number)')
        return
      }
      const duration = Math.floor(hours * 3600)

      if (editingRecord && editingRecord.timeEntries && editingRecord.timeEntries.length > 0) {
        // Update existing time entry
        const entryId = editingRecord.timeEntries[0].id
        
        const { error: updateError } = await supabase
          .from('time_entries')
          .update({
            start_time: startTime.toISOString(),
            end_time: null,
            duration: duration,
            description: timeEntryForm.description || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', entryId)

        if (updateError) throw updateError
      } else {
        // Create new time entry
        const { error: insertError } = await supabase
          .from('time_entries')
          .insert({
            user_id: timeEntryForm.user_id,
            start_time: startTime.toISOString(),
            end_time: null,
            duration: duration,
            description: timeEntryForm.description || null,
          })

        if (insertError) throw insertError
      }

      // Refresh attendance records
      await fetchAttendanceRecords()
      setShowTimeEntryModal(false)
      setEditingRecord(null)
      setTimeEntryForm({
        user_id: user.id,
        date: format(new Date(), 'yyyy-MM-dd'),
        start_time: '',
        duration: '',
        description: '',
      })
    } catch (error: any) {
      console.error('Error saving time entry:', error)
      alert(`Error saving time entry: ${error.message || 'Unknown error'}`)
    }
  }

  const handleCancelConfirmation = () => {
    setShowConfirmationModal(false)
  }

  const filteredRecords = records.filter((record) => {
    // Filter by selected users first
    if (selectedUserIds.length > 0 && !selectedUserIds.includes(record.user_id)) {
      return false
    }
    
    // Then filter by search term
    if (searchTerm) {
      const matchesSearch = 
        record.profile?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.profile?.team?.toLowerCase().includes(searchTerm.toLowerCase())
      return matchesSearch
    }
    
    return true
  })

  // Helper function to get Monday of the week for a given date
  const getMondayOfWeek = (date: Date): Date => {
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    return new Date(date.setDate(diff))
  }

  // Helper function to get the week key (Monday date) for grouping
  const getWeekKey = (dateStr: string): string => {
    const date = parseISO(dateStr)
    const monday = getMondayOfWeek(new Date(date))
    return format(monday, 'yyyy-MM-dd')
  }

  const handleExportCSV = () => {
    // Generate all dates in the range
    const allDates: string[] = []
    const currentDate = new Date(parseISO(startDate))
    const endDateObj = parseISO(endDate)
    
    while (currentDate <= endDateObj) {
      allDates.push(format(currentDate, 'yyyy-MM-dd'))
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    // Group dates by week (Monday-Sunday)
    const datesByWeek = new Map<string, string[]>()
    allDates.forEach(date => {
      const weekKey = getWeekKey(date)
      if (!datesByWeek.has(weekKey)) {
        datesByWeek.set(weekKey, [])
      }
      datesByWeek.get(weekKey)!.push(date)
    })
    
    // Group records by employee
    const employeeMap = new Map<string, {
      name: string
      records: Map<string, AttendanceRecord>
    }>()
    
    filteredRecords.forEach((record) => {
      const employeeId = record.user_id
      const employeeName = record.profile?.full_name || 'Unknown'
      
      if (!employeeMap.has(employeeId)) {
        employeeMap.set(employeeId, {
          name: employeeName,
          records: new Map()
        })
      }
      
      employeeMap.get(employeeId)!.records.set(record.date, record)
    })
    
    // Create CSV headers with day name, date, and sub-columns (Status, Duration)
    // Also add weekly total columns after every 7 days
    const headers: string[] = ['Employee Name']
    
    allDates.forEach((date, index) => {
      const dateObj = parseISO(date)
      // Format: "9 January 2025 (Monday)" (day number, full month name, year, day name in parentheses)
      const dayName = format(dateObj, 'EEEE') // Monday, Tuesday, etc.
      const dateStr = format(dateObj, 'd MMMM yyyy')
      const header = `${dateStr} (${dayName})`
      
      // Add Status and Duration sub-columns for each date
      headers.push(`${header} - Status`, `${header} - Duration`)
      
      // Add weekly total column after Sunday (end of week) or at the end
      const dayOfWeek = format(dateObj, 'EEEE')
      if (dayOfWeek === 'Sunday' || index === allDates.length - 1) {
        // Find Monday and Sunday of this week
        const weekKey = getWeekKey(date)
        const weekDates = datesByWeek.get(weekKey) || []
        if (weekDates.length > 0) {
          const weekStart = weekDates[0] // Monday
          const weekEnd = weekDates[weekDates.length - 1] // Sunday (or last day of week)
          const weekStartFormatted = format(parseISO(weekStart), 'MMM d')
          const weekEndFormatted = format(parseISO(weekEnd), 'MMM d, yyyy')
          headers.push(`Week Total (${weekStartFormatted} - ${weekEndFormatted})`)
        }
      }
    })
    
    // Create CSV rows - one row per employee
    const rows = Array.from(employeeMap.values()).map((employee) => {
      const row: string[] = [employee.name]
      const weekTotals = new Map<string, number>() // Track totals by week key
      
      // For each date, add Status and Duration
      allDates.forEach((date, index) => {
        const record = employee.records.get(date)
        const dateObj = parseISO(date)
        const dayOfWeek = format(dateObj, 'EEEE') // Get day name
        const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday'
        const weekKey = getWeekKey(date)
        
        if (record) {
          const hoursWorked = (record.duration || 0) / 3600
          let status = record.status.charAt(0).toUpperCase() + record.status.slice(1).replace('_', ' ')
          
          // If it's weekend and status is absent with no hours, show "Weekend" instead
          if (isWeekend && record.status === 'absent' && hoursWorked === 0) {
            status = 'Weekend'
          }
          
          // Add Status
          row.push(status)
          
          // Add Duration
          const durationStr = hoursWorked > 0 ? `${hoursWorked.toFixed(2)}h` : '—'
          row.push(durationStr)
          
          // Add to week total
          if (hoursWorked > 0) {
            if (!weekTotals.has(weekKey)) {
              weekTotals.set(weekKey, 0)
            }
            weekTotals.set(weekKey, weekTotals.get(weekKey)! + hoursWorked)
          }
        } else {
          // No record for this date - check if it's a weekend
          if (isWeekend) {
            row.push('Weekend', '—')
          } else {
            row.push('—', '—')
          }
        }
        
        // Add weekly total column after Sunday (end of week) or at the end
        if (dayOfWeek === 'Sunday' || index === allDates.length - 1) {
          const weekTotal = weekTotals.get(weekKey) || 0
          row.push(weekTotal > 0 ? `${weekTotal.toFixed(2)}h` : '—')
        }
      })
      
      return row
    })
    
    // Sort rows by employee name
    rows.sort((a, b) => a[0].localeCompare(b[0]))
    
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

  const handleExportPDF = () => {
    // Generate all dates in the range
    const allDates: string[] = []
    const currentDate = new Date(parseISO(startDate))
    const endDateObj = parseISO(endDate)
    
    while (currentDate <= endDateObj) {
      allDates.push(format(currentDate, 'yyyy-MM-dd'))
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    // Group dates by week (Monday-Sunday)
    const datesByWeek = new Map<string, string[]>()
    allDates.forEach(date => {
      const weekKey = getWeekKey(date)
      if (!datesByWeek.has(weekKey)) {
        datesByWeek.set(weekKey, [])
      }
      datesByWeek.get(weekKey)!.push(date)
    })
    
    // Group records by employee
    const employeeMap = new Map<string, {
      name: string
      records: Map<string, AttendanceRecord>
    }>()
    
    filteredRecords.forEach((record) => {
      const employeeId = record.user_id
      const employeeName = record.profile?.full_name || 'Unknown'
      
      if (!employeeMap.has(employeeId)) {
        employeeMap.set(employeeId, {
          name: employeeName,
          records: new Map()
        })
      }
      
      employeeMap.get(employeeId)!.records.set(record.date, record)
    })
    
    // Create PDF
    const doc = new jsPDF('landscape', 'mm', 'a4')
    
    // Colors
    const primaryColor: [number, number, number] = [41, 128, 185] // Blue
    const headerColor: [number, number, number] = [52, 73, 94] // Dark gray
    const orangeColor: [number, number, number] = [255, 152, 0] // Orange for < 7.30 hours
    const lightGray: [number, number, number] = [236, 240, 241]
    
    // Add header with title and export info
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2])
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 30, 'F')
    
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20)
    doc.setFont('helvetica', 'bold')
    doc.text('Attendance Report', 15, 20)
    
    // Export date and time
    const exportDateTime = new Date()
    const exportDateStr = format(exportDateTime, 'MMMM d, yyyy')
    const exportTimeStr = format(exportDateTime, 'hh:mm:ss a')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Exported on: ${exportDateStr} at ${exportTimeStr}`, doc.internal.pageSize.getWidth() - 15, 20, { align: 'right' })
    
    // Date range
    const dateRangeStr = startDate === endDate
      ? format(parseISO(startDate), 'MMMM d, yyyy')
      : `${format(parseISO(startDate), 'MMMM d, yyyy')} - ${format(parseISO(endDate), 'MMMM d, yyyy')}`
    doc.text(`Period: ${dateRangeStr}`, doc.internal.pageSize.getWidth() - 15, 25, { align: 'right' })
    
    // Prepare table data
    const tableData: any[] = []
    const tableHeaders: string[] = ['Employee Name']
    
    // Build headers with dates
    allDates.forEach((date, index) => {
      const dateObj = parseISO(date)
      const dayName = format(dateObj, 'EEEE')
      const dateStr = format(dateObj, 'd MMMM yyyy')
      const header = `${dateStr} (${dayName})`
      
      tableHeaders.push(`${header} - Status`, `${header} - Duration`)
      
      // Add weekly total column after Sunday (end of week) or at the end
      const dayOfWeek = format(dateObj, 'EEEE')
      if (dayOfWeek === 'Sunday' || index === allDates.length - 1) {
        // Find Monday and Sunday of this week
        const weekKey = getWeekKey(date)
        const weekDates = datesByWeek.get(weekKey) || []
        if (weekDates.length > 0) {
          const weekStart = weekDates[0] // Monday
          const weekEnd = weekDates[weekDates.length - 1] // Sunday (or last day of week)
          const weekStartFormatted = format(parseISO(weekStart), 'MMM d')
          const weekEndFormatted = format(parseISO(weekEnd), 'MMM d, yyyy')
          tableHeaders.push(`Week Total\n(${weekStartFormatted} - ${weekEndFormatted})`)
        }
      }
    })
    
    // Build table rows
    const employees = Array.from(employeeMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    
    employees.forEach((employee) => {
      const row: any[] = [employee.name]
      const weekTotals = new Map<string, number>() // Track totals by week key
      
      allDates.forEach((date, index) => {
        const record = employee.records.get(date)
        const dateObj = parseISO(date)
        const dayOfWeek = format(dateObj, 'EEEE')
        const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday'
        const weekKey = getWeekKey(date)
        
        if (record) {
          const hoursWorked = (record.duration || 0) / 3600
          let status = record.status.charAt(0).toUpperCase() + record.status.slice(1).replace('_', ' ')
          
          if (isWeekend && record.status === 'absent' && hoursWorked === 0) {
            status = 'Weekend'
          }
          
          row.push(status)
          
          const durationStr = hoursWorked > 0 ? `${hoursWorked.toFixed(2)}h` : '—'
          row.push(durationStr)
          
          // Add to week total
          if (hoursWorked > 0) {
            if (!weekTotals.has(weekKey)) {
              weekTotals.set(weekKey, 0)
            }
            weekTotals.set(weekKey, weekTotals.get(weekKey)! + hoursWorked)
          }
        } else {
          if (isWeekend) {
            row.push('Weekend', '—')
          } else {
            row.push('—', '—')
          }
        }
        
        // Add weekly total column after Sunday (end of week) or at the end
        if (dayOfWeek === 'Sunday' || index === allDates.length - 1) {
          const weekTotal = weekTotals.get(weekKey) || 0
          row.push(weekTotal > 0 ? `${weekTotal.toFixed(2)}h` : '—')
        }
      })
      
      tableData.push(row)
    })
    
    // Add table with autoTable
    let startY = 40
    const pageWidth = doc.internal.pageSize.getWidth()
    const availableWidth = pageWidth - 20 // 10mm margin on each side
    
    // Calculate column widths dynamically
    const numDateColumns = allDates.length * 2 // Status + Duration for each date
    
    // Employee name gets fixed width, rest is distributed
    const employeeNameWidth = 30
    const remainingWidth = availableWidth - employeeNameWidth
    
    // Calculate how many week total columns we have (count Sundays and last day)
    let weekTotalCount = 0
    for (let i = 0; i < allDates.length; i++) {
      const dateObj = parseISO(allDates[i])
      const dayOfWeek = format(dateObj, 'EEEE')
      if (dayOfWeek === 'Sunday' || i === allDates.length - 1) {
        weekTotalCount++
      }
    }
    
    // Distribute width: 85% for date columns, 15% for week totals
    const dateColumnsTotal = numDateColumns
    const weekTotalColumnsTotal = weekTotalCount
    const dateColumnWidth = (remainingWidth * 0.85) / dateColumnsTotal
    const weekTotalWidth = weekTotalColumnsTotal > 0 ? (remainingWidth * 0.15) / weekTotalColumnsTotal : 20
    
    // Build column styles
    const columnStyles: any = {
      0: { cellWidth: employeeNameWidth, fontStyle: 'bold', fontSize: 6 },
    }
    
    // Track which columns are week totals
    const weekTotalColumnIndices = new Set<number>()
    let colIndex = 1
    for (let dateIndex = 0; dateIndex < allDates.length; dateIndex++) {
      // Status column
      columnStyles[colIndex] = { cellWidth: dateColumnWidth, fontSize: 6 }
      colIndex++
      // Duration column
      columnStyles[colIndex] = { cellWidth: dateColumnWidth, fontSize: 6 }
      colIndex++
      
      // Add week total column after every 7 days
      if ((dateIndex + 1) % 7 === 0 || dateIndex === allDates.length - 1) {
        weekTotalColumnIndices.add(colIndex)
        columnStyles[colIndex] = { cellWidth: weekTotalWidth, fontSize: 6, fontStyle: 'bold' }
        colIndex++
      }
    }
    
    autoTable(doc, {
      head: [tableHeaders],
      body: tableData,
      startY: startY,
      theme: 'striped',
      headStyles: {
        fillColor: [headerColor[0], headerColor[1], headerColor[2]],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 6,
        halign: 'center',
        valign: 'middle',
        cellPadding: 1,
      },
      bodyStyles: {
        fontSize: 6,
        textColor: [44, 62, 80],
        cellPadding: 1,
      },
      alternateRowStyles: {
        fillColor: [lightGray[0], lightGray[1], lightGray[2]],
      },
      columnStyles: columnStyles,
      didParseCell: (data: any) => {
        const colIndex = data.column.index
        const cellValue = data.cell.text[0]
        
        // Check if this is a week total column
        if (weekTotalColumnIndices.has(colIndex)) {
          if (cellValue && cellValue !== '—' && typeof cellValue === 'string' && cellValue.includes('h')) {
            const hours = parseFloat(cellValue.replace('h', ''))
            if (!isNaN(hours) && hours < 40) {
              // Highlight week totals < 40 hours in red
              data.cell.styles.fillColor = [220, 53, 69] // Red color
              data.cell.styles.textColor = [255, 255, 255]
              data.cell.styles.fontStyle = 'bold'
            }
          }
        }
        // Check if this is a duration cell (even column indices after employee name: 2, 4, 6, etc.)
        else if (colIndex > 0 && colIndex % 2 === 0) {
          if (cellValue && cellValue !== '—' && typeof cellValue === 'string' && cellValue.includes('h')) {
            const hours = parseFloat(cellValue.replace('h', ''))
            if (!isNaN(hours) && hours < 7.30) {
              // Find the corresponding date for this column to check if it's a weekday
              // Column structure: 0=Employee, 1=Date1-Status, 2=Date1-Duration, 3=Date2-Status, 4=Date2-Duration, etc.
              // Duration columns are at indices 2, 4, 6, 8... which correspond to dates at indices 0, 1, 2, 3...
              const dateIndex = Math.floor((colIndex - 2) / 2)
              if (dateIndex >= 0 && dateIndex < allDates.length) {
                const date = allDates[dateIndex]
                const dateObj = parseISO(date)
                const dayOfWeek = format(dateObj, 'EEEE')
                const isWeekday = dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday'
                
                // Only highlight weekdays (Monday-Friday) in orange
                if (isWeekday) {
                  data.cell.styles.fillColor = [orangeColor[0], orangeColor[1], orangeColor[2]]
                  data.cell.styles.textColor = [255, 255, 255]
                  data.cell.styles.fontStyle = 'bold'
                }
              }
            }
          }
        }
      },
      margin: { top: startY, left: 10, right: 10, bottom: 15 },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'auto',
        lineWidth: 0.1,
      },
      tableWidth: 'wrap',
      showHead: 'everyPage',
      showFoot: 'never',
    })
    
    // Add footer on each page
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(128, 128, 128)
      doc.text(
        `Page ${i} of ${pageCount} | TimeFlow Attendance Report`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      )
    }
    
    // Save PDF
    const filename = `attendance-report_${format(parseISO(startDate), 'yyyy-MM-dd')}_${format(parseISO(endDate), 'yyyy-MM-dd')}.pdf`
    doc.save(filename)
  }

  return (
    <div className="space-y-6">
      {/* Add New Time Entry Button - At Top - Only for Manager and Admin */}
      {(user.role === 'manager' || user.role === 'admin') && (
        <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Time Entry Management</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Add new time entries or manage existing attendance records
              </p>
            </div>
            <button 
              onClick={openAddTimeEntryModal}
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm font-medium"
            >
              <Plus className="w-5 h-5" />
              <span>Add New Time Entry</span>
            </button>
          </div>
        </div>
      )}

      {/* Export Report Section - At Top */}
      {(user.role === 'admin' || user.role === 'hr' || user.role === 'manager' || user.role === 'accountant') && (
        <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Export Attendance Report</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Export {filteredRecords.length} {filteredRecords.length === 1 ? 'record' : 'records'} 
                {startDate && endDate && startDate !== endDate && (
                  <span> from {format(parseISO(startDate), 'MMM d, yyyy')} to {format(parseISO(endDate), 'MMM d, yyyy')}</span>
                )}
                {startDate && endDate && startDate === endDate && (
                  <span> for {format(parseISO(startDate), 'MMM d, yyyy')}</span>
                )}
                {selectedUserIds.length > 0 && selectedUserIds.length < teamMembers.length && (
                  <span> for {selectedUserIds.length} selected {selectedUserIds.length === 1 ? 'employee' : 'employees'}</span>
                )}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button 
                onClick={handleExportCSV}
                disabled={filteredRecords.length === 0}
                className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-5 h-5" />
                <span>Export to CSV</span>
              </button>
              <button 
                onClick={handleExportPDF}
                disabled={filteredRecords.length === 0}
                className="relative flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <FileText className="w-5 h-5" />
                <span>Export to PDF</span>
                <span className="absolute -top-2 -right-2 bg-gradient-to-r from-red-600 to-pink-600 dark:from-red-500 dark:to-pink-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg border-2 border-white dark:border-gray-800 animate-pulse group-hover:animate-none">
                  NEW
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters Section */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm relative z-30">
        <div className="flex items-center justify-end flex-wrap gap-4">
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

        {/* Date Range and User Filters */}
        <div className="flex items-center justify-between space-x-4 mt-4 flex-wrap">
          <div className="flex items-center space-x-4 flex-wrap">
            {/* User Filter - Multiple select with checkboxes */}
            <div className="relative flex items-center space-x-2" ref={userDropdownRef}>
              <User className="w-4 h-4 text-gray-500" />
            <div className="relative">
              <button
                ref={userDropdownButtonRef}
                type="button"
                onClick={() => {
                  setShowUserDropdown(!showUserDropdown)
                  if (showUserDropdown) {
                    setUserSearchTerm('')
                  }
                }}
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
              
              {/* Dropdown Panel - Rendered via Portal */}
              {typeof window !== 'undefined' && showUserDropdown && createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9997]"
                    onClick={() => {
                      setShowUserDropdown(false)
                      setUserSearchTerm('')
                    }}
                  ></div>
                  <div 
                    ref={userDropdownRef}
                    className="fixed z-[9998] w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                    style={{
                      top: `${userDropdownPosition.top}px`,
                      left: `${userDropdownPosition.left}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
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
                    
                    {/* Select All Option */}
                    {(user.role === 'admin' || user.role === 'manager' || user.role === 'hr' || user.role === 'accountant') && (() => {
                      const filteredMembers = teamMembers.filter(m => 
                        m.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                        m.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                      )
                      const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every(m => selectedUserIds.includes(m.id))
                      const isSelectAllMode = selectedUserIds.length === 0
                      return (
                        <label className="flex items-center space-x-2 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded cursor-pointer border-b border-gray-200 dark:border-gray-700 sticky top-[50px] bg-white dark:bg-gray-800">
                          <input
                            type="checkbox"
                            checked={isSelectAllMode || allFilteredSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                // Select All mode: clear the array to indicate all users selected
                                setSelectedUserIds([])
                              } else {
                                // Deselect All: if in select all mode, select none (empty array stays empty)
                                // If specific users selected, remove filtered members
                                if (isSelectAllMode) {
                                  // Already empty, do nothing (or could set to current user only)
                                  setSelectedUserIds([user.id])
                                } else {
                                  setSelectedUserIds(selectedUserIds.filter(id => !filteredMembers.some(m => m.id === id)))
                                }
                              }
                            }}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Select All</span>
                          <span className="text-xs text-gray-500">({filteredMembers.length} members)</span>
                        </label>
                      )
                    })()}
                    
                    {/* Individual Members */}
                    {teamMembers
                      .filter(member => 
                        member.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                        member.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                      )
                      .map((member) => (
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
                </>,
                document.body
              )}
            </div>
          </div>

          {/* Date Range Picker */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-white dark:text-white" />
            <span className="text-sm text-gray-600 dark:text-gray-400">From:</span>
            <input
              type="date"
              value={startDate || ''}
              onChange={(e) => {
                const newStartDate = e.target.value
                if (newStartDate) {
                  setStartDate(newStartDate)
                  // Ensure start date is not after end date
                  if (endDate && newStartDate > endDate) {
                    setEndDate(newStartDate)
                  }
                } else {
                  // If cleared, set to today's date
                  setStartDate(format(new Date(), 'yyyy-MM-dd'))
                }
              }}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">To:</span>
            <input
              type="date"
              value={endDate || ''}
              onChange={(e) => {
                const newEndDate = e.target.value
                if (newEndDate) {
                  setEndDate(newEndDate)
                  // Ensure end date is not before start date
                  if (startDate && newEndDate < startDate) {
                    setStartDate(newEndDate)
                  }
                } else {
                  // If cleared, set to today's date
                  setEndDate(format(new Date(), 'yyyy-MM-dd'))
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
          {(() => {
            const isHROrAccountant = user.role === 'hr' || user.role === 'accountant'
            const isDefaultState = isHROrAccountant
              ? (selectedUserIds.length === 0 && startDate === format(new Date(), 'yyyy-MM-dd') && endDate === format(new Date(), 'yyyy-MM-dd') && !searchTerm)
              : (selectedUserIds.length === 1 && selectedUserIds[0] === user.id && startDate === format(new Date(), 'yyyy-MM-dd') && endDate === format(new Date(), 'yyyy-MM-dd') && !searchTerm)
            
            return !isDefaultState && (
              <button
                onClick={() => {
                  // Reset to default: HR/Accountant see all users, others see only themselves
                  setSelectedUserIds(isHROrAccountant ? [] : [user.id])
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
            )
          })()}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4">
          <div className="flex items-start space-x-3">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-400 mb-1">Error Loading Attendance</h3>
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  fetchAttendanceRecords()
                }}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 underline"
              >
                Try again
              </button>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
                  <span>Tracker Version</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Project/Task</span>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12">
                    <Loader size="md" text="Loading attendance records" />
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
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
                      if (entry.projects && entry.projects.length > 0) {
                        entry.projects.forEach((proj) => {
                          if (proj.project_id && proj.project_name && proj.project_name !== 'No Project') {
                            if (!allProjects.has(proj.project_id)) {
                              allProjects.set(proj.project_id, { name: proj.project_name, tasks: new Set() })
                            }
                            if (proj.task_name) {
                              allProjects.get(proj.project_id)!.tasks.add(proj.task_name)
                            }
                          }
                        })
                      }
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
                          {(() => {
                            // Check if it's a weekend
                            const dateObj = record.date ? parseISO(record.date) : null
                            const dayOfWeek = dateObj ? format(dateObj, 'EEEE') : ''
                            const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday'
                            const hoursWorked = (record.duration || 0) / 3600
                            
                            // Show Weekend if it's Saturday/Sunday and no time entry (absent with 0 hours)
                            if (isWeekend && record.status === 'absent' && hoursWorked === 0) {
                              return (
                                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-sm font-medium">
                                  <Calendar className="w-4 h-4" />
                                  <span>Weekend</span>
                                </span>
                              )
                            }
                            
                            // Otherwise show the actual status
                            if (record.status === 'present') {
                              return (
                                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
                                  <CheckCircle className="w-4 h-4" />
                                  <span>Present</span>
                                </span>
                              )
                            } else if (record.status === 'half_day') {
                              return (
                                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded-full text-sm font-medium">
                                  <Clock className="w-4 h-4" />
                                  <span>Half Day</span>
                                </span>
                              )
                            } else if (record.status === 'on_leave') {
                              return (
                                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded-full text-sm font-medium">
                                  <Calendar className="w-4 h-4" />
                                  <span>On Leave</span>
                                </span>
                              )
                            } else {
                              return (
                                <span className="inline-flex items-center space-x-1 px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded-full text-sm font-medium">
                                  <XCircle className="w-4 h-4" />
                                  <span>Absent</span>
                                </span>
                              )
                            }
                          })()}
                        </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const hoursWorked = (record.duration || 0) / 3600
                          const isLessThan7_5 = hoursWorked > 0 && hoursWorked < 7.5
                          return (
                            <div className={`text-sm ${isLessThan7_5 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 px-2 py-1 rounded-md font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                              {formatDuration(record.duration)}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {record.app_version ? (
                            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md font-medium">
                              v{record.app_version}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
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
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          // Only show edit button for manager and admin roles
                          if (user.role !== 'manager' && user.role !== 'admin') {
                            return <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                          }
                          
                          const currentDate = format(new Date(), 'yyyy-MM-dd')
                          const recordDate = record.date
                          const isCurrentDate = recordDate === currentDate
                          
                          if (isCurrentDate) {
                            return (
                              <div className="flex items-center space-x-2">
                                <div className="relative group">
                                  <div className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 rounded-lg cursor-not-allowed">
                                    <Edit2 className="w-4 h-4" />
                                    <span>Edit</span>
                                  </div>
                                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 mr-2 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg max-w-xs w-max">
                                    <div className="whitespace-normal break-words">
                                      You cannot update the current date attendance record
                                    </div>
                                    <div className="absolute left-full top-1/2 transform -translate-y-1/2 -ml-1 border-4 border-transparent border-l-gray-900 dark:border-l-gray-800"></div>
                                  </div>
                                </div>
                                <div className="relative group">
                                  <Info className="w-5 h-5 text-gray-400 dark:text-gray-500 cursor-help" />
                                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 mr-2 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg max-w-xs w-max">
                                    <div className="whitespace-normal break-words">
                                      You cannot update the current date attendance record
                                    </div>
                                    <div className="absolute left-full top-1/2 transform -translate-y-1/2 -ml-1 border-4 border-transparent border-l-gray-900 dark:border-l-gray-800"></div>
                                  </div>
                                </div>
                              </div>
                            )
                          }
                          
                          return (
                            <button
                              onClick={() => openEditTimeEntryModal(record)}
                              className="flex items-center space-x-2 px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                              title="Edit attendance record"
                            >
                              <Edit2 className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Time Entry Modal */}
      {showTimeEntryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                {editingRecord ? 'Edit Time Entry' : 'Add New Time Entry'}
              </h2>
              <button
                onClick={() => {
                  setShowTimeEntryModal(false)
                  setEditingRecord(null)
                  setTimeEntryForm({
                    user_id: user.id,
                    date: format(new Date(), 'yyyy-MM-dd'),
                    start_time: '',
                    duration: '',
                    description: '',
                  })
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* User Selection - Only for admins, HR, managers, accountants */}
              {(user.role === 'admin' || user.role === 'hr' || user.role === 'manager' || user.role === 'accountant') && (
                <div>
                  <label htmlFor="user_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Employee *
                  </label>
                  <select
                    id="user_id"
                    value={timeEntryForm.user_id}
                    onChange={(e) => setTimeEntryForm({ ...timeEntryForm, user_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    required
                  >
                    <option value="">Select Employee</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name} ({member.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date */}
              <div>
                <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  id="date"
                  value={timeEntryForm.date}
                  onChange={(e) => setTimeEntryForm({ ...timeEntryForm, date: e.target.value })}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  required
                />
              </div>

              {/* Start Time */}
              <div>
                <label htmlFor="start_time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Time *
                </label>
                <input
                  type="datetime-local"
                  id="start_time"
                  value={timeEntryForm.start_time}
                  onChange={(e) => setTimeEntryForm({ ...timeEntryForm, start_time: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  required
                />
              </div>

              {/* Duration */}
              <div>
                <label htmlFor="duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Duration (Hours) *
                </label>
                <input
                  type="number"
                  id="duration"
                  step="0.01"
                  min="0"
                  value={timeEntryForm.duration}
                  onChange={(e) => setTimeEntryForm({ ...timeEntryForm, duration: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="e.g., 8.5 for 8 hours 30 minutes"
                  required
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Enter duration in hours (e.g., 8.5 = 8 hours 30 minutes). End time will be calculated automatically.
                </p>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  value={timeEntryForm.description}
                  onChange={(e) => setTimeEntryForm({ ...timeEntryForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="Optional description for this time entry"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    setShowTimeEntryModal(false)
                    setEditingRecord(null)
                    setTimeEntryForm({
                      user_id: user.id,
                      date: format(new Date(), 'yyyy-MM-dd'),
                      start_time: '',
                      duration: '',
                      description: '',
                    })
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTimeEntry}
                  className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all font-medium"
                >
                  {editingRecord ? 'Update Time Entry' : 'Create Time Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                Confirm Time Entry {editingRecord ? 'Update' : 'Creation'}
              </h2>
              <button
                onClick={handleCancelConfirmation}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-400 mb-2">
                      Important: Stop Desktop Time Tracker First
                    </h3>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Before proceeding, please make sure you have stopped the desktop time tracker application to avoid any time discrepancies. Manual time entry manipulation while the tracker is running may cause data conflicts.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-2">
                  Time Entry Details:
                </p>
                <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• Date: {timeEntryForm.date ? format(parseISO(timeEntryForm.date), 'MMM d, yyyy') : '—'}</li>
                  <li>• Start Time: {timeEntryForm.start_time ? format(new Date(timeEntryForm.start_time), 'MMM d, yyyy hh:mm a') : '—'}</li>
                  <li>• Duration: {timeEntryForm.duration ? `${timeEntryForm.duration} hours` : '—'}</li>
                </ul>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleCancelConfirmation}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSaveTimeEntry}
                  className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all font-medium"
                >
                  Confirm & {editingRecord ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
