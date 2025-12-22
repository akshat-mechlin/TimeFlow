import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Search, Filter, User, Clock, FileText, Users, Plus, Edit, Trash2, X, Check } from 'lucide-react'
import { startOfDay, endOfDay } from 'date-fns'
import Loader from '../components/Loader'
import { useToast } from '../contexts/ToastContext'
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

interface Group {
  id: string
  name: string
  created_by: string
  manager_id: string | null
  created_at: string
  members?: Array<{ user_id: string; profile?: Profile }>
}

export default function TeamMembers({ user }: TeamMembersProps) {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const [members, setMembers] = useState<TeamMemberWithStats[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<Group[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [groupName, setGroupName] = useState('')
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([])
  const [groupSearchTerm, setGroupSearchTerm] = useState('')

  useEffect(() => {
    fetchTeamMembers()
    fetchGroups()
    
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

  const fetchGroups = async () => {
    try {
      // Only managers, HR, and admins can see groups
      if (user.role === 'employee') {
        setGroups([])
        return
      }

      let query = supabase
        .from('groups')
        .select(`
          *,
          group_members(
            user_id,
            profile:profiles(*)
          )
        `)
        .order('created_at', { ascending: false })

      // Managers can only see groups they created or groups for their team
      if (user.role === 'manager' || user.role === 'hr') {
        query = query.or(`manager_id.eq.${user.id},created_by.eq.${user.id}`)
      }
      // Admins can see all groups

      const { data, error } = await query

      if (error) {
        // If groups table doesn't exist, silently fail (table will be created)
        console.log('Groups table may not exist yet:', error)
        setGroups([])
        return
      }

      setGroups((data || []) as Group[])
    } catch (error) {
      console.error('Error fetching groups:', error)
      setGroups([])
    }
  }

  const canCreateGroups = () => {
    // Only managers, HR, and admins can create groups
    return user.role === 'manager' || user.role === 'hr' || user.role === 'admin'
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      showError('Please enter a group name')
      return
    }

    if (selectedGroupMembers.length === 0) {
      showError('Please select at least one team member')
      return
    }

    try {
      // Create the group
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: groupName.trim(),
          created_by: user.id,
          manager_id: user.role === 'manager' || user.role === 'hr' ? user.id : null,
        })
        .select()
        .single()

      if (groupError) {
        // If groups table doesn't exist, show helpful error
        if (groupError.code === '42P01') {
          showError('Groups table does not exist. Please create the groups and group_members tables in your database.')
        } else {
          throw groupError
        }
        return
      }

      // Add members to the group
      const groupMembers = selectedGroupMembers.map(userId => ({
        group_id: group.id,
        user_id: userId,
      }))

      const { error: membersError } = await supabase
        .from('group_members')
        .insert(groupMembers)

      if (membersError) {
        // If group_members table doesn't exist, show helpful error
        if (membersError.code === '42P01') {
          showError('Group members table does not exist. Please create the group_members table in your database.')
        } else {
          throw membersError
        }
        return
      }

      showSuccess('Group created successfully!')
      setShowGroupModal(false)
      setGroupName('')
      setSelectedGroupMembers([])
      fetchGroups()
    } catch (error: any) {
      console.error('Error creating group:', error)
      showError(error.message || 'Failed to create group')
    }
  }

  const handleUpdateGroup = async () => {
    if (!editingGroup || !groupName.trim()) {
      showError('Please enter a group name')
      return
    }

    try {
      // Update group name
      const { error: updateError } = await supabase
        .from('groups')
        .update({ name: groupName.trim() })
        .eq('id', editingGroup.id)

      if (updateError) throw updateError

      // Delete existing members
      await supabase
        .from('group_members')
        .delete()
        .eq('group_id', editingGroup.id)

      // Add new members
      if (selectedGroupMembers.length > 0) {
        const groupMembers = selectedGroupMembers.map(userId => ({
          group_id: editingGroup.id,
          user_id: userId,
        }))

        const { error: membersError } = await supabase
          .from('group_members')
          .insert(groupMembers)

        if (membersError) throw membersError
      }

      showSuccess('Group updated successfully!')
      setShowGroupModal(false)
      setEditingGroup(null)
      setGroupName('')
      setSelectedGroupMembers([])
      fetchGroups()
    } catch (error: any) {
      console.error('Error updating group:', error)
      showError(error.message || 'Failed to update group')
    }
  }

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`)) {
      return
    }

    try {
      // Delete group members first
      await supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)

      // Delete the group
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId)

      if (error) throw error

      showSuccess('Group deleted successfully!')
      fetchGroups()
    } catch (error: any) {
      console.error('Error deleting group:', error)
      showError(error.message || 'Failed to delete group')
    }
  }

  const openCreateGroupModal = () => {
    setEditingGroup(null)
    setGroupName('')
    setSelectedGroupMembers([])
    setGroupSearchTerm('')
    setShowGroupModal(true)
  }

  const openEditGroupModal = (group: Group) => {
    setEditingGroup(group)
    setGroupName(group.name)
    setSelectedGroupMembers(group.members?.map(m => m.user_id) || [])
    setGroupSearchTerm('')
    setShowGroupModal(true)
  }

  const fetchTeamMembers = async () => {
    try {
      setLoading(true)
      let query = supabase.from('profiles').select('*')

      // Apply role-based filtering
      if (user.role === 'employee') {
        // Employees can only see themselves
        query = query.eq('id', user.id)
      } else if (user.role === 'manager' || user.role === 'hr') {
        // Managers can see their team members - get all users who have this manager assigned
        const { data: teamMembers } = await supabase
          .from('profiles')
          .select('id')
          .eq('manager_id', user.id)

        const teamUserIds = [user.id, ...(teamMembers?.map((m) => m.id) || [])]
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

  // Get available team members for group creation (only team members under this manager)
  const getAvailableMembersForGroups = () => {
    if (user.role === 'employee') return []
    if (user.role === 'admin') return members
    // For managers/HR, only show their team members
    return members.filter(m => m.manager_id === user.id || m.id === user.id)
  }

  const availableMembersForGroups = getAvailableMembersForGroups()

  return (
    <div className="space-y-6">
      {/* Groups Section */}
      {canCreateGroups() && (
        <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Team Groups</h2>
            </div>
            <button
              onClick={openCreateGroupModal}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Create Group</span>
            </button>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center py-4">
              No groups created yet. Create a group to quickly assign multiple team members to projects.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-white">{group.name}</h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => openEditGroupModal(group)}
                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded"
                        title="Edit group"
                      >
                        <Edit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(group.id, group.name)}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-800 rounded"
                        title="Delete group"
                      >
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {group.members?.length || 0} {group.members?.length === 1 ? 'member' : 'members'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {group.members?.slice(0, 3).map((member) => (
                        <span
                          key={member.user_id}
                          className="px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-xs text-gray-700 dark:text-gray-300 rounded"
                        >
                          {member.profile?.full_name || 'Unknown'}
                        </span>
                      ))}
                      {group.members && group.members.length > 3 && (
                        <span className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                          +{group.members.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* Create/Edit Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                {editingGroup ? 'Edit Group' : 'Create Group'}
              </h2>
              <button
                onClick={() => {
                  setShowGroupModal(false)
                  setEditingGroup(null)
                  setGroupName('')
                  setSelectedGroupMembers([])
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Group Name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g., Group A, Development Team"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Team Members
                </label>
                <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 max-h-60 overflow-y-auto">
                  <div className="relative mb-3">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search members..."
                      value={groupSearchTerm}
                      onChange={(e) => setGroupSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="space-y-2">
                    {availableMembersForGroups
                      .filter(member =>
                        member.full_name?.toLowerCase().includes(groupSearchTerm.toLowerCase()) ||
                        member.email?.toLowerCase().includes(groupSearchTerm.toLowerCase())
                      )
                      .map((member) => (
                        <label
                          key={member.id}
                          className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedGroupMembers.includes(member.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedGroupMembers([...selectedGroupMembers, member.id])
                              } else {
                                setSelectedGroupMembers(selectedGroupMembers.filter(id => id !== member.id))
                              }
                            }}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{member.full_name}</span>
                          <span className="text-xs text-gray-500">({member.role})</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    setShowGroupModal(false)
                    setEditingGroup(null)
                    setGroupName('')
                    setSelectedGroupMembers([])
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={editingGroup ? handleUpdateGroup : handleCreateGroup}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                >
                  {editingGroup ? 'Update Group' : 'Create Group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
