import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { Search, Filter, Calendar, Image, Video, Download, Eye, User, ZoomIn, ZoomOut, MousePointer, Keyboard, TrendingUp, FolderKanban, Info, AlertTriangle, BarChart3, Globe, Monitor, Activity, X } from 'lucide-react'
import { format, startOfDay, endOfDay, parseISO, getHours } from 'date-fns'
import Loader from '../components/Loader'
import Tooltip from '../components/Tooltip'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type Screenshot = Tables<'screenshots'>
type TimeEntry = Tables<'time_entries'>

interface ScreenshotsProps {
  user: Profile
}

interface ScreenshotWithDetails extends Screenshot {
  time_entry?: TimeEntry & {
    profile?: Profile
    project_time_entries?: Array<{
      project_id: string
      projects?: {
        id: string
        name: string
        tasks?: {
          name: string
        }
      }
    }>
  }
  activity_logs?: Array<{
    id: string
    keystrokes: number
    mouse_movements: number
    productivity_score: number
    urls: string[] | null
    created_at: string | null
  }>
  screenshot_activity?: Array<{
    id: string
    screenshot_id: string
    user_id: string
    project_id: string | null
    time_entry_id: string
    interval_start_time: string
    interval_end_time: string
    interval_duration_seconds: number
    mouse_usage_percentage: number
    keyboard_usage_percentage: number
    mouse_activity_details: {
      total_clicks: number
      scroll_events: any[]
      active_time_ms: number
      click_coordinates: Array<{ x: number; y: number; timestamp: string }>
      screen_resolution: { width: number; height: number }
      movement_duration_ms: number
    }
    keyboard_activity_details: {
      key_presses: any[]
      key_frequency: Record<string, number>
      active_time_ms: number
      total_keystrokes: number
    }
    suspicious_activity_flags: string[]
    visited_websites: Array<{
      url: string
      domain: string
      start_time: string
      duration_seconds: number
    }>
    active_applications: any[]
    device_os: string
    app_version: string
    created_at: string
    updated_at: string
  }>
  imageUrl?: string
}

interface HourlyGroup {
  hour: number
  hourLabel: string
  screenshots: ScreenshotWithDetails[]
}

export default function Screenshots({ user }: ScreenshotsProps) {
  const [screenshots, setScreenshots] = useState<ScreenshotWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'screenshot' | 'camera'>('all')
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [selectedUserId, setSelectedUserId] = useState<string>(user.id)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotWithDetails | null>(null)
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [imageUrls, setImageUrls] = useState<{ [key: string]: string }>({})
  const [zoomLevel, setZoomLevel] = useState(1)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userDropdownRef = useRef<HTMLDivElement>(null)
  const userDropdownButtonRef = useRef<HTMLButtonElement>(null)
  const [userDropdownPosition, setUserDropdownPosition] = useState({ top: 0, left: 0 })
  const [showUsageDetails, setShowUsageDetails] = useState(false)
  const [selectedScreenshotForDetails, setSelectedScreenshotForDetails] = useState<ScreenshotWithDetails | null>(null)

  useEffect(() => {
    fetchTeamMembers()
  }, [user.id])

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

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(event.target as Node) &&
        userDropdownButtonRef.current &&
        !userDropdownButtonRef.current.contains(event.target as Node)
      ) {
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
    fetchScreenshots()
    
    // Set up real-time subscription for screenshots
    const channel = supabase
      .channel(`screenshots-realtime-${selectedDate}-${selectedUserId}-${typeFilter}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'screenshots',
        },
        (payload) => {
          console.log('Screenshot change detected:', payload.eventType)
          // Refetch screenshots when changes occur
          fetchScreenshots()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to screenshots real-time updates')
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedUserId, typeFilter, selectedDate])

  useEffect(() => {
    // Reset zoom when screenshot changes
    setZoomLevel(1)
    setImagePosition({ x: 0, y: 0 })
  }, [selectedScreenshot])

  const fetchTeamMembers = async () => {
    try {
      if (user.role === 'admin') {
        // Admin can see all users
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
        // Employee can only see themselves
        setTeamMembers([user])
      }
    } catch (error) {
      console.error('Error fetching team members:', error)
    }
  }

  const getImageUrl = (storagePath: string, screenshotId: string, screenshotType?: string): string => {
    // Check if we already have the URL cached
    if (imageUrls[screenshotId]) {
      return imageUrls[screenshotId]
    }

    // Get Supabase URL
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yxkniwzsinqyjdqqzyjs.supabase.co'
    
    // All images are stored in the "screenshots" bucket
    // Camera shots are in the "camera/" folder, regular screenshots are in the root
    const bucketName = 'screenshots'
    
    // Determine the correct path
    // If it's a camera shot and path doesn't start with "camera/", prepend it
    const isCamera = screenshotType === 'camera' || screenshotType === 'webcam'
    let finalPath = storagePath
    if (isCamera && !storagePath.startsWith('camera/')) {
      finalPath = `camera/${storagePath}`
    } else if (!isCamera && storagePath.startsWith('camera/')) {
      // If it's not a camera shot but path has camera prefix, remove it (shouldn't happen, but handle it)
      finalPath = storagePath.replace(/^camera\//, '')
    }
    
    // Try to get public URL using Supabase storage client
    try {
      const { data } = supabase.storage.from(bucketName).getPublicUrl(finalPath)
      if (data?.publicUrl) {
        const url = data.publicUrl
        setImageUrls(prev => ({ ...prev, [screenshotId]: url }))
        return url
      }
    } catch (e) {
      // Continue to fallback
    }

    // Fallback: construct URL manually
    const fallbackUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${finalPath}`
    setImageUrls(prev => ({ ...prev, [screenshotId]: fallbackUrl }))
    return fallbackUrl
  }

  const fetchScreenshots = async () => {
    try {
      setLoading(true)
      
      // Parse selected date
      const date = parseISO(selectedDate)
      const startDate = startOfDay(date)
      const endDate = endOfDay(date)

      let query = supabase
        .from('screenshots')
        .select(`
          *,
          time_entry:time_entries!screenshots_time_entry_id_fkey(
            *,
            profile:profiles!time_entries_user_id_fkey(*),
            project_time_entries(
              project_id,
              projects(
                id,
                name,
                tasks(name)
              )
            )
          )
        `)
        .order('taken_at', { ascending: false })

      // Apply date filter - filter by the selected date
      query = query.gte('taken_at', startDate.toISOString())
      query = query.lte('taken_at', endDate.toISOString())

      // Apply type filter
      if (typeFilter !== 'all') {
        if (typeFilter === 'camera') {
          // Handle camera types: 'camera', 'webcam'
          query = query.in('type', ['camera', 'webcam'])
        } else if (typeFilter === 'screenshot') {
          // Handle screenshot types: 'screen', 'screenshot', 'desktop'
          query = query.in('type', ['screen', 'screenshot', 'desktop'])
        } else {
          query = query.eq('type', typeFilter)
        }
      }

      // Apply user filter - filter by selected user
      if (selectedUserId) {
        // Get time entries for the selected user
        const { data: userEntries } = await supabase
          .from('time_entries')
          .select('id')
          .eq('user_id', selectedUserId)

        const entryIds = userEntries?.map((e) => e.id) || []
        if (entryIds.length > 0) {
          query = query.in('time_entry_id', entryIds)
        } else {
          // No entries for this user, return empty result
          query = query.eq('time_entry_id', '00000000-0000-0000-0000-000000000000')
        }
      }

      const { data, error } = await query.limit(500)

      if (error) throw error
      
      // Fetch screenshot_activity data for all screenshots
      const screenshotIds = (data || []).map(s => s.id)
      let screenshotActivityMap = new Map<string, any[]>()
      
      if (screenshotIds.length > 0) {
        // Try screenshot_activity table first
        const { data: screenshotActivityData, error: screenshotActivityError } = await supabase
          .from('screenshot_activity')
          .select('*')
          .in('screenshot_id', screenshotIds)
          .order('created_at', { ascending: true })
        
        if (!screenshotActivityError && screenshotActivityData) {
          // Group by screenshot_id
          screenshotActivityData.forEach((activity: any) => {
            const screenshotId = activity.screenshot_id
            if (!screenshotActivityMap.has(screenshotId)) {
              screenshotActivityMap.set(screenshotId, [])
            }
            screenshotActivityMap.get(screenshotId)!.push(activity)
          })
          console.log('Fetched screenshot_activity data:', screenshotActivityData.length, 'records')
        } else {
          // Fallback to activity_logs table
          console.log('screenshot_activity table not found or error, trying activity_logs')
          const { data: activityLogsData, error: activityLogsError } = await supabase
            .from('activity_logs')
            .select('*')
            .in('screenshot_id', screenshotIds)
            .order('created_at', { ascending: true })
          
          if (!activityLogsError && activityLogsData) {
            activityLogsData.forEach((activity: any) => {
              const screenshotId = activity.screenshot_id
              if (!screenshotActivityMap.has(screenshotId)) {
                screenshotActivityMap.set(screenshotId, [])
              }
              screenshotActivityMap.get(screenshotId)!.push(activity)
            })
            console.log('Fetched activity_logs data:', activityLogsData.length, 'records')
          }
        }
      }
      
      // Pre-fetch image URLs for all screenshots
      // Try to get signed URLs if public URLs don't work
      const screenshotsWithUrls = await Promise.all(
        (data || []).map(async (screenshot) => {
          // Add screenshot_activity data to screenshot
          const activityData = screenshotActivityMap.get(screenshot.id) || []
          const screenshotWithActivity = {
            ...screenshot,
            screenshot_activity: activityData,
            activity_logs: activityData, // Also set activity_logs for backward compatibility
          }
          // Determine correct path: camera shots go in camera/ folder
          const isCamera = screenshot.type === 'camera' || screenshot.type === 'webcam'
          let finalPath = screenshot.storage_path
          if (isCamera && !finalPath.startsWith('camera/')) {
            finalPath = `camera/${finalPath}`
          } else if (!isCamera && finalPath.startsWith('camera/')) {
            // Remove camera prefix if it's not a camera shot
            finalPath = finalPath.replace(/^camera\//, '')
          }
          
          let url = getImageUrl(finalPath, screenshot.id, screenshot.type)
          
          // Try to get a signed URL if the bucket is private
          // All images are in the "screenshots" bucket
          try {
            const bucketName = 'screenshots'
            const { data: signedData, error: signedError } = await supabase.storage
              .from(bucketName)
              .createSignedUrl(finalPath, 3600) // 1 hour expiry
            
            if (signedData?.signedUrl && !signedError) {
              url = signedData.signedUrl
              setImageUrls(prev => ({ ...prev, [screenshot.id]: url }))
            }
          } catch (e) {
            // Use the public URL we already have
          }

          return { ...screenshotWithActivity, imageUrl: url }
        })
      )
      
      setScreenshots(screenshotsWithUrls as any)
    } catch (error) {
      console.error('Error fetching screenshots:', error)
    } finally {
      setLoading(false)
    }
  }

  // Group screenshots by hour
  const groupScreenshotsByHour = (screenshots: ScreenshotWithDetails[]): HourlyGroup[] => {
    const filtered = screenshots.filter((screenshot) => {
      const matchesSearch =
        screenshot.time_entry?.profile?.full_name
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        screenshot.time_entry?.description?.toLowerCase().includes(searchTerm.toLowerCase())
      return matchesSearch
    })

    const grouped: { [key: number]: ScreenshotWithDetails[] } = {}

    filtered.forEach((screenshot) => {
      if (screenshot.taken_at) {
        const hour = getHours(new Date(screenshot.taken_at))
        if (!grouped[hour]) {
          grouped[hour] = []
        }
        grouped[hour].push(screenshot)
      }
    })

    // Convert to array and sort by hour (descending - most recent first)
    return Object.keys(grouped)
      .map((hour) => {
        const hourNum = parseInt(hour)
        const hourLabel = `${hourNum.toString().padStart(2, '0')}:00 - ${(hourNum + 1).toString().padStart(2, '0')}:00`
        return {
          hour: hourNum,
          hourLabel,
          screenshots: grouped[hourNum].sort((a, b) => {
            if (!a.taken_at || !b.taken_at) return 0
            return new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime()
          }),
        }
      })
      .sort((a, b) => b.hour - a.hour) // Sort by hour descending
  }

  const hourlyGroups = groupScreenshotsByHour(screenshots)

  // Handle zoom with mouse wheel
  const handleWheel = (e: React.WheelEvent) => {
    if (!selectedScreenshot) return
    
    e.preventDefault()
    const delta = e.deltaY * -0.001
    const newZoom = Math.min(Math.max(0.5, zoomLevel + delta), 5)
    setZoomLevel(newZoom)
  }

  // Handle image drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return
    setIsDragging(true)
    setDragStart({
      x: e.clientX - imagePosition.x,
      y: e.clientY - imagePosition.y,
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoomLevel <= 1) return
    
    setImagePosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Reset zoom
  const resetZoom = () => {
    setZoomLevel(1)
    setImagePosition({ x: 0, y: 0 })
  }

  // Zoom in/out buttons
  const zoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 5))
  }

  const zoomOut = () => {
    setZoomLevel((prev) => {
      const newZoom = Math.max(prev - 0.25, 0.5)
      if (newZoom <= 1) {
        setImagePosition({ x: 0, y: 0 })
      }
      return newZoom
    })
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 flex-wrap">
          {/* User Filter - Custom dropdown with search */}
          <div className="flex items-center space-x-2 relative" ref={userDropdownRef}>
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
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] text-left bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors"
              >
                <span className="text-sm">
                  {teamMembers.find(m => m.id === selectedUserId)?.full_name || 'Select User'}
                  {selectedUserId === user.id && ' (Me)'}
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
                    
                    {/* User List */}
                    <div className="p-1">
                      {teamMembers
                        .filter(member => 
                          member.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                          member.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                        )
                        .map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => {
                              setSelectedUserId(member.id)
                              setShowUserDropdown(false)
                              setUserSearchTerm('')
                            }}
                            className={`w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                              selectedUserId === member.id 
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {member.full_name} {member.id === user.id ? '(Me)' : ''}
                          </button>
                        ))}
                      {teamMembers.filter(member => 
                        member.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                        member.email?.toLowerCase().includes(userSearchTerm.toLowerCase())
                      ).length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                          No users found
                        </div>
                      )}
                    </div>
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>

          {/* Type Filter */}
          <div className="flex items-center space-x-2">
            <Image className="w-4 h-4 text-gray-500" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="all">All Types</option>
              <option value="screenshot">Screenshots</option>
              <option value="camera">Camera Shots</option>
            </select>
          </div>

          {/* Date Picker */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-white dark:text-white" />
            <input
              type="date"
              value={selectedDate || format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(e.target.value)
                } else {
                  setSelectedDate(format(new Date(), 'yyyy-MM-dd'))
                }
              }}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      {/* Screenshots Grid - Grouped by Hour */}
      {loading ? (
        <div className="py-12">
          <Loader size="lg" text="Loading screenshots" />
        </div>
      ) : hourlyGroups.length === 0 ? (
        <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center backdrop-blur-sm">
          <Image className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No screenshots found for {format(parseISO(selectedDate), 'MMMM d, yyyy')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {hourlyGroups.map((group) => (
            <div key={group.hour} className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden backdrop-blur-sm">
              {/* Hour Header */}
              <div className="bg-gray-50 dark:bg-gray-700/50 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                  {group.hourLabel}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')} • {group.screenshots.length} {group.screenshots.length === 1 ? 'item' : 'items'}
                </p>
              </div>

              {/* Screenshots Grid for this hour */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.screenshots.map((screenshot) => {
                    // Determine correct path for camera shots
                    const isCamera = screenshot.type === 'camera' || screenshot.type === 'webcam'
                    let finalPath = screenshot.storage_path
                    if (isCamera && !finalPath.startsWith('camera/')) {
                      finalPath = `camera/${finalPath}`
                    } else if (!isCamera && finalPath.startsWith('camera/')) {
                      finalPath = finalPath.replace(/^camera\//, '')
                    }
                    const imageUrl = screenshot.imageUrl || imageUrls[screenshot.id] || getImageUrl(finalPath, screenshot.id, screenshot.type)
                    
                    return (
                      <div
                        key={screenshot.id}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => setSelectedScreenshot(screenshot)}
                      >
                        <div className="aspect-video bg-gray-100 dark:bg-gray-700 relative overflow-hidden">
                          <img
                            src={imageUrl}
                            alt={isCamera ? 'Camera shot' : 'Screenshot'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={async (e) => {
                              console.error('Failed to load image:', imageUrl, 'Path:', screenshot.storage_path)
                              
                              // Try to get a signed URL as fallback
                              // All images are in the "screenshots" bucket
                              // Camera shots are in camera/ folder
                              try {
                                const isCamera = screenshot.type === 'camera' || screenshot.type === 'webcam'
                                let finalPath = screenshot.storage_path
                                if (isCamera && !finalPath.startsWith('camera/')) {
                                  finalPath = `camera/${finalPath}`
                                } else if (!isCamera && finalPath.startsWith('camera/')) {
                                  finalPath = finalPath.replace(/^camera\//, '')
                                }
                                
                                const { data: signedData, error: signedError } = await supabase.storage
                                  .from('screenshots')
                                  .createSignedUrl(finalPath, 3600)
                                
                                if (signedData?.signedUrl && !signedError) {
                                  e.currentTarget.src = signedData.signedUrl
                                  setImageUrls(prev => ({ ...prev, [screenshot.id]: signedData.signedUrl }))
                                  return
                                }
                              } catch (err) {
                                console.error('Failed to get signed URL:', err)
                              }
                              
                              // If still failed, hide image and show fallback
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget.parentElement?.querySelector('.image-fallback') as HTMLElement
                              if (fallback) fallback.classList.remove('hidden')
                            }}
                          />
                          <div className="hidden image-fallback absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700">
                            {isCamera ? (
                              <>
                                <Video className="w-12 h-12 text-gray-400 dark:text-gray-300 mb-2" />
                                <p className="text-xs text-gray-500 dark:text-gray-300">Camera shot</p>
                              </>
                            ) : (
                              <>
                                <Image className="w-12 h-12 text-gray-400 dark:text-gray-300 mb-2" />
                                <p className="text-xs text-gray-500 dark:text-gray-300">Screenshot</p>
                              </>
                            )}
                            <p className="text-xs text-gray-400 dark:text-gray-300 mt-1 px-2 text-center truncate w-full">
                              {screenshot.storage_path.split('/').pop()}
                            </p>
                          </div>
                          <div className="absolute top-2 right-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium shadow-md backdrop-blur-sm ${
                                isCamera
                                  ? 'bg-purple-100 dark:bg-purple-900/90 text-purple-800 dark:text-purple-100 border border-purple-200 dark:border-purple-700'
                                  : 'bg-blue-100 dark:bg-blue-900/90 text-blue-800 dark:text-blue-100 border border-blue-200 dark:border-blue-700'
                              }`}
                            >
                              {isCamera ? (
                                <Video className="w-3 h-3 inline mr-1" />
                              ) : (
                                <Image className="w-3 h-3 inline mr-1" />
                              )}
                              {screenshot.type === 'webcam' ? 'Camera' : screenshot.type === 'screen' ? 'Screenshot' : screenshot.type}
                            </span>
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                              {screenshot.time_entry?.profile?.full_name?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                                {screenshot.time_entry?.profile?.full_name || 'Unknown User'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {screenshot.taken_at
                                  ? format(new Date(screenshot.taken_at), 'h:mm:ss a')
                                  : '—'}
                              </p>
                            </div>
                          </div>
                          {/* Date Display */}
                          <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">
                            {screenshot.taken_at
                              ? format(new Date(screenshot.taken_at), 'MMM d, yyyy')
                              : '—'}
                          </p>
                          
                          {/* Project & Task Information */}
                          {screenshot.time_entry?.project_time_entries && screenshot.time_entry.project_time_entries.length > 0 && (
                            <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                              <div className="flex items-start space-x-2">
                                <FolderKanban className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">Project & Task</div>
                                  <div className="space-y-0.5">
                                    {screenshot.time_entry.project_time_entries.slice(0, 2).map((pte: any, idx: number) => (
                                      <div key={idx} className="text-xs">
                                        <span className="font-medium text-gray-900 dark:text-gray-100">
                                          {pte.projects?.name || 'No Project'}
                                        </span>
                                        {pte.projects?.tasks?.name && (
                                          <span className="text-gray-600 dark:text-gray-400">
                                            {' • '}{pte.projects.tasks.name}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                    {screenshot.time_entry.project_time_entries.length > 2 && (
                                      <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                        +{screenshot.time_entry.project_time_entries.length - 2} more
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Activity Logs */}
                          {((screenshot.activity_logs && screenshot.activity_logs.length > 0) || (screenshot.screenshot_activity && screenshot.screenshot_activity.length > 0)) && (
                            <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                              <div className="text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Activity</div>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(() => {
                                  const screenshotActivities = screenshot.screenshot_activity || []
                                  const activityLogs = screenshot.activity_logs || []
                                  
                                  let totalKeystrokes = 0
                                  let totalMouseClicks = 0
                                  let avgProductivity = 0
                                  
                                  if (screenshotActivities.length > 0) {
                                    // New schema
                                    totalKeystrokes = screenshotActivities.reduce((sum, activity) => 
                                      sum + (activity.keyboard_activity_details?.total_keystrokes || 0), 0
                                    )
                                    totalMouseClicks = screenshotActivities.reduce((sum, activity) => 
                                      sum + (activity.mouse_activity_details?.total_clicks || 0), 0
                                    )
                                    // Calculate average from percentages
                                    const totalMousePct = screenshotActivities.reduce((sum, a) => sum + (a.mouse_usage_percentage || 0), 0)
                                    const totalKeyboardPct = screenshotActivities.reduce((sum, a) => sum + (a.keyboard_usage_percentage || 0), 0)
                                    avgProductivity = screenshotActivities.length > 0 ? (totalMousePct + totalKeyboardPct) / screenshotActivities.length : 0
                                  } else if (activityLogs.length > 0) {
                                    // Old schema fallback
                                    totalKeystrokes = activityLogs.reduce((sum, log) => sum + (log.keystrokes || 0), 0)
                                    totalMouseClicks = activityLogs.reduce((sum, log) => sum + (log.mouse_movements || 0), 0)
                                    avgProductivity = activityLogs.length > 0 ? activityLogs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / activityLogs.length : 0
                                  }
                                  
                                  return (
                                    <>
                                      {totalKeystrokes > 0 && (
                                        <div className="flex flex-col items-center p-1.5 bg-gray-100 dark:bg-gray-700/50 rounded">
                                          <Keyboard className="w-3 h-3 text-gray-600 dark:text-gray-400 mb-0.5" />
                                          <span className="text-[10px] font-semibold text-gray-900 dark:text-gray-100">
                                            {totalKeystrokes > 999 ? `${(totalKeystrokes / 1000).toFixed(1)}k` : totalKeystrokes}
                                          </span>
                                          <span className="text-[9px] text-gray-500 dark:text-gray-400">keys</span>
                                        </div>
                                      )}
                                      {totalMouseClicks > 0 && (
                                        <div className="flex flex-col items-center p-1.5 bg-gray-100 dark:bg-gray-700/50 rounded">
                                          <MousePointer className="w-3 h-3 text-gray-600 dark:text-gray-400 mb-0.5" />
                                          <span className="text-[10px] font-semibold text-gray-900 dark:text-gray-100">
                                            {totalMouseClicks > 999 ? `${(totalMouseClicks / 1000).toFixed(1)}k` : totalMouseClicks}
                                          </span>
                                          <span className="text-[9px] text-gray-500 dark:text-gray-400">clicks</span>
                                        </div>
                                      )}
                                      {avgProductivity > 0 && (
                                        <div className="flex flex-col items-center p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded">
                                          <TrendingUp className="w-3 h-3 text-blue-600 dark:text-blue-400 mb-0.5" />
                                          <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                            {avgProductivity.toFixed(0)}%
                                          </span>
                                          <span className="text-[9px] text-blue-600 dark:text-blue-400">score</span>
                                        </div>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          )}
                          
                          {/* Usage Percentages & Details - Admin Only (Always visible for admins) */}
                          {user.role === 'admin' && (() => {
                            // Use screenshot_activity data (new schema) or fallback to activity_logs (old schema)
                            const screenshotActivities = screenshot.screenshot_activity || []
                            const activityLogs = screenshot.activity_logs || []
                            
                            // Calculate from new schema (screenshot_activity)
                            let mousePercentage = 0
                            let keyboardPercentage = 0
                            let totalMouseActivity = 0
                            let totalKeyboardActivity = 0
                            
                            if (screenshotActivities.length > 0) {
                              // New schema - use pre-calculated percentages
                              const totalMouse = screenshotActivities.reduce((sum, activity) => sum + (activity.mouse_usage_percentage || 0), 0)
                              const totalKeyboard = screenshotActivities.reduce((sum, activity) => sum + (activity.keyboard_usage_percentage || 0), 0)
                              const count = screenshotActivities.length
                              mousePercentage = count > 0 ? totalMouse / count : 0
                              keyboardPercentage = count > 0 ? totalKeyboard / count : 0
                              
                              // Calculate totals for display
                              totalMouseActivity = screenshotActivities.reduce((sum, activity) => 
                                sum + (activity.mouse_activity_details?.total_clicks || 0) + 
                                (activity.mouse_activity_details?.active_time_ms || 0) / 1000, 0
                              )
                              totalKeyboardActivity = screenshotActivities.reduce((sum, activity) => 
                                sum + (activity.keyboard_activity_details?.total_keystrokes || 0), 0
                              )
                            } else if (activityLogs.length > 0) {
                              // Old schema fallback
                              const totalKeystrokes = activityLogs.reduce((sum, log) => {
                                const val = typeof log?.keystrokes === 'number' ? log.keystrokes : 0
                                return sum + val
                              }, 0)
                              const totalMouseMovements = activityLogs.reduce((sum, log) => {
                                const val = typeof log?.mouse_movements === 'number' ? log.mouse_movements : 0
                                return sum + val
                              }, 0)
                              const totalActivity = totalKeystrokes + totalMouseMovements
                              mousePercentage = totalActivity > 0 ? (totalMouseMovements / totalActivity) * 100 : 0
                              keyboardPercentage = totalActivity > 0 ? (totalKeystrokes / totalActivity) * 100 : 0
                              totalMouseActivity = totalMouseMovements
                              totalKeyboardActivity = totalKeystrokes
                            }
                            
                            console.log('Screenshot ID:', screenshot.id, 'Activities:', screenshotActivities.length, 'Logs:', activityLogs.length)
                            console.log('Percentages:', { mousePercentage, keyboardPercentage })
                            
                            const hasData = screenshotActivities.length > 0 || activityLogs.length > 0
                            
                            return (
                              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                                <div className="flex items-center justify-between text-xs mb-2">
                                  <span className="text-gray-600 dark:text-gray-400 font-medium">Usage (Admin)</span>
                                </div>
                                {hasData ? (
                                  <>
                                    {/* Mouse Usage Progress Bar */}
                                    <div className="mb-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center space-x-1">
                                          <MousePointer className="w-3 h-3 text-blue-500" />
                                          <span className="text-[10px] text-gray-600 dark:text-gray-400">Mouse</span>
                                        </div>
                                        <Tooltip
                                          content={screenshotActivities.length > 0 
                                            ? `Mouse: ${screenshotActivities.reduce((sum, a) => sum + (a.mouse_activity_details?.total_clicks || 0), 0)} clicks, ${(screenshotActivities.reduce((sum, a) => sum + (a.mouse_activity_details?.active_time_ms || 0), 0) / 1000).toFixed(1)}s active (${mousePercentage.toFixed(1)}%)`
                                            : `Mouse: ${totalMouseActivity.toLocaleString()} activity (${mousePercentage.toFixed(1)}%)`}
                                          position="top"
                                        >
                                          <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 cursor-help">
                                            {mousePercentage.toFixed(1)}%
                                          </span>
                                        </Tooltip>
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                        <div
                                          className={`h-full transition-all duration-300 ${
                                            mousePercentage >= 70 ? 'bg-green-500' :
                                            mousePercentage >= 40 ? 'bg-blue-500' :
                                            mousePercentage >= 20 ? 'bg-yellow-500' :
                                            'bg-gray-400'
                                          }`}
                                          style={{ width: `${Math.max(mousePercentage, 2)}%` }}
                                        />
                                      </div>
                                    </div>

                                    {/* Keyboard Usage Progress Bar */}
                                    <div className="mb-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center space-x-1">
                                          <Keyboard className="w-3 h-3 text-purple-500" />
                                          <span className="text-[10px] text-gray-600 dark:text-gray-400">Keyboard</span>
                                        </div>
                                        <Tooltip
                                          content={screenshotActivities.length > 0
                                            ? `Keyboard: ${screenshotActivities.reduce((sum, a) => sum + (a.keyboard_activity_details?.total_keystrokes || 0), 0)} keystrokes, ${(screenshotActivities.reduce((sum, a) => sum + (a.keyboard_activity_details?.active_time_ms || 0), 0) / 1000).toFixed(1)}s active (${keyboardPercentage.toFixed(1)}%)`
                                            : `Keyboard: ${totalKeyboardActivity.toLocaleString()} keystrokes (${keyboardPercentage.toFixed(1)}%)`}
                                          position="top"
                                        >
                                          <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 cursor-help">
                                            {keyboardPercentage.toFixed(1)}%
                                          </span>
                                        </Tooltip>
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                        <div
                                          className={`h-full transition-all duration-300 ${
                                            keyboardPercentage >= 70 ? 'bg-green-500' :
                                            keyboardPercentage >= 40 ? 'bg-purple-500' :
                                            keyboardPercentage >= 20 ? 'bg-orange-500' :
                                            'bg-gray-400'
                                          }`}
                                          style={{ width: `${Math.max(keyboardPercentage, 2)}%` }}
                                        />
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        console.log('Usage Details button clicked for screenshot:', screenshot.id)
                                        setSelectedScreenshotForDetails(screenshot)
                                        setShowUsageDetails(true)
                                      }}
                                      className="mt-2 w-full px-2 py-1.5 text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center justify-center space-x-1"
                                    >
                                      <Info className="w-3 h-3" />
                                      <span>Usage Details</span>
                                    </button>
                                  </>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center">No activity data</p>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedScreenshot(screenshot)
                                      }}
                                      className="w-full px-2 py-1.5 text-[10px] font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors flex items-center justify-center space-x-1"
                                    >
                                      <Info className="w-3 h-3" />
                                      <span>View Screenshot</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for viewing screenshot with zoom */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            // Only close if clicking the backdrop, not the modal content
            if (e.target === e.currentTarget && !isDragging) {
              setSelectedScreenshot(null)
              resetZoom()
            }
          }}
        >
          <div 
            className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-200 dark:border-gray-700 backdrop-blur-lg" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                  {selectedScreenshot.time_entry?.profile?.full_name?.charAt(0).toUpperCase() ||
                    'U'}
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white">
                    {selectedScreenshot.time_entry?.profile?.full_name || 'Unknown User'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {selectedScreenshot.taken_at
                      ? format(new Date(selectedScreenshot.taken_at), 'MMM d, yyyy • h:mm:ss a')
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {/* Zoom Controls */}
                <div className="flex items-center space-x-2 mr-4 border-r border-gray-300 pr-4">
                  <button
                    onClick={zoomOut}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[60px] text-center">
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={zoomIn}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </button>
                  {zoomLevel !== 1 && (
                    <button
                      onClick={resetZoom}
                      className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedScreenshot(null)
                    resetZoom()
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-2xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Image Container with Zoom */}
            <div
              ref={containerRef}
              className="flex-1 overflow-auto relative bg-gray-900"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ 
                cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default', 
                minHeight: '400px', 
                maxHeight: 'calc(90vh - 200px)' 
              }}
            >
              <div className="flex items-center justify-center w-full h-full min-h-[400px] p-4">
                <img
                  ref={imageRef}
                  src={(() => {
                    const isCamera = selectedScreenshot.type === 'camera' || selectedScreenshot.type === 'webcam'
                    let finalPath = selectedScreenshot.storage_path
                    if (isCamera && !finalPath.startsWith('camera/')) {
                      finalPath = `camera/${finalPath}`
                    } else if (!isCamera && finalPath.startsWith('camera/')) {
                      finalPath = finalPath.replace(/^camera\//, '')
                    }
                    return selectedScreenshot.imageUrl || imageUrls[selectedScreenshot.id] || getImageUrl(finalPath, selectedScreenshot.id, selectedScreenshot.type)
                  })()}
                  alt={(selectedScreenshot.type === 'camera' || selectedScreenshot.type === 'webcam') ? 'Camera shot' : 'Screenshot'}
                  className="transition-transform duration-200 ease-out select-none"
                  style={{
                    transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${zoomLevel})`,
                    transformOrigin: 'center center',
                    maxWidth: zoomLevel <= 1 ? '100%' : 'none',
                    maxHeight: zoomLevel <= 1 ? '100%' : 'none',
                    objectFit: 'contain',
                  }}
                  draggable={false}
                  onError={(e) => {
                    console.error('Failed to load image in modal:', e.currentTarget.src)
                    e.currentTarget.style.display = 'none'
                    const fallback = e.currentTarget.parentElement?.nextElementSibling as HTMLElement
                    if (fallback) fallback.classList.remove('hidden')
                  }}
                />
              </div>
              <div className="hidden absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white z-10">
                {(selectedScreenshot.type === 'camera' || selectedScreenshot.type === 'webcam') ? (
                  <>
                    <Video className="w-24 h-24 mx-auto mb-4 text-gray-400 dark:text-gray-300" />
                    <p className="text-gray-400 dark:text-gray-300">Camera shot preview unavailable</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Storage Path: {selectedScreenshot.storage_path}</p>
                  </>
                ) : (
                  <>
                    <Image className="w-24 h-24 mx-auto mb-4 text-gray-400 dark:text-gray-300" />
                    <p className="text-gray-400 dark:text-gray-300">Screenshot preview unavailable</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Storage Path: {selectedScreenshot.storage_path}</p>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 space-y-4">
              {/* Project & Task Information */}
              {selectedScreenshot.time_entry?.project_time_entries && selectedScreenshot.time_entry.project_time_entries.length > 0 && (
                <div>
                  <div className="flex items-center space-x-2 mb-2">
                    <FolderKanban className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Project & Task</h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedScreenshot.time_entry.project_time_entries.map((pte: any, idx: number) => (
                      <div key={idx} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {pte.projects?.name || 'No Project'}
                        </div>
                        {pte.projects?.tasks?.name && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            Task: {pte.projects.tasks.name}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Activity Logs */}
              {((selectedScreenshot.activity_logs && selectedScreenshot.activity_logs.length > 0) || (selectedScreenshot.screenshot_activity && selectedScreenshot.screenshot_activity.length > 0)) && (
                <div>
                  <div className="flex items-center space-x-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Activity Metrics</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(() => {
                      const logs = selectedScreenshot.activity_logs || selectedScreenshot.screenshot_activity || []
                      const totalKeystrokes = logs.reduce((sum, log) => sum + (log.keystrokes || 0), 0)
                      const totalMouseMovements = logs.reduce((sum, log) => sum + (log.mouse_movements || 0), 0)
                      const avgProductivity = logs.length > 0 ? logs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / logs.length : 0
                      
                      return (
                        <>
                          {totalKeystrokes > 0 && (
                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600 text-center">
                              <Keyboard className="w-5 h-5 text-gray-600 dark:text-gray-400 mx-auto mb-2" />
                              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                {totalKeystrokes.toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Keystrokes</div>
                            </div>
                          )}
                          {totalMouseMovements > 0 && (
                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600 text-center">
                              <MousePointer className="w-5 h-5 text-gray-600 dark:text-gray-400 mx-auto mb-2" />
                              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                {totalMouseMovements.toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">Mouse Moves</div>
                            </div>
                          )}
                          {avgProductivity > 0 && (
                            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800 text-center">
                              <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto mb-2" />
                              <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                                {avgProductivity.toFixed(1)}%
                              </div>
                              <div className="text-xs text-blue-600 dark:text-blue-400">Productivity</div>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}
              
              <div className="flex items-center space-x-3">
                <a
                  href={(() => {
                    const isCamera = selectedScreenshot.type === 'camera' || selectedScreenshot.type === 'webcam'
                    let finalPath = selectedScreenshot.storage_path
                    if (isCamera && !finalPath.startsWith('camera/')) {
                      finalPath = `camera/${finalPath}`
                    } else if (!isCamera && finalPath.startsWith('camera/')) {
                      finalPath = finalPath.replace(/^camera\//, '')
                    }
                    return selectedScreenshot.imageUrl || imageUrls[selectedScreenshot.id] || getImageUrl(finalPath, selectedScreenshot.id, selectedScreenshot.type)
                  })()}
                  download
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => {
                    setSelectedScreenshot(null)
                    resetZoom()
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:bg-gray-700/50 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                💡 Scroll to zoom • {zoomLevel > 1 ? 'Click and drag to pan' : 'Zoom in to pan'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Usage Details Modal - Admin Only */}
      {showUsageDetails && selectedScreenshotForDetails && user.role === 'admin' && (
        <UsageDetailsModal
          key={selectedScreenshotForDetails.id} // Force re-render when screenshot changes
          screenshot={selectedScreenshotForDetails}
          user={user}
          onClose={() => {
            console.log('Closing Usage Details modal')
            setShowUsageDetails(false)
            setSelectedScreenshotForDetails(null)
          }}
        />
      )}
    </div>
  )
}

// Usage Details Modal Component
interface UsageDetailsModalProps {
  screenshot: ScreenshotWithDetails
  user: Profile
  onClose: () => void
}

function UsageDetailsModal({ screenshot, user, onClose }: UsageDetailsModalProps) {
  const [loading, setLoading] = useState(true)
  const [detailedData, setDetailedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Reset state when screenshot changes
    setLoading(true)
    setDetailedData(null)
    setError(null)
    fetchDetailedData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshot.id])

  const fetchDetailedData = async () => {
    try {
      setLoading(true)
      
      // Calculate screenshot time interval
      const screenshotTime = screenshot.taken_at ? new Date(screenshot.taken_at) : null
      const timeEntry = screenshot.time_entry
      
      // Get the time interval for this screenshot
      // Screenshots are typically taken every few minutes, so we'll use a window around the screenshot time
      let intervalStart: Date
      let intervalEnd: Date
      
      if (screenshotTime && timeEntry?.start_time) {
        const entryStart = new Date(timeEntry.start_time)
        const entryEnd = timeEntry.end_time ? new Date(timeEntry.end_time) : new Date()
        
        // Use a 5-minute window around the screenshot (2.5 min before and after)
        const windowMs = 2.5 * 60 * 1000
        intervalStart = new Date(screenshotTime.getTime() - windowMs)
        intervalEnd = new Date(screenshotTime.getTime() + windowMs)
        
        // Clamp to time entry boundaries
        if (intervalStart < entryStart) intervalStart = entryStart
        if (intervalEnd > entryEnd) intervalEnd = entryEnd
      } else {
        // Fallback: use screenshot time ± 2.5 minutes
        const windowMs = 2.5 * 60 * 1000
        intervalStart = screenshotTime ? new Date(screenshotTime.getTime() - windowMs) : new Date()
        intervalEnd = screenshotTime ? new Date(screenshotTime.getTime() + windowMs) : new Date()
      }

      // First, try to use screenshot_activity already fetched with the screenshot
      let screenshotActivities = screenshot.screenshot_activity || []
      let activityLogs = screenshot.activity_logs || []
      
      // If no activity data in screenshot, fetch from screenshot_activity table
      if (screenshotActivities.length === 0) {
        const { data: screenshotActivityData, error: screenshotActivityError } = await supabase
          .from('screenshot_activity')
          .select('*')
          .eq('screenshot_id', screenshot.id)
          .order('created_at', { ascending: true })

        if (!screenshotActivityError && screenshotActivityData) {
          screenshotActivities = screenshotActivityData
          console.log('Fetched screenshot_activity data:', screenshotActivities.length, 'records')
        } else {
          console.error('Error fetching screenshot_activity:', screenshotActivityError)
          // Fallback to activity_logs if needed
          if (activityLogs.length === 0) {
            const { data: activityLogsData, error: activityLogsError } = await supabase
              .from('activity_logs')
              .select('*')
              .eq('screenshot_id', screenshot.id)
              .order('created_at', { ascending: true })
            
            if (!activityLogsError && activityLogsData) {
              activityLogs = activityLogsData
              console.log('Fetched activity_logs data:', activityLogs.length, 'records')
            }
          }
        }
      }

      console.log('Using screenshot_activity:', screenshotActivities.length, 'logs for screenshot:', screenshot.id)
      console.log('Sample activity:', screenshotActivities.length > 0 ? screenshotActivities[0] : 'none')

      // Process the data - use new schema if available, fallback to old schema
      let processedData
      if (screenshotActivities.length > 0) {
        processedData = processScreenshotActivityData(screenshotActivities, intervalStart, intervalEnd)
        console.log('Processed screenshot_activity data:', processedData)
      } else if (activityLogs.length > 0) {
        processedData = processActivityData(activityLogs, intervalStart, intervalEnd)
        console.log('Processed activity_logs data:', processedData)
      } else {
        // No data available - create empty structure
        processedData = {
          mouseActivity: {
            totalActiveTime: 0,
            totalMovements: 0,
            estimatedClicks: 0,
            scrollActivity: 0,
            clickCoordinates: [],
            movementDuration: 0,
          },
          keyboardActivity: {
            totalKeystrokes: 0,
            activeDuration: 0,
            keyFrequency: {},
            keyPresses: [],
          },
          websites: [],
          suspiciousPatterns: ['No activity data available for this screenshot'],
          confidenceScore: 0,
          timeInterval: {
            start: intervalStart,
            end: intervalEnd,
          },
          activeApplications: [],
          deviceInfo: 'Unknown',
          appVersion: 'Unknown',
        }
        console.log('No activity data found, using empty structure')
      }
      setDetailedData(processedData)
      setError(null)
    } catch (err) {
      console.error('Error fetching detailed data:', err)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      // Set default data structure even on error
      setDetailedData({
        mouseActivity: {
          totalActiveTime: 0,
          totalMovements: 0,
          estimatedClicks: 0,
          scrollActivity: 0,
          clickCoordinates: [],
          movementDuration: 0,
        },
        keyboardActivity: {
          totalKeystrokes: 0,
          activeDuration: 0,
          keyFrequency: {},
          keyPresses: [],
        },
        websites: [],
        suspiciousPatterns: ['Error loading activity data'],
        confidenceScore: 0,
        timeInterval: {
          start: screenshot.taken_at ? new Date(screenshot.taken_at) : new Date(),
          end: screenshot.taken_at ? new Date(screenshot.taken_at) : new Date(),
        },
        error: errorMessage,
      })
    } finally {
      setLoading(false)
    }
  }

  // Process new schema (screenshot_activity table)
  const processScreenshotActivityData = (activities: any[], startTime: Date, endTime: Date) => {
    try {
      // Aggregate mouse activity
      const totalMouseClicks = activities.reduce((sum, activity) => 
        sum + (activity.mouse_activity_details?.total_clicks || 0), 0
      )
      const totalMouseActiveTime = activities.reduce((sum, activity) => 
        sum + (activity.mouse_activity_details?.active_time_ms || 0), 0
      ) / 1000 // Convert to seconds
      const totalMouseMovementTime = activities.reduce((sum, activity) => 
        sum + (activity.mouse_activity_details?.movement_duration_ms || 0), 0
      ) / 1000
      const allClickCoordinates = activities.flatMap(activity => 
        activity.mouse_activity_details?.click_coordinates || []
      )
      const scrollEvents = activities.flatMap(activity => 
        activity.mouse_activity_details?.scroll_events || []
      )

      // Aggregate keyboard activity
      const totalKeystrokes = activities.reduce((sum, activity) => 
        sum + (activity.keyboard_activity_details?.total_keystrokes || 0), 0
      )
      const totalKeyboardActiveTime = activities.reduce((sum, activity) => 
        sum + (activity.keyboard_activity_details?.active_time_ms || 0), 0
      ) / 1000 // Convert to seconds
      const allKeyPresses = activities.flatMap(activity => 
        activity.keyboard_activity_details?.key_presses || []
      )
      const keyFrequencyMap = new Map<string, number>()
      activities.forEach(activity => {
        const freq = activity.keyboard_activity_details?.key_frequency || {}
        Object.entries(freq).forEach(([key, count]) => {
          keyFrequencyMap.set(key, (keyFrequencyMap.get(key) || 0) + (count as number))
        })
      })

      // Aggregate websites
      const allWebsites = activities.flatMap(activity => 
        (activity.visited_websites || []).map((site: any) => ({
          url: site.url,
          domain: site.domain || (() => {
            try {
              if (site.url.startsWith('file://')) return 'Local File'
              const urlObj = new URL(site.url.startsWith('http') ? site.url : `https://${site.url}`)
              return urlObj.hostname.replace('www.', '')
            } catch {
              return site.url
            }
          })(),
          startTime: site.start_time,
          duration: site.duration_seconds || 0,
        }))
      )
      
      // Group websites by domain
      const domainMap = new Map<string, { domain: string; visitCount: number; totalDuration: number }>()
      allWebsites.forEach(site => {
        const domain = site.domain || 'Unknown'
        if (!domainMap.has(domain)) {
          domainMap.set(domain, { domain, visitCount: 0, totalDuration: 0 })
        }
        const entry = domainMap.get(domain)!
        entry.visitCount++
        entry.totalDuration += site.duration
      })
      
      const websites = Array.from(domainMap.values())
        .sort((a, b) => b.visitCount - a.visitCount)

      // Aggregate suspicious flags
      const allFlags = activities.flatMap(activity => activity.suspicious_activity_flags || [])
      const uniqueFlags = Array.from(new Set(allFlags))

      // Calculate average percentages
      const avgMousePercentage = activities.length > 0
        ? activities.reduce((sum, a) => sum + (a.mouse_usage_percentage || 0), 0) / activities.length
        : 0
      const avgKeyboardPercentage = activities.length > 0
        ? activities.reduce((sum, a) => sum + (a.keyboard_usage_percentage || 0), 0) / activities.length
        : 0
      
      // Also calculate from actual activity counts for better accuracy
      const totalMouseCount = totalMouseClicks
      const totalKeyboardCount = totalKeystrokes
      const totalCount = totalMouseCount + totalKeyboardCount
      const calculatedMousePct = totalCount > 0 ? (totalMouseCount / totalCount) * 100 : avgMousePercentage
      const calculatedKeyboardPct = totalCount > 0 ? (totalKeyboardCount / totalCount) * 100 : avgKeyboardPercentage

      // Calculate confidence score based on flags and activity
      let confidenceScore = 100
      confidenceScore -= uniqueFlags.length * 15
      if (totalMouseClicks === 0 && totalKeystrokes === 0) {
        confidenceScore -= 30
      }
      if (avgMousePercentage < 5 && avgKeyboardPercentage < 5) {
        confidenceScore -= 20
      }
      confidenceScore = Math.max(0, Math.min(100, confidenceScore))

      return {
        mouseActivity: {
          totalActiveTime: totalMouseActiveTime,
          totalMovements: totalMouseClicks, // Using clicks as movements indicator
          estimatedClicks: totalMouseClicks,
          scrollActivity: scrollEvents.length,
          clickCoordinates: allClickCoordinates,
          movementDuration: totalMouseMovementTime,
        },
        keyboardActivity: {
          totalKeystrokes,
          activeDuration: totalKeyboardActiveTime,
          keyFrequency: Object.fromEntries(keyFrequencyMap),
          keyPresses: allKeyPresses,
        },
        websites,
        suspiciousPatterns: uniqueFlags,
        confidenceScore,
        timeInterval: {
          start: startTime,
          end: endTime,
        },
        activeApplications: activities.flatMap(a => a.active_applications || []),
        deviceInfo: activities[0]?.device_os || 'Unknown',
        appVersion: activities[0]?.app_version || 'Unknown',
        // Include pre-calculated percentages
        mousePercentage: calculatedMousePct,
        keyboardPercentage: calculatedKeyboardPct,
      }
    } catch (error) {
      console.error('Error processing screenshot activity data:', error)
      return {
        mouseActivity: {
          totalActiveTime: 0,
          totalMovements: 0,
          estimatedClicks: 0,
          scrollActivity: 0,
          clickCoordinates: [],
          movementDuration: 0,
        },
        keyboardActivity: {
          totalKeystrokes: 0,
          activeDuration: 0,
          keyFrequency: {},
          keyPresses: [],
        },
        websites: [],
        suspiciousPatterns: ['Error processing activity data'],
        confidenceScore: 0,
        timeInterval: {
          start: startTime,
          end: endTime,
        },
        activeApplications: [],
        deviceInfo: 'Unknown',
        appVersion: 'Unknown',
      }
    }
  }

  // Process old schema (activity_logs table) - kept for backward compatibility
  const processActivityData = (logs: any[], startTime: Date, endTime: Date) => {
    try {
      // Mouse Activity
      const totalMouseMovements = logs.reduce((sum, log) => {
        const movements = typeof log.mouse_movements === 'number' ? log.mouse_movements : 0
        return sum + movements
      }, 0)
      const totalKeystrokes = logs.reduce((sum, log) => {
        const keystrokes = typeof log.keystrokes === 'number' ? log.keystrokes : 0
        return sum + keystrokes
      }, 0)
    
      // Estimate mouse active time (assuming each movement takes ~0.1 seconds)
      const mouseActiveTime = totalMouseMovements * 0.1
      
      // Estimate keyboard active time (assuming average typing speed of 5 chars/second)
      const keyboardActiveTime = totalKeystrokes / 5
      
      // Extract URLs from activity logs
      const allUrls = logs
        .flatMap(log => {
          if (Array.isArray(log.urls)) {
            return log.urls
          }
          return []
        })
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
      
      // Parse domains from URLs
      const domainMap = new Map<string, number>()
      allUrls.forEach(url => {
        try {
          const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
          const domain = urlObj.hostname.replace('www.', '')
          domainMap.set(domain, (domainMap.get(domain) || 0) + 1)
        } catch {
          // Invalid URL, skip
        }
      })
      
      const websites = Array.from(domainMap.entries())
        .map(([domain, count]) => ({
          domain,
          visitCount: count,
          // Estimate time per visit (rough approximation)
          estimatedTime: count * 30 // 30 seconds per visit estimate
        }))
        .sort((a, b) => b.visitCount - a.visitCount)

      // Detect suspicious patterns
      const suspiciousPatterns = detectSuspiciousPatterns(logs, totalMouseMovements, totalKeystrokes)

      // Calculate confidence score
      const confidenceScore = calculateConfidenceScore(logs, totalMouseMovements, totalKeystrokes, suspiciousPatterns)

      return {
        mouseActivity: {
          totalActiveTime: mouseActiveTime,
          totalMovements: totalMouseMovements,
          estimatedClicks: Math.floor(totalMouseMovements / 10), // Rough estimate
          scrollActivity: Math.floor(totalMouseMovements / 50), // Rough estimate
        },
        keyboardActivity: {
          totalKeystrokes,
          activeDuration: keyboardActiveTime,
          // Key frequency would require more detailed data
          keyFrequency: {},
        },
        websites,
        suspiciousPatterns,
        confidenceScore,
        timeInterval: {
          start: startTime,
          end: endTime,
        },
      }
    } catch (error) {
      console.error('Error processing activity data:', error)
      // Return default structure on error
      return {
        mouseActivity: {
          totalActiveTime: 0,
          totalMovements: 0,
          estimatedClicks: 0,
          scrollActivity: 0,
        },
        keyboardActivity: {
          totalKeystrokes: 0,
          activeDuration: 0,
          keyFrequency: {},
        },
        websites: [],
        suspiciousPatterns: ['Error processing activity data'],
        confidenceScore: 0,
        timeInterval: {
          start: startTime,
          end: endTime,
        },
      }
    }
  }

  const detectSuspiciousPatterns = (logs: any[], mouseMovements: number, keystrokes: number) => {
    const patterns: string[] = []
    
    // Check for minimal activity
    if (mouseMovements < 10 && keystrokes < 50) {
      patterns.push('Very low activity detected')
    }
    
    // Check for repetitive patterns (if we had more detailed data)
    // For now, check if activity is too uniform
    if (logs.length > 0) {
      const avgKeystrokes = keystrokes / logs.length
      const avgMouse = mouseMovements / logs.length
      
      // Check if all logs have similar values (suspicious)
      const keystrokeVariance = logs.reduce((sum, log) => {
        const diff = (log.keystrokes || 0) - avgKeystrokes
        return sum + (diff * diff)
      }, 0) / logs.length
      
      if (keystrokeVariance < 1 && keystrokes > 0) {
        patterns.push('Repetitive keystroke pattern detected')
      }
    }
    
    // Check for inactivity bypass (very low productivity with high activity)
    if (logs.length > 0) {
      const avgProductivity = logs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / logs.length
      if (avgProductivity < 20 && (mouseMovements > 100 || keystrokes > 200)) {
        patterns.push('Possible inactivity bypass detected')
      }
    }
    
    // Check for artificial mouse movement (too many movements with low keystrokes)
    if (mouseMovements > keystrokes * 5 && mouseMovements > 200) {
      patterns.push('Artificial mouse movement pattern detected')
    }
    
    return patterns
  }

  const calculateConfidenceScore = (
    logs: any[],
    mouseMovements: number,
    keystrokes: number,
    suspiciousPatterns: string[]
  ): number => {
    let score = 100
    
    // Deduct points for suspicious patterns
    score -= suspiciousPatterns.length * 15
    
    // Deduct for very low activity
    if (mouseMovements < 10 && keystrokes < 50) {
      score -= 20
    }
    
    // Deduct for low productivity
    if (logs.length > 0) {
      const avgProductivity = logs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / logs.length
      if (avgProductivity < 30) {
        score -= 15
      }
    }
    
    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, score))
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8">
          <Loader size="lg" text="Loading usage details..." />
        </div>
      </div>
    )
  }

  // Show error state if there's an error and no data
  if (error && !detailedData) {
    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose()
          }
        }}
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Unable to Load Data</h2>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              There was an error loading the usage details.
            </p>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-6">
                Error: {error}
              </p>
            )}
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // If no data after loading, show empty state
  if (!loading && !detailedData) {
    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose()
          }
        }}
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Info className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">No Data Available</h2>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              No activity data is available for this screenshot.
            </p>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Safely extract data with defaults to prevent crashes
  const mouseActivity = detailedData?.mouseActivity || {
    totalActiveTime: 0,
    totalMovements: 0,
    estimatedClicks: 0,
    scrollActivity: 0,
  }
  const keyboardActivity = detailedData?.keyboardActivity || {
    totalKeystrokes: 0,
    activeDuration: 0,
    keyFrequency: {},
  }
  const websites = detailedData?.websites || []
  const suspiciousPatterns = detailedData?.suspiciousPatterns || []
  const confidenceScore = detailedData?.confidenceScore || 0
  const timeInterval = detailedData?.timeInterval || {
    start: screenshot.taken_at ? new Date(screenshot.taken_at) : new Date(),
    end: screenshot.taken_at ? new Date(screenshot.taken_at) : new Date(),
  }

  // Calculate percentages - prefer using clicks/keystrokes ratio, or use pre-calculated if available
  const totalMouseActivity = (mouseActivity?.estimatedClicks || mouseActivity?.totalMovements || 0)
  const totalKeyboardActivity = (keyboardActivity?.totalKeystrokes || 0)
  const totalActivity = totalMouseActivity + totalKeyboardActivity
  
  let mousePercentage = 0
  let keyboardPercentage = 0
  
  if (totalActivity > 0) {
    mousePercentage = (totalMouseActivity / totalActivity) * 100
    keyboardPercentage = (totalKeyboardActivity / totalActivity) * 100
  } else if (detailedData?.mousePercentage !== undefined && detailedData?.keyboardPercentage !== undefined) {
    // Use pre-calculated percentages if available
    mousePercentage = detailedData.mousePercentage
    keyboardPercentage = detailedData.keyboardPercentage
  }

  // Ensure we have data before rendering main content
  if (!detailedData) {
    // Should have been caught by earlier checks, but just in case
    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose()
          }
        }}
      >
        <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full shadow-2xl p-6">
          <p className="text-gray-700 dark:text-gray-300">Loading data...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl max-w-7xl w-full max-h-[95vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Usage Details</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {screenshot.taken_at
                  ? format(new Date(screenshot.taken_at), 'MMM d, yyyy • h:mm:ss a')
                  : '—'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                Interval: {timeInterval?.start ? format(new Date(timeInterval.start), 'h:mm:ss a') : '—'} - {timeInterval?.end ? format(new Date(timeInterval.end), 'h:mm:ss a') : '—'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Usage Overview with Progress Bars */}
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Usage Overview</h3>
            
            {/* Mouse Usage Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <MousePointer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mouse Usage</span>
                </div>
                <Tooltip
                  content={`Mouse Activity: ${mouseActivity.estimatedClicks || mouseActivity.totalMovements || 0} clicks | ${mouseActivity.totalActiveTime.toFixed(1)}s active time | ${mouseActivity.scrollActivity || 0} scroll events | ${mouseActivity.movementDuration ? mouseActivity.movementDuration.toFixed(1) : 0}s movement`}
                  position="top"
                >
                  <span className="text-sm font-bold text-gray-800 dark:text-white">
                    {mousePercentage.toFixed(1)}%
                  </span>
                </Tooltip>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 flex items-center justify-end pr-2 ${
                    mousePercentage >= 70 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                    mousePercentage >= 40 ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                    mousePercentage >= 20 ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' :
                    'bg-gradient-to-r from-gray-400 to-gray-500'
                  }`}
                  style={{ width: `${Math.max(mousePercentage, 2)}%` }}
                >
                  {mousePercentage > 10 && (
                    <span className="text-xs font-semibold text-white">
                      {(mouseActivity.estimatedClicks || mouseActivity.totalMovements || 0) > 0 ? (mouseActivity.estimatedClicks || mouseActivity.totalMovements || 0).toLocaleString() : '0'}
                    </span>
                  )}
                </div>
              </div>
              {mousePercentage <= 10 && (mouseActivity.estimatedClicks || mouseActivity.totalMovements || 0) > 0 && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                  {(mouseActivity.estimatedClicks || mouseActivity.totalMovements || 0).toLocaleString()} clicks
                </div>
              )}
            </div>

            {/* Keyboard Usage Progress Bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Keyboard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Keyboard Usage</span>
                </div>
                <Tooltip
                  content={`Keyboard Activity: ${keyboardActivity.totalKeystrokes.toLocaleString()} keystrokes | ${keyboardActivity.activeDuration.toFixed(1)}s active duration | ${keyboardActivity.activeDuration > 0 ? (keyboardActivity.totalKeystrokes / keyboardActivity.activeDuration).toFixed(1) : '0'} keys/second typing speed`}
                  position="top"
                >
                  <span className="text-sm font-bold text-gray-800 dark:text-white">
                    {keyboardPercentage.toFixed(1)}%
                  </span>
                </Tooltip>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 flex items-center justify-end pr-2 ${
                    keyboardPercentage >= 70 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                    keyboardPercentage >= 40 ? 'bg-gradient-to-r from-purple-500 to-purple-600' :
                    keyboardPercentage >= 20 ? 'bg-gradient-to-r from-orange-500 to-orange-600' :
                    'bg-gradient-to-r from-gray-400 to-gray-500'
                  }`}
                  style={{ width: `${Math.max(keyboardPercentage, 2)}%` }}
                >
                  {keyboardPercentage > 10 && (
                    <span className="text-xs font-semibold text-white">
                      {keyboardActivity.totalKeystrokes > 0 ? keyboardActivity.totalKeystrokes.toLocaleString() : '0'}
                    </span>
                  )}
                </div>
              </div>
              {keyboardPercentage <= 10 && keyboardActivity.totalKeystrokes > 0 && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                  {keyboardActivity.totalKeystrokes.toLocaleString()} keystrokes
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-600">
              <div className="flex items-center justify-center space-x-4 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 rounded bg-green-500"></div>
                  <span>High (≥70%)</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 rounded bg-blue-500"></div>
                  <span>Medium (40-69%)</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 rounded bg-yellow-500"></div>
                  <span>Low (20-39%)</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 rounded bg-gray-400"></div>
                  <span>Minimal (&lt;20%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* System Flags & Insights */}
          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">System Flags & Insights</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Confidence:</span>
                <span className={`text-lg font-bold ${
                  confidenceScore >= 80 ? 'text-green-600 dark:text-green-400' :
                  confidenceScore >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-red-600 dark:text-red-400'
                }`}>
                  {confidenceScore}%
                </span>
              </div>
            </div>
            {suspiciousPatterns.length > 0 ? (
              <div className="space-y-2">
                {suspiciousPatterns.map((pattern, idx) => (
                  <div key={idx} className="flex items-start space-x-2 text-sm text-gray-700 dark:text-gray-300">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <span>{pattern}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">No suspicious patterns detected. Activity appears normal.</p>
            )}
          </div>

          {/* Mouse Activity Section */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
            <div className="flex items-center space-x-2 mb-4">
              <MousePointer className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Mouse Activity</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Active Time</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {mouseActivity.totalActiveTime.toFixed(1)}s
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Movements</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {mouseActivity.totalMovements.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Estimated Clicks</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {mouseActivity.estimatedClicks}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Scroll Activity</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {mouseActivity.scrollActivity}
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
              <p className="text-xs text-yellow-800 dark:text-yellow-300">
                <strong>Note:</strong> Click heatmap and detailed click coordinates require additional data from the tracking application. 
                Current data shows aggregate movement counts.
              </p>
            </div>
          </div>

          {/* Keyboard Activity Section */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
            <div className="flex items-center space-x-2 mb-4">
              <Keyboard className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Keyboard Activity</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Keystrokes</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {keyboardActivity.totalKeystrokes.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Active Duration</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {keyboardActivity.activeDuration.toFixed(1)}s
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Typing Speed</div>
                <div className="text-xl font-semibold text-gray-800 dark:text-white">
                  {keyboardActivity.activeDuration > 0 
                    ? (keyboardActivity.totalKeystrokes / keyboardActivity.activeDuration).toFixed(1)
                    : '0'} keys/s
                </div>
              </div>
            </div>
            {keyboardActivity.keyFrequency && Object.keys(keyboardActivity.keyFrequency).length > 0 && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                <div className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-2">
                  Key Frequency (Top Keys):
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(keyboardActivity.keyFrequency)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 10)
                    .map(([key, count]) => (
                      <div key={key} className="text-xs bg-blue-100 dark:bg-blue-800 px-2 py-1 rounded">
                        {key}: {count as number}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Website & App Usage */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
            <div className="flex items-center space-x-2 mb-4">
              <Globe className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Website & App Usage</h3>
            </div>
            {websites.length > 0 ? (
              <div className="space-y-2">
                {websites.slice(0, 10).map((site: any, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 dark:text-white">{site.domain || 'Unknown'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {site.visitCount || 0} {site.visitCount === 1 ? 'visit' : 'visits'} • {site.totalDuration ? site.totalDuration.toFixed(0) : site.estimatedTime || 0}s
                      </div>
                    </div>
                  </div>
                ))}
                {websites.length > 10 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2">
                    +{websites.length - 10} more websites
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">No website data available for this interval.</p>
            )}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-800 dark:text-blue-300">
                <strong>Privacy:</strong> Only domain-level URLs are displayed. Full paths and sensitive data are not shown.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
