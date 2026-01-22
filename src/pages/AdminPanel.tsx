import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Users, Settings, Shield, BarChart3, UserPlus, Key, Search, Edit, Trash2, Mail, X, Check, Clock, Calendar, Bell, Save, Download, TrendingUp, Activity, Camera, Monitor } from 'lucide-react'
import Loader from '../components/Loader'
import { useToast } from '../contexts/ToastContext'
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
import { format, startOfMonth, endOfMonth, subDays, eachDayOfInterval } from 'date-fns'
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

interface AdminPanelProps {
  user: Profile
}

export default function AdminPanel({ user }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showEditUserModal, setShowEditUserModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [managerFilter, setManagerFilter] = useState('all')
  const [newUserForm, setNewUserForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'employee' as 'employee' | 'manager' | 'admin' | 'hr' | 'accountant',
    team: '',
    manager_id: '',
  })
  const [editUserForm, setEditUserForm] = useState({
    email: '',
    full_name: '',
    role: 'employee' as 'employee' | 'manager' | 'admin' | 'hr' | 'accountant',
    team: '',
    manager_id: '',
    password: '',
  })
  const [managers, setManagers] = useState<Profile[]>([])
  const [teams, setTeams] = useState<string[]>([])
  const [showNewTeamInput, setShowNewTeamInput] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const { showSuccess, showError } = useToast()
  
  // System Settings state
  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({})
  const [settingsLoading, setSettingsLoading] = useState(false)
  
  // Analytics state
  const [analyticsData, setAnalyticsData] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalHours: 0,
    attendanceRate: 0,
    userActivityData: null as any,
    attendanceData: null as any,
    roleDistribution: null as any,
    projectHoursData: null as any,
    productivityData: null as any,
    topUsers: [] as Array<{ name: string; hours: number }>,
  })
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsDateRange, setAnalyticsDateRange] = useState('30d') // 7d, 30d, 90d, all

  // Only allow admin access
  if (user.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400">Only administrators can access this page.</p>
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers()
      fetchManagers()
      fetchTeams()
      
      // Set up real-time subscription for profiles
      const profilesChannel = supabase
        .channel('admin-profiles-realtime')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
          },
          () => {
            fetchUsers()
            fetchManagers()
            fetchTeams()
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(profilesChannel)
      }
    } else if (activeTab === 'settings') {
      fetchSystemSettings()
      
      // Set up real-time subscription for system settings
      const settingsChannel = supabase
        .channel('admin-settings-realtime')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'system_settings',
          },
          () => {
            fetchSystemSettings()
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(settingsChannel)
      }
    } else if (activeTab === 'analytics') {
      fetchAnalytics()
    }
  }, [activeTab])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true })

      if (error) throw error
      setUsers(data || [])
    } catch (error: any) {
      console.error('Error fetching users:', error)
      showError(error.message || 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  const fetchManagers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'manager', 'hr'])
        .order('full_name', { ascending: true })

      if (error) throw error
      setManagers(data || [])
    } catch (error) {
      console.error('Error fetching managers:', error)
    }
  }

  const fetchTeams = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('team')
        .not('team', 'is', null)
        .neq('team', '')

      if (error) throw error

      // Get unique teams and sort them
      const uniqueTeams = Array.from(new Set((data || []).map((p) => p.team).filter(Boolean))) as string[]
      uniqueTeams.sort()
      setTeams(uniqueTeams)
    } catch (error) {
      console.error('Error fetching teams:', error)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Create user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: newUserForm.email,
        password: newUserForm.password,
        email_confirm: true, // Auto-confirm email
      })

      if (authError) throw authError

      if (!authData.user) {
        throw new Error('Failed to create user account')
      }

      // Create profile in profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: newUserForm.email,
          full_name: newUserForm.full_name,
          role: newUserForm.role,
          team: newUserForm.team || null,
          manager_id: newUserForm.manager_id || null,
          force_password_change: true, // Force password change on first login
          enable_screenshot_capture: true, // Default: enabled
          enable_camera_capture: true, // Default: enabled
        })

      if (profileError) {
        // If profile creation fails, try to delete the auth user
        await supabase.auth.admin.deleteUser(authData.user.id)
        throw profileError
      }

      showSuccess('User created successfully!')
      setShowAddUserModal(false)
      setNewUserForm({
        email: '',
        password: '',
        full_name: '',
        role: 'employee',
        team: '',
        manager_id: '',
      })
      setShowNewTeamInput(false)
      setNewTeamName('')
      fetchUsers()
      fetchTeams() // Refresh teams list in case a new one was added
    } catch (error: any) {
      console.error('Error creating user:', error)
      showError(error.message || 'Failed to create user')
    }
  }

  const handleResetPassword = async (userId: string, userEmail: string) => {

    try {
      // Try to use admin API to generate password reset link
      try {
        const { error: resetError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email: userEmail,
        })

        if (!resetError) {
          showSuccess('Password reset email sent to user.')
          setShowResetPasswordModal(false)
          setSelectedUser(null)
          return
        }
      } catch (adminError) {
        console.warn('Admin API not available, using alternative method:', adminError)
      }

      // Alternative: Update the profile to force password change
      // This will require the user to change password on next login
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ force_password_change: true })
        .eq('id', userId)

      if (updateError) throw updateError

      showSuccess('Password reset initiated. User will be prompted to change password on next login.')
      setShowResetPasswordModal(false)
      setSelectedUser(null)
    } catch (error: any) {
      console.error('Error resetting password:', error)
      showError(error.message || 'Failed to reset password. Admin API access may be required.')
    }
  }

  const handleEditUser = (user: Profile) => {
    setSelectedUser(user)
    const userTeam = user.team || ''
    setEditUserForm({
      email: user.email || '',
      full_name: user.full_name,
      role: user.role,
      team: userTeam,
      manager_id: user.manager_id || '',
      password: '', // Always start with empty password
    })
    // Check if the user's team exists in the teams list, if not, show new team input
    setShowNewTeamInput(userTeam !== '' && !teams.includes(userTeam))
    setNewTeamName(userTeam !== '' && !teams.includes(userTeam) ? userTeam : '')
    setShowEditUserModal(true)
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return


    // Validate password if provided
    if (editUserForm.password && editUserForm.password.length > 0 && editUserForm.password.length < 6) {
      showError('Password must be at least 6 characters')
      return
    }

    try {
      const originalEmail = selectedUser.email
      const passwordChanged = editUserForm.password.trim().length > 0

      // Update profile in profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          email: editUserForm.email,
          full_name: editUserForm.full_name,
          role: editUserForm.role,
          team: editUserForm.team || null,
          manager_id: editUserForm.manager_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedUser.id)

      if (profileError) throw profileError

      // Update auth user (email and/or password) if admin API is available
      let authUpdateSuccess = true
      let authErrorMessage = ''
      
      try {
        const updateData: any = {}
        
        if (originalEmail !== editUserForm.email) {
          updateData.email = editUserForm.email
          updateData.email_confirm = true // Auto-confirm new email
        }
        
        if (passwordChanged) {
          updateData.password = editUserForm.password
        }

        if (Object.keys(updateData).length > 0) {
          const { error: authError } = await supabase.auth.admin.updateUserById(selectedUser.id, updateData)
          if (authError) {
            console.warn('Could not update auth user (may require service role key):', authError)
            authUpdateSuccess = false
            if (passwordChanged) {
              authErrorMessage = 'Profile updated, but password could not be changed. Admin API access may be required.'
            } else if (originalEmail !== editUserForm.email) {
              authErrorMessage = 'Profile updated, but email could not be changed. Admin API access may be required.'
            }
          }
        }
      } catch (authError: any) {
        console.warn('Could not update auth user (may require service role key):', authError)
        authUpdateSuccess = false
        if (passwordChanged) {
          authErrorMessage = 'Profile updated, but password could not be changed. Admin API access may be required.'
        } else if (originalEmail !== editUserForm.email) {
          authErrorMessage = 'Profile updated, but email could not be changed. Admin API access may be required.'
        }
      }

      // Always close modal and refresh since profile was successfully updated
      setShowEditUserModal(false)
      setSelectedUser(null)
      setEditUserForm({
        email: '',
        full_name: '',
        role: 'employee',
        team: '',
        manager_id: '',
        password: '',
      })
      setShowNewTeamInput(false)
      setNewTeamName('')
      fetchUsers()
      fetchTeams() // Refresh teams list in case a new one was added

      // Show appropriate message
      if (authErrorMessage) {
        // Show warning but profile was still updated successfully
        showError(authErrorMessage)
      } else {
        showSuccess(passwordChanged ? 'User saved successfully! Password has been changed.' : 'User saved successfully!')
      }
    } catch (error: any) {
      console.error('Error updating user:', error)
      showError(error.message || 'Failed to update user')
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return
    }


    try {
      // Delete from profiles table first
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId)

      if (profileError) throw profileError

      // Delete from auth (if admin API is available)
      try {
        await supabase.auth.admin.deleteUser(userId)
      } catch (authError) {
        console.warn('Could not delete auth user (may require service role key):', authError)
      }

      showSuccess('User deleted successfully!')
      fetchUsers()
    } catch (error: any) {
      console.error('Error deleting user:', error)
      showError(error.message || 'Failed to delete user')
    }
  }

  const handleToggleCaptureSetting = async (userId: string, setting: 'screenshot' | 'camera', currentValue: boolean) => {
    try {
      const updateField = setting === 'screenshot' ? 'enable_screenshot_capture' : 'enable_camera_capture'
      const newValue = !currentValue

      const { error } = await supabase
        .from('profiles')
        .update({
          [updateField]: newValue,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (error) throw error

      // Update local state
      setUsers(users.map(u => 
        u.id === userId 
          ? { ...u, [updateField]: newValue }
          : u
      ))

      showSuccess(`${setting === 'screenshot' ? 'Screenshot' : 'Camera'} capture ${newValue ? 'enabled' : 'disabled'} for user`)
    } catch (error: any) {
      console.error(`Error updating ${setting} capture setting:`, error)
      showError(error.message || `Failed to update ${setting} capture setting`)
    }
  }

  const fetchSystemSettings = async () => {
    try {
      setSettingsLoading(true)
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .order('category', { ascending: true })

      if (error) throw error

      const settingsMap: Record<string, string> = {}
      data?.forEach((setting) => {
        // Extract value from JSONB
        const value = typeof setting.setting_value === 'string' 
          ? setting.setting_value.replace(/^"|"$/g, '') 
          : setting.setting_value
        settingsMap[setting.setting_key] = value as string
      })
      setSystemSettings(settingsMap)
    } catch (error: any) {
      console.error('Error fetching system settings:', error)
      showError(error.message || 'Failed to fetch system settings')
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveSystemSetting = async (key: string, value: string) => {
    try {
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          setting_key: key,
          setting_value: JSON.stringify(value),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'setting_key'
        })

      if (error) throw error
      setSystemSettings({ ...systemSettings, [key]: value })
      showSuccess('Setting saved successfully!')
    } catch (error: any) {
      console.error('Error saving setting:', error)
      showError(error.message || 'Failed to save setting')
    }
  }

  const fetchAnalytics = async () => {
    try {
      setAnalyticsLoading(true)
      
      // Calculate date range
      let daysAgo = 30
      if (analyticsDateRange === '7d') daysAgo = 7
      else if (analyticsDateRange === '30d') daysAgo = 30
      else if (analyticsDateRange === '90d') daysAgo = 90
      else daysAgo = 365 // all
      
      const startDate = daysAgo === 365 ? new Date(0).toISOString() : subDays(new Date(), daysAgo).toISOString()
      
      // Fetch user statistics
      const { data: allUsers } = await supabase.from('profiles').select('id, role, created_at, full_name')
      const totalUsers = allUsers?.length || 0
      
      // Active users (logged in within date range)
      const { data: recentEntries } = await supabase
        .from('time_entries')
        .select('user_id')
        .gte('start_time', startDate)
      
      const activeUserIds = new Set(recentEntries?.map(e => e.user_id) || [])
      const activeUsers = activeUserIds.size

      // Total hours
      const { data: timeEntries } = await supabase
        .from('time_entries')
        .select('duration, user_id, start_time')
        .gte('start_time', startDate)
      
      const totalHours = (timeEntries || []).reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600

      // Top users by hours
      const userHoursMap = new Map<string, number>()
      timeEntries?.forEach(entry => {
        const hours = (entry.duration || 0) / 3600
        userHoursMap.set(entry.user_id, (userHoursMap.get(entry.user_id) || 0) + hours)
      })
      
      const topUsers = Array.from(userHoursMap.entries())
        .map(([userId, hours]) => {
          const user = allUsers?.find(u => u.id === userId)
          return { name: user?.full_name || 'Unknown', hours: Math.round(hours * 10) / 10 }
        })
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 10)

      // Attendance rate
      const { data: attendanceData } = await supabase
        .from('time_entries')
        .select('user_id, start_time, duration')
        .gte('start_time', startDate)
      
      const userAttendanceMap = new Map<string, { days: Set<string>, hours: number }>()
      attendanceData?.forEach(entry => {
        const date = format(new Date(entry.start_time), 'yyyy-MM-dd')
        const existing = userAttendanceMap.get(entry.user_id) || { days: new Set(), hours: 0 }
        existing.days.add(date)
        existing.hours += (entry.duration || 0) / 3600
        userAttendanceMap.set(entry.user_id, existing)
      })
      
      const usersWithAttendance = Array.from(userAttendanceMap.values()).filter(u => u.hours >= 4).length
      const attendanceRate = totalUsers > 0 ? (usersWithAttendance / totalUsers) * 100 : 0

      // User activity chart data (last 7 days)
      const last7Days = eachDayOfInterval({ start: subDays(new Date(), 6), end: new Date() })
      const activityData = last7Days.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd')
        const dayEntries = attendanceData?.filter(e => format(new Date(e.start_time), 'yyyy-MM-dd') === dayStr) || []
        return new Set(dayEntries.map(e => e.user_id)).size
      })

      // Role distribution
      const roleCounts: Record<string, number> = {}
      allUsers?.forEach(u => {
        roleCounts[u.role] = (roleCounts[u.role] || 0) + 1
      })

      // Project hours distribution
      const { data: projectTimeEntries } = await supabase
        .from('project_time_entries')
        .select('project_id, time_entry_id, time_entries!inner(start_time, duration)')
        .gte('time_entries.start_time', startDate)
      
      const { data: projects } = await supabase.from('projects').select('id, name')
      
      const projectHoursMap = new Map<string, number>()
      projectTimeEntries?.forEach(pte => {
        const duration = (pte.time_entries as any)?.duration || 0
        const hours = duration / 3600
        projectHoursMap.set(pte.project_id, (projectHoursMap.get(pte.project_id) || 0) + hours)
      })
      
      const projectLabels = projects?.map(p => p.name) || []
      const projectHours = projects?.map(p => Math.round((projectHoursMap.get(p.id) || 0) * 10) / 10) || []

      // Productivity trend (hours per day for last 7 days)
      const productivityData = last7Days.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd')
        const dayEntries = timeEntries?.filter(e => {
          const entryDate = e.start_time ? format(new Date(e.start_time), 'yyyy-MM-dd') : ''
          return entryDate === dayStr
        }) || []
        return dayEntries.reduce((sum, entry) => sum + (entry.duration || 0), 0) / 3600
      })

      setAnalyticsData({
        totalUsers,
        activeUsers,
        totalHours: Math.round(totalHours * 10) / 10,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        userActivityData: {
          labels: last7Days.map(d => format(d, 'MMM d')),
          datasets: [{
            label: 'Active Users',
            data: activityData,
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
          }],
        },
        attendanceData: {
          labels: ['Present (4+ hrs)', 'Absent (<4 hrs)'],
          datasets: [{
            data: [usersWithAttendance, totalUsers - usersWithAttendance],
            backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)'],
          }],
        },
        roleDistribution: {
          labels: Object.keys(roleCounts),
          datasets: [{
            data: Object.values(roleCounts),
            backgroundColor: [
              'rgba(59, 130, 246, 0.8)',
              'rgba(99, 102, 241, 0.8)',
              'rgba(139, 92, 246, 0.8)',
              'rgba(168, 85, 247, 0.8)',
              'rgba(236, 72, 153, 0.8)',
            ],
          }],
        },
        projectHoursData: projectLabels.length > 0 ? {
          labels: projectLabels,
          datasets: [{
            label: 'Hours',
            data: projectHours,
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
          }],
        } : null,
        productivityData: {
          labels: last7Days.map(d => format(d, 'MMM d')),
          datasets: [{
            label: 'Hours Tracked',
            data: productivityData,
            borderColor: 'rgb(34, 197, 94)',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            tension: 0.4,
          }],
        },
        topUsers,
      })
    } catch (error: any) {
      console.error('Error fetching analytics:', error)
      showError(error.message || 'Failed to fetch analytics')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const filteredUsers = users.filter((u) => {
    // Search filter
    const matchesSearch =
      searchTerm === '' ||
      u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.team?.toLowerCase().includes(searchTerm.toLowerCase())

    // Role filter
    const matchesRole = roleFilter === 'all' || u.role === roleFilter

    // Team filter
    const matchesTeam =
      teamFilter === 'all' ||
      (teamFilter === 'none' && (!u.team || u.team === '')) ||
      u.team === teamFilter

    // Manager filter
    const matchesManager =
      managerFilter === 'all' ||
      (managerFilter === 'none' && (!u.manager_id || u.manager_id === '')) ||
      u.manager_id === managerFilter

    return matchesSearch && matchesRole && matchesTeam && matchesManager
  })

  const tabs = [
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'settings', label: 'System Settings', icon: Settings },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ]

  return (
    <div className="space-y-6">


      {/* Tabs */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 backdrop-blur-sm">
        <div className="flex items-center space-x-1 border-b border-gray-200 dark:border-gray-700 p-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">User Management</h2>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                >
                  <UserPlus className="w-5 h-5" />
                  <span>Add User</span>
                </button>
              </div>

              {/* Search */}
              <div className="mb-6 space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search users by name, email, or team..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  />
                </div>

                {/* Filter Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Role Filter */}
                  <div>
                    <label htmlFor="role-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Filter by Role
                    </label>
                    <select
                      id="role-filter"
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="all">All Roles</option>
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="hr">HR</option>
                      <option value="accountant">Accountant</option>
                      <option value="employee">Employee</option>
                    </select>
                  </div>

                  {/* Team Filter */}
                  <div>
                    <label htmlFor="team-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Filter by Team/Department
                    </label>
                    <select
                      id="team-filter"
                      value={teamFilter}
                      onChange={(e) => setTeamFilter(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="all">All Teams</option>
                      <option value="none">No Team</option>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Manager Filter */}
                  <div>
                    <label htmlFor="manager-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Filter by Manager
                    </label>
                    <select
                      id="manager-filter"
                      value={managerFilter}
                      onChange={(e) => setManagerFilter(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="all">All Managers</option>
                      <option value="none">No Manager</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Clear Filters Button */}
                {(roleFilter !== 'all' || teamFilter !== 'all' || managerFilter !== 'all' || searchTerm !== '') && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setSearchTerm('')
                        setRoleFilter('all')
                        setTeamFilter('all')
                        setManagerFilter('all')
                      }}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                    >
                      Clear All Filters
                    </button>
                  </div>
                )}

                {/* Results Count */}
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Showing {filteredUsers.length} of {users.length} users
                </div>
              </div>

              {/* Users Table */}
              {loading ? (
                <div className="py-12">
                  <Loader size="md" text="Loading users" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Email
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Team
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Manager
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Capture Settings
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                            <Users className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                            <p>No users found</p>
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => (
                          <tr key={u.id} className="hover:bg-gray-50 dark:bg-gray-700/50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold mr-3">
                                  {u.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="text-sm font-medium text-gray-900 dark:text-white">{u.full_name}</div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-600 dark:text-gray-400">{u.email || '—'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  u.role === 'admin'
                                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400'
                                    : u.role === 'manager' || u.role === 'hr'
                                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-600 dark:text-gray-400">{u.team || '—'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {users.find((m) => m.id === u.manager_id)?.full_name || '—'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center space-x-4">
                                {/* Screenshot Capture Toggle */}
                                <div className="flex items-center space-x-2">
                                  <Monitor className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={u.enable_screenshot_capture ?? true}
                                      onChange={() => handleToggleCaptureSetting(u.id, 'screenshot', u.enable_screenshot_capture ?? true)}
                                      className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                                    <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                                      {u.enable_screenshot_capture ?? true ? 'On' : 'Off'}
                                    </span>
                                  </label>
                                </div>
                                {/* Camera Capture Toggle */}
                                <div className="flex items-center space-x-2">
                                  <Camera className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={u.enable_camera_capture ?? true}
                                      onChange={() => handleToggleCaptureSetting(u.id, 'camera', u.enable_camera_capture ?? true)}
                                      className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                                    <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                                      {u.enable_camera_capture ?? true ? 'On' : 'Off'}
                                    </span>
                                  </label>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end space-x-2">
                                <button
                                  onClick={() => handleEditUser(u)}
                                  className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center space-x-1"
                                  title="Edit User"
                                >
                                  <Edit className="w-4 h-4" />
                                  <span>Edit</span>
                                </button>
                                {u.id !== user.id && (
                                  <button
                                    onClick={() => handleDeleteUser(u.id)}
                                    className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 flex items-center space-x-1"
                                    title="Delete User"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">System Settings</h2>
              
              {settingsLoading ? (
                <div className="py-12">
                  <Loader size="md" text="Loading settings" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* General Settings */}
                  <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center space-x-2 mb-4">
                      <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">General Settings</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Timezone
                        </label>
                        <input
                          type="text"
                          value={systemSettings.timezone || 'Asia/Kolkata'}
                          onChange={(e) => setSystemSettings({ ...systemSettings, timezone: e.target.value })}
                          onBlur={() => saveSystemSetting('timezone', systemSettings.timezone || 'Asia/Kolkata')}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="Asia/Kolkata"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Working Days Per Week
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="7"
                            value={systemSettings.working_days_per_week || '5'}
                            onChange={(e) => setSystemSettings({ ...systemSettings, working_days_per_week: e.target.value })}
                            onBlur={() => saveSystemSetting('working_days_per_week', systemSettings.working_days_per_week || '5')}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Default Working Hours Start
                          </label>
                          <input
                            type="time"
                            value={systemSettings.default_working_hours_start || '09:00'}
                            onChange={(e) => setSystemSettings({ ...systemSettings, default_working_hours_start: e.target.value })}
                            onBlur={() => saveSystemSetting('default_working_hours_start', systemSettings.default_working_hours_start || '09:00')}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Default Working Hours End
                        </label>
                        <input
                          type="time"
                          value={systemSettings.default_working_hours_end || '18:00'}
                          onChange={(e) => setSystemSettings({ ...systemSettings, default_working_hours_end: e.target.value })}
                          onBlur={() => saveSystemSetting('default_working_hours_end', systemSettings.default_working_hours_end || '18:00')}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Time Tracking Settings */}
                  <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center space-x-2 mb-4">
                      <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Time Tracking Settings</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Tracker Reset Hour (24-hour format)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={systemSettings.tracker_reset_hour || '6'}
                          onChange={(e) => setSystemSettings({ ...systemSettings, tracker_reset_hour: e.target.value })}
                          onBlur={() => saveSystemSetting('tracker_reset_hour', systemSettings.tracker_reset_hour || '6')}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="6"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The hour at which the daily tracker resets (0-23)</p>
                      </div>
                    </div>
                  </div>

                  {/* Attendance Settings */}
                  <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center space-x-2 mb-4">
                      <Calendar className="w-5 h-5 text-white dark:text-white" />
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Attendance Settings</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Present Hours Threshold
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={systemSettings.present_hours_threshold || '8'}
                            onChange={(e) => setSystemSettings({ ...systemSettings, present_hours_threshold: e.target.value })}
                            onBlur={() => saveSystemSetting('present_hours_threshold', systemSettings.present_hours_threshold || '8')}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum hours for "Present" status</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Half Day Hours Threshold
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={systemSettings.half_day_hours_threshold || '4'}
                            onChange={(e) => setSystemSettings({ ...systemSettings, half_day_hours_threshold: e.target.value })}
                            onBlur={() => saveSystemSetting('half_day_hours_threshold', systemSettings.half_day_hours_threshold || '4')}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum hours for "Half Day" status</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notification Settings */}
                  <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center space-x-2 mb-4">
                      <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Notification Settings</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800">
                          <strong>Note:</strong> Notification settings are managed through the Supabase dashboard. 
                          Configure email templates and SMTP settings in your Supabase project settings.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Email Notifications</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Send email notifications for important events</p>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Configure in Supabase</div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Password Reset Emails</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Send password reset links via email</p>
                          </div>
                          <div className="text-sm text-green-600 dark:text-green-400 font-medium">Enabled</div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Attendance Alerts</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Notify managers about attendance issues</p>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Coming Soon</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notification Settings */}
                  <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center space-x-2 mb-4">
                      <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Notification Settings</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800">
                          <strong>Note:</strong> Notification settings are managed through the Supabase dashboard. 
                          Configure email templates and SMTP settings in your Supabase project settings.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Email Notifications</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Send email notifications for important events</p>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Configure in Supabase</div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Password Reset Emails</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Send password reset links via email</p>
                          </div>
                          <div className="text-sm text-green-600 dark:text-green-400 font-medium">Enabled</div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">Attendance Alerts</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Notify managers about attendance issues</p>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">Coming Soon</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Permissions</h2>
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Shield className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p>Permission management interface coming soon</p>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Analytics Dashboard</h2>
                <div className="flex items-center space-x-3">
                  <select
                    value={analyticsDateRange}
                    onChange={(e) => {
                      setAnalyticsDateRange(e.target.value)
                      fetchAnalytics()
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="90d">Last 90 Days</option>
                    <option value="all">All Time</option>
                  </select>
                  <button
                    onClick={() => fetchAnalytics()}
                    className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export</span>
                  </button>
                </div>
              </div>
              
              {analyticsLoading ? (
                <div className="py-12">
                  <Loader size="md" text="Loading analytics" />
                </div>
              ) : (
                <>
                  {/* Key Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Total Users</p>
                          <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{analyticsData.totalUsers}</p>
                        </div>
                        <Users className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Active Users</p>
                          <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{analyticsData.activeUsers}</p>
                        </div>
                        <Activity className="w-8 h-8 text-green-600 dark:text-green-400" />
                      </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Total Hours</p>
                          <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{analyticsData.totalHours}</p>
                        </div>
                        <Clock className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Attendance Rate</p>
                          <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{analyticsData.attendanceRate}%</p>
                        </div>
                        <Calendar className="w-8 h-8 text-white dark:text-white" />
                      </div>
                    </div>
                  </div>

                  {/* Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* User Activity Chart */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">User Activity (Last 7 Days)</h3>
                      {analyticsData.userActivityData && (
                        <div className="h-64">
                          <Line
                            data={analyticsData.userActivityData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                              },
                              scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                              },
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Productivity Trend */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Productivity Trend (Last 7 Days)</h3>
                      {analyticsData.productivityData && (
                        <div className="h-64">
                          <Line
                            data={analyticsData.productivityData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                              },
                              scales: {
                                y: { beginAtZero: true },
                              },
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Role Distribution */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Role Distribution</h3>
                      {analyticsData.roleDistribution && (
                        <div className="h-64">
                          <Pie
                            data={analyticsData.roleDistribution}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { position: 'bottom' },
                              },
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Project Hours */}
                    {analyticsData.projectHoursData && (
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Project Hours Distribution</h3>
                        <div className="h-64">
                          <Bar
                            data={analyticsData.projectHoursData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                              },
                              scales: {
                                y: { beginAtZero: true },
                              },
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Attendance Overview */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 lg:col-span-2">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Attendance Overview</h3>
                      {analyticsData.attendanceData && (
                        <div className="h-64">
                          <Bar
                            data={analyticsData.attendanceData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                              },
                              scales: {
                                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                              },
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Users */}
                  {analyticsData.topUsers && analyticsData.topUsers.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center space-x-2 mb-4">
                        <TrendingUp className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Top Users by Hours</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                                Rank
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                                User Name
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                                Total Hours
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {analyticsData.topUsers.map((topUser, index) => (
                              <tr key={index} className="hover:bg-gray-50 dark:bg-gray-700/50 dark:hover:bg-gray-700">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                                  #{index + 1}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                  {topUser.name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 text-right">
                                  {topUser.hours} hrs
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Add New User</h2>
                <button
                  onClick={() => {
                    setShowAddUserModal(false)
                    setNewUserForm({
                      email: '',
                      password: '',
                      full_name: '',
                      role: 'employee',
                      team: '',
                      manager_id: '',
                    })
                    setShowNewTeamInput(false)
                    setNewTeamName('')
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    id="password"
                    required
                    minLength={6}
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    placeholder="Minimum 6 characters"
                  />
                </div>

                <div>
                  <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    id="full_name"
                    required
                    value={newUserForm.full_name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, full_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    placeholder="John Doe"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Role *
                    </label>
                    <select
                      id="role"
                      required
                      value={newUserForm.role}
                      onChange={(e) =>
                        setNewUserForm({
                          ...newUserForm,
                          role: e.target.value as 'employee' | 'manager' | 'admin' | 'hr' | 'accountant',
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="hr">HR</option>
                      <option value="admin">Admin</option>
                      <option value="accountant">Accountant</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="team" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Team/Department
                    </label>
                    <select
                      id="team"
                      value={showNewTeamInput ? 'other' : newUserForm.team || ''}
                      onChange={(e) => {
                        if (e.target.value === 'other') {
                          setShowNewTeamInput(true)
                          setNewUserForm({ ...newUserForm, team: '' })
                        } else {
                          setShowNewTeamInput(false)
                          setNewTeamName('')
                          setNewUserForm({ ...newUserForm, team: e.target.value })
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Select Team/Department (Optional)</option>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                      {(user.role === 'admin' || user.role === 'hr') && (
                        <option value="other">+ Add New Department</option>
                      )}
                    </select>
                    {showNewTeamInput && (user.role === 'admin' || user.role === 'hr') && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={newTeamName}
                          onChange={(e) => {
                            setNewTeamName(e.target.value)
                            setNewUserForm({ ...newUserForm, team: e.target.value })
                          }}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="Enter new department name"
                          autoFocus
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          This will create a new department and make it available for all users.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="manager_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Manager
                  </label>
                  <select
                    id="manager_id"
                    value={newUserForm.manager_id}
                    onChange={(e) => setNewUserForm({ ...newUserForm, manager_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">Select Manager (Optional)</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddUserModal(false)
                      setNewUserForm({
                        email: '',
                        password: '',
                        full_name: '',
                        role: 'employee',
                        team: '',
                        manager_id: '',
                      })
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:bg-gray-700/50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                  >
                    Create User
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Edit User</h2>
                <button
                  onClick={() => {
                    setShowEditUserModal(false)
                    setSelectedUser(null)
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div>
                  <label htmlFor="edit-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    id="edit-email"
                    required
                    value={editUserForm.email}
                    onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="edit-full_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    id="edit-full_name"
                    required
                    value={editUserForm.full_name}
                    onChange={(e) => setEditUserForm({ ...editUserForm, full_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                    placeholder="John Doe"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Role *
                    </label>
                    <select
                      id="edit-role"
                      required
                      value={editUserForm.role}
                      onChange={(e) =>
                        setEditUserForm({
                          ...editUserForm,
                          role: e.target.value as 'employee' | 'manager' | 'admin' | 'hr' | 'accountant',
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="hr">HR</option>
                      <option value="admin">Admin</option>
                      <option value="accountant">Accountant</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="edit-team" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Team/Department
                    </label>
                    <select
                      id="edit-team"
                      value={showNewTeamInput ? 'other' : editUserForm.team || ''}
                      onChange={(e) => {
                        if (e.target.value === 'other') {
                          setShowNewTeamInput(true)
                          setEditUserForm({ ...editUserForm, team: '' })
                        } else {
                          setShowNewTeamInput(false)
                          setNewTeamName('')
                          setEditUserForm({ ...editUserForm, team: e.target.value })
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Select Team/Department (Optional)</option>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                      {(user.role === 'admin' || user.role === 'hr') && (
                        <option value="other">+ Add New Department</option>
                      )}
                    </select>
                    {showNewTeamInput && (user.role === 'admin' || user.role === 'hr') && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={newTeamName}
                          onChange={(e) => {
                            setNewTeamName(e.target.value)
                            setEditUserForm({ ...editUserForm, team: e.target.value })
                          }}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="Enter new department name"
                          autoFocus
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          This will create a new department and make it available for all users.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="edit-manager_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Manager
                  </label>
                  <select
                    id="edit-manager_id"
                    value={editUserForm.manager_id}
                    onChange={(e) => setEditUserForm({ ...editUserForm, manager_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">Select Manager (Optional)</option>
                    {managers
                      .filter((m) => m.id !== selectedUser.id)
                      .map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.full_name}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Password Management Section */}
                <div className="pt-4 border-t border-gray-200">
                  <div className="mb-3">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password Management</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Enter a new password to change the user's password. Leave empty to keep the current password.
                    </p>
                    <div>
                      <label htmlFor="edit-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        New Password
                      </label>
                      <input
                        type="password"
                        id="edit-password"
                        value={editUserForm.password}
                        onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        placeholder="Leave empty to keep current password"
                        minLength={6}
                      />
                      {editUserForm.password && editUserForm.password.length > 0 && editUserForm.password.length < 6 && (
                        <p className="text-xs text-red-500 mt-1">Password must be at least 6 characters</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditUserModal(false)
                      setSelectedUser(null)
                      setShowNewTeamInput(false)
                      setNewTeamName('')
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:bg-gray-700/50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all">
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
