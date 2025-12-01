import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Search, Filter, User, Clock, FileText } from 'lucide-react'
import { startOfDay, endOfDay } from 'date-fns'
import Loader from '../components/Loader'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type TimeEntry = Tables<'time_entries'>

interface TeamMembersProps {
  user: Profile
}

interface TeamMemberWithStats extends Profile {
  hoursWorkedToday: number
  projectsAssigned: number
}

export default function TeamMembers({ user }: TeamMembersProps) {
  const navigate = useNavigate()
  const [members, setMembers] = useState<TeamMemberWithStats[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTeamMembers()
    
    // Set up real-time subscription for profiles
    const channel = supabase
      .channel('team-members-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          // Refetch team members when profiles change
          fetchTeamMembers()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to team members real-time updates')
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const fetchTeamMembers = async () => {
    try {
      setLoading(true)
      let query = supabase.from('profiles').select('*')

      // Apply role-based filtering
      if (user.role === 'employee') {
        // Employees can only see themselves
        query = query.eq('id', user.id)
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Managers can see their team members
        const { data: managed } = await supabase
          .from('employee_managers')
          .select('employee_id')
          .eq('manager_id', user.id)

        const teamUserIds = [user.id, ...(managed?.map((m) => m.employee_id) || [])]
        query = query.in('id', teamUserIds)
      }
      // Admins can see all (no filter)

      const { data: profiles, error } = await query.order('full_name', { ascending: true })

      if (error) throw error

      // Fetch stats for each member
      const membersWithStats = await Promise.all(
        (profiles || []).map(async (profile) => {
          const todayStart = startOfDay(new Date()).toISOString()
          const todayEnd = endOfDay(new Date()).toISOString()

          // Get today's hours
          const { data: todayEntries } = await supabase
            .from('time_entries')
            .select('duration')
            .eq('user_id', profile.id)
            .gte('start_time', todayStart)
            .lte('start_time', todayEnd)

          const hoursWorkedToday =
            (todayEntries?.reduce((sum, entry) => sum + (entry.duration || 0), 0) || 0) / 3600

          // Get project count
          const { count: projectCount } = await supabase
            .from('project_members')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', profile.id)

          return {
            ...profile,
            hoursWorkedToday,
            projectsAssigned: projectCount || 0,
          }
        })
      )

      setMembers(membersWithStats)
    } catch (error) {
      console.error('Error fetching team members:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.role.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesRole = roleFilter === 'all' || member.role === roleFilter
    const matchesDepartment =
      departmentFilter === 'all' || member.team === departmentFilter

    return matchesSearch && matchesRole && matchesDepartment
  })

  const uniqueRoles = Array.from(new Set(members.map((m) => m.role)))
  const uniqueDepartments = Array.from(
    new Set(members.map((m) => m.team).filter(Boolean))
  )

  return (
    <div className="space-y-6">

      {/* Search and Filters */}
      <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
        <div className="flex items-center space-x-4 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
          <div className="flex items-center space-x-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="all">Role: All</option>
              {uniqueRoles.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="all">Department: All</option>
              {uniqueDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Team Members Grid */}
      {loading ? (
        <div className="py-12">
          <Loader size="lg" text="Loading team members" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredMembers.map((member) => (
            <div
              key={member.id}
              className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow backdrop-blur-sm"
            >
              {/* Profile Header */}
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-full flex items-center justify-center text-white font-semibold text-lg shadow-lg">
                  {member.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 dark:text-white">{member.full_name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 capitalize">{member.role}</p>
                </div>
              </div>


              {/* Metrics */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <Clock className="w-4 h-4" />
                    <span>Hours Worked Today</span>
                  </div>
                  <span className="font-semibold text-gray-800 dark:text-white">
                    {member.hoursWorkedToday.toFixed(1)}h
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                    <FileText className="w-4 h-4" />
                    <span>Projects Assigned</span>
                  </div>
                  <span className="font-semibold text-gray-800 dark:text-white">{member.projectsAssigned}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button 
                  onClick={() => navigate(`/profile?userId=${member.id}`)}
                  className="w-full flex items-center justify-center space-x-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
                >
                  <User className="w-4 h-4" />
                  <span>Profile</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
