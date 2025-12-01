import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Filter, Calendar, Image, Video, Download, Eye, User, ZoomIn, ZoomOut, MousePointer, Keyboard, TrendingUp, FolderKanban } from 'lucide-react'
import { format, startOfDay, endOfDay, parseISO, getHours } from 'date-fns'
import Loader from '../components/Loader'
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
    keystrokes: number
    mouse_movements: number
    productivity_score: number
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
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotWithDetails | null>(null)
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [imageUrls, setImageUrls] = useState<{ [key: string]: string }>({})
  const [zoomLevel, setZoomLevel] = useState(1)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTeamMembers()
  }, [user.id])

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
          ),
          activity_logs(
            keystrokes,
            mouse_movements,
            productivity_score
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
      
      // Pre-fetch image URLs for all screenshots
      // Try to get signed URLs if public URLs don't work
      const screenshotsWithUrls = await Promise.all(
        (data || []).map(async (screenshot) => {
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

          return { ...screenshot, imageUrl: url }
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
          {/* User Filter - Show team member names */}
          <div className="flex items-center space-x-2">
            <User className="w-4 h-4 text-gray-500" />
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name} {member.id === user.id ? '(Me)' : ''}
                </option>
              ))}
            </select>
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
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
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
                          {screenshot.activity_logs && screenshot.activity_logs.length > 0 && (
                            <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
                              <div className="text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Activity</div>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(() => {
                                  const totalKeystrokes = screenshot.activity_logs.reduce((sum, log) => sum + (log.keystrokes || 0), 0)
                                  const totalMouseMovements = screenshot.activity_logs.reduce((sum, log) => sum + (log.mouse_movements || 0), 0)
                                  const avgProductivity = screenshot.activity_logs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / screenshot.activity_logs.length
                                  
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
                                      {totalMouseMovements > 0 && (
                                        <div className="flex flex-col items-center p-1.5 bg-gray-100 dark:bg-gray-700/50 rounded">
                                          <MousePointer className="w-3 h-3 text-gray-600 dark:text-gray-400 mb-0.5" />
                                          <span className="text-[10px] font-semibold text-gray-900 dark:text-gray-100">
                                            {totalMouseMovements > 999 ? `${(totalMouseMovements / 1000).toFixed(1)}k` : totalMouseMovements}
                                          </span>
                                          <span className="text-[9px] text-gray-500 dark:text-gray-400">mouse</span>
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
              {selectedScreenshot.activity_logs && selectedScreenshot.activity_logs.length > 0 && (
                <div>
                  <div className="flex items-center space-x-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Activity Metrics</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(() => {
                      const totalKeystrokes = selectedScreenshot.activity_logs.reduce((sum, log) => sum + (log.keystrokes || 0), 0)
                      const totalMouseMovements = selectedScreenshot.activity_logs.reduce((sum, log) => sum + (log.mouse_movements || 0), 0)
                      const avgProductivity = selectedScreenshot.activity_logs.reduce((sum, log) => sum + (log.productivity_score || 0), 0) / selectedScreenshot.activity_logs.length
                      
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
    </div>
  )
}
