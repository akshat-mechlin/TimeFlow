import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { 
  User, Mail, Shield, Calendar, Save, Edit2, X, Camera, 
  Clock, FileText, CheckCircle, TrendingUp, Award, Briefcase,
  Phone, MapPin, Building2, UserCircle
} from 'lucide-react'
import { format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import Loader from '../components/Loader'
import { useToast } from '../contexts/ToastContext'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type TimeEntry = Tables<'time_entries'>

interface ProfileProps {
  user: Profile
  onProfileUpdate?: (userId: string) => void
}

interface UserStats {
  todayHours: number
  weekHours: number
  monthHours: number
  totalHours: number
  projectsAssigned: number
  activeProjects: number
  completedProjects: number
  attendanceRate: number
  presentDays: number
  halfDays: number
  absentDays: number
}

export default function Profile({ user: initialUser, onProfileUpdate }: ProfileProps) {
  const [searchParams] = useSearchParams()
  const viewUserId = searchParams.get('userId')
  const [user, setUser] = useState(initialUser)
  const [viewingOtherUser, setViewingOtherUser] = useState(false)
  const { showSuccess, showError } = useToast()
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [statsLoading, setStatsLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    full_name: initialUser.full_name,
    email: initialUser.email || '',
    team: initialUser.team || '',
    phone: (initialUser as any).phone || '',
    location: (initialUser as any).location || '',
  })
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)

  useEffect(() => {
    // If viewing another user's profile, fetch their data
    if (viewUserId && viewUserId !== initialUser.id) {
      fetchUserProfile(viewUserId)
      setViewingOtherUser(true)
    } else {
      setUser(initialUser)
      setViewingOtherUser(false)
    }
  }, [viewUserId, initialUser.id])

  useEffect(() => {
    if (user.id) {
      fetchUserStats()
      fetchProfileImage()
      setFormData({
        full_name: user.full_name,
        email: user.email || '',
        team: user.team || '',
        phone: (user as any).phone || '',
        location: (user as any).location || '',
      })
    }
  }, [user.id])

  const fetchUserProfile = async (userId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      if (data) {
        setUser(data)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
      showError('Failed to load user profile')
    } finally {
      setLoading(false)
    }
  }

  const fetchProfileImage = async () => {
    try {
      // Check if user has a profile image URL stored
      if ((user as any).avatar_url) {
        // Verify the image exists by trying to load it
        const img = new Image()
        img.onload = () => setProfileImageUrl((user as any).avatar_url)
        img.onerror = () => setProfileImageUrl(null)
        img.src = (user as any).avatar_url
      } else {
        setProfileImageUrl(null)
      }
    } catch (error) {
      console.error('Error fetching profile image:', error)
      setProfileImageUrl(null)
    }
  }

  const fetchUserStats = async () => {
    try {
      setStatsLoading(true)
      const todayStart = startOfDay(new Date()).toISOString()
      const todayEnd = endOfDay(new Date()).toISOString()
      const weekStart = startOfWeek(new Date()).toISOString()
      const weekEnd = endOfWeek(new Date()).toISOString()
      const monthStart = startOfMonth(new Date()).toISOString()
      const monthEnd = endOfMonth(new Date()).toISOString()

      // Fetch time entries
      const { data: allEntries } = await supabase
        .from('time_entries')
        .select('duration, start_time')
        .eq('user_id', user.id)

      const todayEntries = allEntries?.filter(e => 
        e.start_time >= todayStart && e.start_time <= todayEnd
      ) || []
      const weekEntries = allEntries?.filter(e => 
        e.start_time >= weekStart && e.start_time <= weekEnd
      ) || []
      const monthEntries = allEntries?.filter(e => 
        e.start_time >= monthStart && e.start_time <= monthEnd
      ) || []

      const todayHours = todayEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / 3600
      const weekHours = weekEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / 3600
      const monthHours = monthEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / 3600
      const totalHours = (allEntries?.reduce((sum, e) => sum + (e.duration || 0), 0) || 0) / 3600

      // Fetch projects
      const { data: projectMembers } = await supabase
        .from('project_members')
        .select('project_id, projects(status)')
        .eq('user_id', user.id)

      const projectsAssigned = projectMembers?.length || 0
      const activeProjects = projectMembers?.filter(p => (p.projects as any)?.status === 'active').length || 0
      const completedProjects = projectMembers?.filter(p => (p.projects as any)?.status === 'completed').length || 0

      // Calculate attendance (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30)
      const attendanceEntries = allEntries?.filter(e => 
        new Date(e.start_time) >= thirtyDaysAgo
      ) || []

      // Group by date and calculate attendance
      const dateMap = new Map<string, number>()
      attendanceEntries.forEach(entry => {
        const date = format(new Date(entry.start_time), 'yyyy-MM-dd')
        const hours = (entry.duration || 0) / 3600
        dateMap.set(date, (dateMap.get(date) || 0) + hours)
      })

      let presentDays = 0
      let halfDays = 0
      let absentDays = 0

      dateMap.forEach((hours) => {
        if (hours >= 8) presentDays++
        else if (hours >= 4) halfDays++
        else absentDays++
      })

      const totalDays = dateMap.size
      const attendanceRate = totalDays > 0 ? ((presentDays + halfDays * 0.5) / totalDays) * 100 : 0

      setStats({
        todayHours,
        weekHours,
        monthHours,
        totalHours,
        projectsAssigned,
        activeProjects,
        completedProjects,
        attendanceRate,
        presentDays,
        halfDays,
        absentDays,
      })
    } catch (error) {
      console.error('Error fetching user stats:', error)
    } finally {
      setStatsLoading(false)
    }
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0]
      if (!file) return

      // Validate file type
      if (!file.type.startsWith('image/')) {
        showError('Please select an image file')
        return
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        showError('Image size should be less than 5MB')
        return
      }

      setUploading(true)

      // Create storage path
      const fileExt = file.name.split('.').pop()
      const fileName = `${user.id}-${Date.now()}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })

      if (uploadError) {
        // If bucket doesn't exist, provide helpful error message
        if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('not found')) {
          throw new Error('Storage bucket "avatars" not found. Please create it in Supabase Storage settings.')
        }
        throw uploadError
      }

      // Get public URL
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
      
      if (data?.publicUrl) {
        // Update profile with avatar URL
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: data.publicUrl })
          .eq('id', user.id)

        if (updateError) throw updateError

        setProfileImageUrl(data.publicUrl)
        setUser({ ...user, avatar_url: data.publicUrl } as Profile)
        
        // Refresh user profile in App.tsx to update Layout component
        if (onProfileUpdate) {
          onProfileUpdate(user.id)
        }
        
        showSuccess('Profile picture updated successfully!')
      }
    } catch (error: any) {
      console.error('Error uploading image:', error)
      showError(`Failed to upload image: ${error.message || 'Unknown error'}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          email: formData.email,
          team: formData.team || null,
          phone: formData.phone || null,
          location: formData.location || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) throw error

      setUser({ ...user, ...formData } as Profile)
      setEditing(false)
      showSuccess('Profile updated successfully!')
    } catch (error) {
      console.error('Error updating profile:', error)
      showError('Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Loader size="lg" text="Loading profile..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {viewingOtherUser && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Viewing profile of: <span className="font-semibold text-gray-800 dark:text-white">{user.full_name}</span>
          </div>
        )}
        <div className="flex items-center justify-end">
          {!editing && !viewingOtherUser && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm"
            >
              <Edit2 className="w-5 h-5" />
              <span>Edit Profile</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Profile Card */}
        <div className="lg:col-span-1">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 sticky top-6 backdrop-blur-sm">
            {/* Profile Picture */}
            <div className="flex flex-col items-center mb-6">
              <div className="relative group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-blue-100 dark:border-blue-900/30 shadow-lg">
                  {profileImageUrl ? (
                    <img
                      src={profileImageUrl}
                      alt={user.full_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 flex items-center justify-center text-white font-bold text-4xl">
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                {editing && !viewingOtherUser && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="absolute bottom-0 right-0 w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-full flex items-center justify-center shadow-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all disabled:opacity-50"
                  >
                    {uploading ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    ) : (
                      <Camera className="w-5 h-5" />
                    )}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mt-4">{user.full_name}</h2>
              <p className="text-gray-600 dark:text-gray-400 capitalize mt-1">{user.role}</p>
              {user.team && (
                <p className="text-sm text-gray-500 mt-1 flex items-center space-x-1">
                  <Building2 className="w-4 h-4" />
                  <span>{user.team}</span>
                </p>
              )}
            </div>

            {/* Quick Stats */}
            {stats && (
              <div className="space-y-4 pt-6 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Member Since</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-white">
                    {user.created_at ? format(new Date(user.created_at), 'MMM yyyy') : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Total Hours</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-white">
                    {stats.totalHours.toFixed(1)}h
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Projects</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-white">
                    {stats.projectsAssigned}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Attendance Rate</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-white">
                    {stats.attendanceRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Details and Stats */}
        <div className="lg:col-span-2 space-y-6">
          {/* General Information */}
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                <UserCircle className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                <span>General Information</span>
              </h3>
                {editing && !viewingOtherUser && (
                <button
                  onClick={() => {
                    setFormData({
                      full_name: user.full_name,
                      email: user.email || '',
                      team: user.team || '',
                      phone: (user as any).phone || '',
                      location: (user as any).location || '',
                    })
                    setEditing(false)
                  }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <User className="w-4 h-4" />
                  <span>Full Name</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                ) : (
                  <p className="text-gray-800 dark:text-white py-2">{user.full_name}</p>
                )}
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Mail className="w-4 h-4" />
                  <span>Email</span>
                </label>
                {editing ? (
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                ) : (
                  <p className="text-gray-800 dark:text-white py-2">{user.email || 'Not set'}</p>
                )}
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Shield className="w-4 h-4" />
                  <span>Role</span>
                </label>
                <p className="text-gray-800 dark:text-white py-2 capitalize">{user.role}</p>
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Building2 className="w-4 h-4" />
                  <span>Team/Department</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.team}
                    onChange={(e) => setFormData({ ...formData, team: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    placeholder="Enter team or department"
                  />
                ) : (
                  <p className="text-gray-800 dark:text-white py-2">{user.team || 'Not set'}</p>
                )}
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Phone className="w-4 h-4" />
                  <span>Phone</span>
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    placeholder="Enter phone number"
                  />
                ) : (
                  <p className="text-gray-800 dark:text-white py-2">{(user as any).phone || 'Not set'}</p>
                )}
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <MapPin className="w-4 h-4" />
                  <span>Location</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    placeholder="Enter location"
                  />
                ) : (
                  <p className="text-gray-800 dark:text-white py-2">{(user as any).location || 'Not set'}</p>
                )}
              </div>

              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Calendar className="w-4 h-4 text-white dark:text-white" />
                  <span>Member Since</span>
                </label>
                <p className="text-gray-800 dark:text-white py-2">
                  {user.created_at ? format(new Date(user.created_at), 'MMMM d, yyyy') : 'N/A'}
                </p>
              </div>
            </div>

                {editing && !viewingOtherUser && (
              <div className="flex items-center space-x-3 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all disabled:opacity-50 shadow-sm"
                >
                  <Save className="w-5 h-5" />
                  <span>{loading ? 'Saving...' : 'Save Changes'}</span>
                </button>
                <button
                  onClick={() => {
                    setFormData({
                      full_name: user.full_name,
                      email: user.email || '',
                      team: user.team || '',
                      phone: (user as any).phone || '',
                      location: (user as any).location || '',
                    })
                    setEditing(false)
                  }}
                  className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Statistics */}
          {statsLoading ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12">
              <Loader size="md" text="Loading statistics" />
            </div>
          ) : stats ? (
            <>
              {/* Time Tracking Stats */}
              <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
                <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2 mb-6">
                  <Clock className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  <span>Time Tracking</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Today</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.todayHours.toFixed(1)}h</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">This Week</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.weekHours.toFixed(1)}h</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">This Month</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.monthHours.toFixed(1)}h</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.totalHours.toFixed(1)}h</p>
                  </div>
                </div>
              </div>

              {/* Project Stats */}
              <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
                <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2 mb-6">
                  <Briefcase className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  <span>Projects</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-gray-600 dark:text-gray-400">Total Assigned</p>
                      <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <p className="text-3xl font-bold text-gray-800 dark:text-white">{stats.projectsAssigned}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-gray-600 dark:text-gray-400">Active</p>
                      <TrendingUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <p className="text-3xl font-bold text-gray-800 dark:text-white">{stats.activeProjects}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
                      <Award className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <p className="text-3xl font-bold text-gray-800 dark:text-white">{stats.completedProjects}</p>
                  </div>
                </div>
              </div>

              {/* Attendance Stats */}
              <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
                <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2 mb-6">
                  <CheckCircle className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  <span>Attendance (Last 30 Days)</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Present</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.presentDays} days</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Half Day</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.halfDays} days</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Absent</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.absentDays} days</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Attendance Rate</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.attendanceRate.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
