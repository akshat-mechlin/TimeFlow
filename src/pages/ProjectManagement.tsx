import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Filter, Plus, Edit, Eye, Clock, Users, X, Check, UserPlus, ArrowLeft, Trash2 } from 'lucide-react'
import Loader from '../components/Loader'
import { useToast } from '../contexts/ToastContext'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>
type Project = Tables<'projects'>

interface ProjectManagementProps {
  user: Profile
}

interface ProjectWithDetails extends Project {
  task?: { id: string; name: string; category: string }
  members?: Array<{ profile: Profile; id: string }>
  hours_spent?: number
  created_by_profile?: Profile
  project_manager_profiles?: Profile[]
  member_hours?: Array<{ user_id: string; user_name: string; hours: number }>
}

export default function ProjectManagement({ user }: ProjectManagementProps) {
  const [projects, setProjects] = useState<ProjectWithDetails[]>([])
  const { showSuccess, showError } = useToast()
  const [allUsers, setAllUsers] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<Array<{ id: string; name: string; category: string }>>([])
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'completed'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ProjectWithDetails | null>(null)
  const [editingProject, setEditingProject] = useState<ProjectWithDetails | null>(null)
  const [showNewTaskInput, setShowNewTaskInput] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskName, setEditingTaskName] = useState('')
  const [showTaskDropdown, setShowTaskDropdown] = useState(false)
  const taskDropdownRef = useRef<HTMLDivElement>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'pending' as const,
    task_id: '',
    selectedProjectManagers: [] as string[],
    selectedMembers: [] as string[],
  })
  const [memberSearchTerm, setMemberSearchTerm] = useState('')
  const [managerSearchTerm, setManagerSearchTerm] = useState('')
  const [showManagerDropdown, setShowManagerDropdown] = useState(false)
  const managerDropdownRef = useRef<HTMLDivElement>(null)
  const [groups, setGroups] = useState<Array<{ id: string; name: string; members?: Array<{ user_id: string }> }>>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [showGroupDropdown, setShowGroupDropdown] = useState(false)
  const groupDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchProjects()
    fetchTasks()
    fetchAllUsers()
    fetchGroups()
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
          group_members(user_id)
        `)
        .order('name', { ascending: true })

      // Managers can only see groups they created or groups for their team
      if (user.role === 'manager' || user.role === 'hr') {
        query = query.or(`manager_id.eq.${user.id},created_by.eq.${user.id}`)
      }
      // Admins can see all groups

      const { data, error } = await query

      if (error) {
        // If groups table doesn't exist, silently fail
        console.log('Groups table may not exist yet:', error)
        setGroups([])
        return
      }

      setGroups((data || []) as Array<{ id: string; name: string; members?: Array<{ user_id: string }> }>)
    } catch (error) {
      console.error('Error fetching groups:', error)
      setGroups([])
    }
  }

  useEffect(() => {
    // Close manager dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setShowManagerDropdown(false)
        setManagerSearchTerm('')
      }
      if (taskDropdownRef.current && !taskDropdownRef.current.contains(event.target as Node)) {
        setShowTaskDropdown(false)
      }
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(event.target as Node)) {
        setShowGroupDropdown(false)
      }
    }

    if (showManagerDropdown || showTaskDropdown || showGroupDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showManagerDropdown, showTaskDropdown, showGroupDropdown])

  // When groups are selected, auto-select all members of those groups
  useEffect(() => {
    if (selectedGroups.length > 0) {
      const groupMemberIds = new Set<string>()
      selectedGroups.forEach(groupId => {
        const group = groups.find(g => g.id === groupId)
        if (group?.members) {
          group.members.forEach(member => {
            groupMemberIds.add(member.user_id)
          })
        }
      })
      
      // Add group members to selected members (merge, don't replace)
      const newMemberIds = [...new Set([...formData.selectedMembers, ...Array.from(groupMemberIds)])]
      setFormData({ ...formData, selectedMembers: newMemberIds })
    }
  }, [selectedGroups])
  
  useEffect(() => {
    // Set up real-time subscriptions for projects and project members
    const projectsChannel = supabase
      .channel('projects-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
        },
        () => {
          fetchProjects()
        }
      )
      .subscribe()

    const projectMembersChannel = supabase
      .channel('project-members-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_members',
        },
        () => {
          fetchProjects()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(projectsChannel)
      supabase.removeChannel(projectMembersChannel)
    }
  }, [])

  const fetchAllUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name')
      if (error) throw error
      setAllUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchProjects = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('projects')
        .select(`
          *,
          task:tasks(*),
          created_by_profile:profiles!projects_created_by_fkey(*),
          project_members(
            id,
            profile:profiles(*)
          )
        `)
        .order('created_at', { ascending: false })

      // Fetch all projects first
      const { data: allData, error } = await query
      if (error) throw error

      // Role-based filtering
      let filteredData = allData || []
      
      if (user.role === 'employee') {
        // Employees see only projects they're assigned to
        const { data: memberProjects } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('user_id', user.id)
        
        const projectIds = new Set(memberProjects?.map(p => p.project_id) || [])
        filteredData = filteredData.filter(p => projectIds.has(p.id))
      } else if (user.role === 'manager') {
        // Managers see projects they created, where they're project manager, or where they're assigned
        const { data: memberProjects } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('user_id', user.id)
        
        const projectIds = new Set(memberProjects?.map(p => p.project_id) || [])
        filteredData = filteredData.filter(p => 
          p.created_by === user.id || 
          (p.project_managers && Array.isArray(p.project_managers) && p.project_managers.includes(user.id)) ||
          projectIds.has(p.id)
        )
      }
      // Admin sees all projects (no filter)
      
      console.log('Filtered projects before processing:', filteredData.length)

      // Calculate hours spent for each project and per member
      const projectsWithHours = await Promise.all(
        filteredData.map(async (project) => {
          // Debug: Log project members structure
          console.log(`Project ${project.name} members:`, project.project_members)
          
          // Get all time entries for this project
          const { data: projectTimeEntries } = await supabase
            .from('project_time_entries')
            .select('time_entry_id, time_entries(user_id, duration)')
            .eq('project_id', project.id)

          // Check if this is a default project (by name) - if so, also include entries with null project_id
          // Common default project names: "default", "unassigned", "no project", "general", "misc"
          const projectNameLower = project.name.toLowerCase()
          const isDefaultProject = projectNameLower.includes('default') || 
                                  projectNameLower === 'unassigned' ||
                                  projectNameLower === 'no project' ||
                                  projectNameLower === 'general' ||
                                  projectNameLower === 'misc' ||
                                  projectNameLower === 'miscellaneous'
          
          let nullProjectEntries: any[] = []
          if (isDefaultProject) {
            // Also fetch entries with null project_id for default project
            const { data: nullEntries } = await supabase
              .from('project_time_entries')
              .select('time_entry_id, time_entries(user_id, duration)')
              .is('project_id', null)
            nullProjectEntries = nullEntries || []
          }

          // Combine both sets of entries
          const allProjectEntries = [...(projectTimeEntries || []), ...nullProjectEntries]

          const totalHoursSpent = allProjectEntries.reduce((sum, entry: any) => {
            return sum + (entry.time_entries?.duration || 0)
          }, 0) / 3600

          // Calculate hours per member
          const memberHoursMap = new Map<string, { name: string; hours: number }>()
          allProjectEntries.forEach((entry: any) => {
            const userId = entry.time_entries?.user_id
            const hours = (entry.time_entries?.duration || 0) / 3600
            if (userId) {
              const existing = memberHoursMap.get(userId) || { name: '', hours: 0 }
              existing.hours += hours
              const userProfile = allUsers.find(u => u.id === userId) || 
                                 (project.project_members as any)?.find((m: any) => m.profile?.id === userId)?.profile
              if (userProfile) {
                existing.name = userProfile.full_name
              }
              memberHoursMap.set(userId, existing)
            }
          })

          const memberHours = Array.from(memberHoursMap.entries()).map(([user_id, data]) => ({
            user_id,
            user_name: data.name,
            hours: Math.round(data.hours * 10) / 10,
          }))

          // Normalize members structure - Supabase returns it as project_members array
          const rawMembers = (project as any).project_members || project.members || []
          const members = rawMembers.map((m: any) => {
            // Handle different structures
            if (m.profile) {
              return {
                id: m.id,
                profile: m.profile,
              }
            } else if (m.id && m.full_name) {
              // If it's already a profile object
              return {
                id: m.id,
                profile: m,
              }
            }
            return null
          }).filter(Boolean)

          console.log(`Project ${project.name} - Raw members:`, rawMembers)
          console.log(`Project ${project.name} - Normalized members count:`, members.length)

          // Fetch project manager profiles
          const projectManagerIds = (project.project_managers || []) as string[]
          const projectManagerProfiles = projectManagerIds.length > 0
            ? allUsers.filter(u => projectManagerIds.includes(u.id))
            : []

          return {
            ...project,
            members: members,
            hours_spent: Math.round(totalHoursSpent * 10) / 10,
            member_hours: memberHours,
            project_manager_profiles: projectManagerProfiles,
          }
        })
      )

      console.log('Projects with hours:', projectsWithHours)
      setProjects(projectsWithHours)
    } catch (error) {
      console.error('Error fetching projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('category', { ascending: false }).order('name')
      if (error) throw error
      setTasks(data || [])
    } catch (error) {
      console.error('Error fetching tasks:', error)
    }
  }

  const handleCreateTask = async () => {
    if (!newTaskName.trim()) return

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({ name: newTaskName.trim(), category: 'custom' })
        .select()
        .single()

      if (error) throw error

      setTasks([...tasks, data])
      setFormData({ ...formData, task_id: data.id })
      setNewTaskName('')
      setShowNewTaskInput(false)
      showSuccess('Task created successfully!')
    } catch (error: any) {
        console.error('Error creating task:', error)
        showError(error.message || 'Failed to create task')
    }
  }

  const handleRenameTask = async (taskId: string, newName: string) => {
    if (!newName.trim()) {
      setEditingTaskId(null)
      setEditingTaskName('')
      return
    }

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ name: newName.trim() })
        .eq('id', taskId)

      if (error) throw error

      setTasks(tasks.map(task => task.id === taskId ? { ...task, name: newName.trim() } : task))
      setEditingTaskId(null)
      setEditingTaskName('')
      showSuccess('Task renamed successfully!')
    } catch (error: any) {
      console.error('Error renaming task:', error)
      showError(error.message || 'Failed to rename task')
    }
  }

  const handleDeleteTask = async (taskId: string, taskName: string) => {
    if (!confirm(`Are you sure you want to delete the task "${taskName}"? This action cannot be undone.`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId)

      if (error) throw error

      setTasks(tasks.filter(task => task.id !== taskId))
      // If the deleted task was selected in the form, clear it
      if (formData.task_id === taskId) {
        setFormData({ ...formData, task_id: '' })
      }
      showSuccess('Task deleted successfully!')
    } catch (error: any) {
      console.error('Error deleting task:', error)
      showError(error.message || 'Failed to delete task')
    }
  }

  const startEditingTask = (taskId: string, currentName: string) => {
    setEditingTaskId(taskId)
    setEditingTaskName(currentName)
  }

  const cancelEditingTask = () => {
    setEditingTaskId(null)
    setEditingTaskName('')
  }

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!showModal) {
      setFormData({
        name: '',
        description: '',
        status: 'pending',
        task_id: '',
        selectedProjectManagers: [],
        selectedMembers: [],
      })
      setSelectedGroups([])
      setEditingProject(null)
    } else if (editingProject) {
      // When editing, populate form with project data
      setFormData({
        name: editingProject.name,
        description: editingProject.description || '',
        status: editingProject.status as any,
        task_id: (editingProject as any).task_id || '',
        selectedProjectManagers: editingProject.project_managers || [],
        selectedMembers: (editingProject.members || []).map((m: any) => m.profile?.id || m.id).filter(Boolean),
      })
    }
  }, [showModal, editingProject])

  const handleSave = async () => {
    try {
      if (editingProject) {
        // Check if user can manage team members for this project
        if (!canManageTeamMembers(editingProject)) {
          showError('You do not have permission to manage team members for this project')
          return
        }

        // Update project
        const { error: projectError } = await supabase
          .from('projects')
          .update({
            name: formData.name,
            description: formData.description,
            status: formData.status,
            task_id: formData.task_id || null,
            project_managers: formData.selectedProjectManagers.length > 0 ? formData.selectedProjectManagers : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingProject.id)

        if (projectError) {
          console.error('Error updating project:', projectError)
          throw projectError
        }

        // Update project members
        const currentMemberIds = (editingProject.members || []).map(m => m.profile?.id).filter(Boolean) as string[]
        const newMemberIds = formData.selectedMembers.filter(Boolean)

        console.log('Current members:', currentMemberIds)
        console.log('New members:', newMemberIds)

        // Remove members that are no longer selected
        const toRemove = currentMemberIds.filter(id => !newMemberIds.includes(id))
        if (toRemove.length > 0) {
          console.log('Removing members:', toRemove)
          const { error: deleteError, data: deleteData } = await supabase
            .from('project_members')
            .delete()
            .eq('project_id', editingProject.id)
            .in('user_id', toRemove)
            .select()
          
          if (deleteError) {
            console.error('Error removing members:', deleteError)
            throw deleteError
          }
          console.log('Removed members successfully:', deleteData)
        }

        // Add new members (only those not already in the project)
        const toAdd = newMemberIds.filter(id => !currentMemberIds.includes(id))
        if (toAdd.length > 0) {
          console.log('Adding members:', toAdd)
          
          // Double-check existing members to avoid duplicates
          const { data: existingMembers } = await supabase
            .from('project_members')
            .select('user_id')
            .eq('project_id', editingProject.id)
            .in('user_id', toAdd)
          
          const existingMemberIds = new Set(existingMembers?.map(m => m.user_id) || [])
          const membersToAdd = toAdd.filter(id => !existingMemberIds.has(id))
          
          if (membersToAdd.length > 0) {
            const insertData = membersToAdd.map(userId => ({
              project_id: editingProject.id,
              user_id: userId,
              role: 'member',
            }))
            console.log('Insert data:', insertData)
            
            const { error: insertError, data: insertResult } = await supabase
              .from('project_members')
              .insert(insertData)
              .select()
            
            if (insertError) {
              console.error('Error adding members:', insertError)
              throw insertError
            }
            console.log('Added members successfully:', insertResult)
          } else {
            console.log('All members to add already exist in project')
          }
        } else if (toRemove.length === 0 && currentMemberIds.length === newMemberIds.length) {
          console.log('No changes to project members')
        }
      } else {
        // Create new project
        // Default project_managers to creator if not specified
        const projectManagers = formData.selectedProjectManagers.length > 0 
          ? formData.selectedProjectManagers 
          : [user.id] // Default to creator if no managers selected
        
        const { data: newProject, error: projectError } = await supabase
          .from('projects')
          .insert({
            name: formData.name,
            description: formData.description,
            status: formData.status,
            task_id: formData.task_id || null,
            created_by: user.id,
            project_managers: projectManagers,
          })
          .select()
          .single()

        if (projectError) {
          console.error('Error creating project:', projectError)
          throw projectError
        }

        // Add project members (for new projects)
        if (formData.selectedMembers.length > 0) {
          console.log('Adding members to new project:', formData.selectedMembers)
          
          // Remove any duplicate user IDs from the array
          const uniqueMemberIds = Array.from(new Set(formData.selectedMembers))
          
          const insertData = uniqueMemberIds.map(userId => ({
            project_id: newProject.id,
            user_id: userId,
            role: 'member',
          }))
          
          const { error: insertError, data: insertResult } = await supabase
            .from('project_members')
            .insert(insertData)
            .select()
          
          if (insertError) {
            console.error('Error adding members to new project:', insertError)
            throw insertError
          }
          console.log('Added members to new project successfully:', insertResult)
        }
      }

      setShowModal(false)
      setEditingProject(null)
      setMemberSearchTerm('')
      setFormData({
        name: '',
        description: '',
        status: 'pending',
        task_id: '',
        selectedProjectManagers: [],
        selectedMembers: [],
      })
      setShowNewTaskInput(false)
      setNewTaskName('')
      
      // Refresh projects list
      await fetchProjects()
      
      showSuccess('Project saved successfully!')
    } catch (error: any) {
      console.error('Error saving project:', error)
      showError(`Failed to save project: ${error.message || 'Unknown error'}`)
    }
  }

  const handleEdit = (project: ProjectWithDetails) => {
    setEditingProject(project)
    setSelectedGroups([]) // Reset groups when editing
    // Handle both project_members and members structure
    const members = project.members || (project as any).project_members || []
    const memberIds = members.map((m: any) => {
      // Handle different data structures
      if (m.profile?.id) return m.profile.id
      if (m.id && typeof m.id === 'string' && m.id.length > 30) return m.id // UUID
      return null
    }).filter(Boolean) as string[]
    
    console.log('Editing project:', project.name)
    console.log('Project members structure:', members)
    console.log('Current member IDs:', memberIds)
    setFormData({
      name: project.name,
      description: project.description || '',
      status: project.status as any,
      task_id: (project as any).task_id || '',
      selectedProjectManagers: (project.project_managers || []) as string[],
      selectedMembers: memberIds,
    })
    setShowNewTaskInput(false)
    setNewTaskName('')
    setMemberSearchTerm('')
    setShowModal(true)
  }

  const handleViewDetails = async (project: ProjectWithDetails) => {
    // Fetch detailed project data with member hours
    const { data: projectTimeEntries } = await supabase
      .from('project_time_entries')
      .select('time_entry_id, time_entries(user_id, duration, start_time, description)')
      .eq('project_id', project.id)

    const memberHoursMap = new Map<string, { name: string; hours: number; entries: any[] }>()
    projectTimeEntries?.forEach((entry: any) => {
      const userId = entry.time_entries?.user_id
      const hours = (entry.time_entries?.duration || 0) / 3600
      if (userId) {
        const existing = memberHoursMap.get(userId) || { name: '', hours: 0, entries: [] }
        existing.hours += hours
        existing.entries.push(entry.time_entries)
        const userProfile = allUsers.find(u => u.id === userId) || 
                           project.members?.find(m => m.profile.id === userId)?.profile
        if (userProfile) {
          existing.name = userProfile.full_name
        }
        memberHoursMap.set(userId, existing)
      }
    })

    const memberHours = Array.from(memberHoursMap.entries()).map(([user_id, data]) => ({
      user_id,
      user_name: data.name,
      hours: Math.round(data.hours * 10) / 10,
      entries: data.entries,
    }))

    setSelectedProject({
      ...project,
      member_hours: memberHours,
    })
    setShowDetailModal(true)
  }

  const handleDelete = async (id: string) => {
    try {
      // Delete project members first
      await supabase.from('project_members').delete().eq('project_id', id)
      // Delete project
      const { error } = await supabase.from('projects').delete().eq('id', id)
      if (error) throw error
      fetchProjects()
      showSuccess('Project deleted successfully!')
    } catch (error) {
      console.error('Error deleting project:', error)
      showError('Failed to delete project')
    }
  }

  const canEditProject = (project: ProjectWithDetails) => {
    if (user.role === 'admin') return true
    // Project owner (creator) can edit
    if (project.created_by === user.id) return true
    // Any project manager can edit
    if (project.project_managers && Array.isArray(project.project_managers) && project.project_managers.includes(user.id)) return true
    return false
  }

  const canManageTeamMembers = (project: ProjectWithDetails) => {
    if (user.role === 'admin') return true
    // Project owner (creator) can manage team members
    if (project.created_by === user.id) return true
    // Any project manager can manage team members
    if (project.project_managers && Array.isArray(project.project_managers) && project.project_managers.includes(user.id)) return true
    return false
  }

  const canViewAllData = (project: ProjectWithDetails) => {
    if (user.role === 'admin') return true
    if (project.created_by === user.id) return true
    if (project.project_managers && Array.isArray(project.project_managers) && project.project_managers.includes(user.id)) return true
    return false
  }

  const filteredProjects = projects.filter((project) => {
    const matchesFilter = filter === 'all' || project.status === filter
    const matchesSearch =
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (project as any).task?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    
    // Additional role-based filtering
    if (user.role === 'employee') {
      const isMember = project.members?.some(m => m.profile.id === user.id)
      return matchesFilter && matchesSearch && isMember
    }
    
    return matchesFilter && matchesSearch
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
      case 'pending':
        return 'bg-orange-100 text-orange-800'
      case 'completed':
        return 'bg-gray-100 text-gray-800 dark:text-white'
      default:
        return 'bg-gray-100 text-gray-800 dark:text-white'
    }
  }


  return (
    <div className="space-y-6">
      {/* Header */}
      {(user.role === 'admin' || user.role === 'manager') && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => {
              setEditingProject(null)
              setFormData({
                name: '',
                description: '',
                status: 'pending',
                task_id: '',
                selectedProjectManagers: [],
                selectedMembers: [],
              })
              setShowNewTaskInput(false)
              setNewTaskName('')
              setMemberSearchTerm('')
              setManagerSearchTerm('')
              setShowManagerDropdown(false)
              setShowModal(true)
            }}
            className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
          >
            <Plus className="w-5 h-5" />
            <span>Add Project</span>
          </button>
        </div>
      )}

      {/* Filters */}
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
          </div>
        </div>

        {/* Status Filters */}
        <div className="flex items-center space-x-3 mt-4">
          {[
            { label: 'All Projects', value: 'all', count: projects.length },
            {
              label: 'Active',
              value: 'active',
              count: projects.filter((p) => p.status === 'active').length,
            },
            {
              label: 'Pending',
              value: 'pending',
              count: projects.filter((p) => p.status === 'pending').length,
            },
            {
              label: 'Completed',
              value: 'completed',
              count: projects.filter((p) => p.status === 'completed').length,
            },
          ].map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter(item.value as any)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === item.value
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="py-12">
          <Loader size="lg" text="Loading projects" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow backdrop-blur-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">{project.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Task: {(project as any).task?.name || 'No task'}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(
                    project.status
                  )}`}
                >
                  {project.status}
                </span>
              </div>

              <div className="space-y-4">
                {/* Total Hours */}
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <Clock className="w-4 h-4" />
                  <span>Total: {project.hours_spent?.toFixed(1) || 0} hours</span>
                </div>

                {/* Available Tasks Info */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-xs text-blue-800 dark:text-blue-300 font-medium mb-1">Available for Time Tracking</p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    You can track time for this project and select any task when starting your tracker.
                  </p>
                </div>

                {/* Project Managers */}
                {project.project_manager_profiles && project.project_manager_profiles.length > 0 && (
                  <div className="flex items-start space-x-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <UserPlus className="w-4 h-4 mt-0.5" />
                    <div className="flex-1">
                      <span className="text-xs font-medium">Manager{project.project_manager_profiles.length > 1 ? 's' : ''}: </span>
                      <span className="text-xs">
                        {project.project_manager_profiles.map((pm, idx) => (
                          <span key={pm.id}>
                            {pm.full_name}
                            {idx < project.project_manager_profiles!.length - 1 && ', '}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Team Members */}
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <Users className="w-4 h-4" />
                  <span>
                    {project.members?.length || 0} team member{project.members?.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                  {canEditProject(project) && (
                    <button
                      onClick={() => handleEdit(project)}
                      className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-300 font-medium"
                      title="Edit Project"
                    >
                      <Edit className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleViewDetails(project)}
                    className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                  >
                    <Eye className="w-4 h-4" />
                    <span>View</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Project Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                {editingProject ? 'Edit Project' : 'Add Project'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false)
                  setEditingProject(null)
                  setMemberSearchTerm('')
                  setManagerSearchTerm('')
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Project Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Task</label>
                  <div className="relative" ref={taskDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowTaskDropdown(!showTaskDropdown)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-left flex items-center justify-between"
                    >
                      <span>
                        {formData.task_id
                          ? tasks.find(t => t.id === formData.task_id)?.name || 'Select a task'
                          : 'Select a task'}
                      </span>
                      <svg
                        className={`w-4 h-4 transition-transform ${showTaskDropdown ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {showTaskDropdown && (
                      <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        <div
                          className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer flex items-center justify-between"
                          onClick={() => {
                            setFormData({ ...formData, task_id: '' })
                            setShowTaskDropdown(false)
                            setShowNewTaskInput(false)
                          }}
                        >
                          <span className="text-gray-700 dark:text-gray-300">Select a task</span>
                        </div>
                        {tasks.map((task) => (
                          <div
                            key={task.id}
                            className={`px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer flex items-center justify-between group ${
                              formData.task_id === task.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                            onClick={(e) => {
                              // Don't select if clicking on edit/delete buttons
                              if ((e.target as HTMLElement).closest('button')) {
                                return
                              }
                              setFormData({ ...formData, task_id: task.id })
                              setShowTaskDropdown(false)
                              setShowNewTaskInput(false)
                            }}
                          >
                            {editingTaskId === task.id ? (
                              <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={editingTaskName}
                                  onChange={(e) => setEditingTaskName(e.target.value)}
                                  onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                      handleRenameTask(task.id, editingTaskName)
                                      setShowTaskDropdown(false)
                                    } else if (e.key === 'Escape') {
                                      cancelEditingTask()
                                    }
                                  }}
                                  className="flex-1 px-2 py-1 border border-blue-400 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                  autoFocus
                                />
                                <button
                                  onClick={() => {
                                    handleRenameTask(task.id, editingTaskName)
                                    setShowTaskDropdown(false)
                                  }}
                                  className="p-1 hover:bg-green-100 dark:hover:bg-green-800 rounded"
                                  title="Save"
                                >
                                  <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                                </button>
                                <button
                                  onClick={() => {
                                    cancelEditingTask()
                                    setShowTaskDropdown(false)
                                  }}
                                  className="p-1 hover:bg-red-100 dark:hover:bg-red-800 rounded"
                                  title="Cancel"
                                >
                                  <X className="w-4 h-4 text-red-600 dark:text-red-400" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="text-gray-700 dark:text-gray-300 flex-1">{task.name}</span>
                                {(user.role === 'admin' || user.role === 'manager') && (
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        startEditingTask(task.id, task.name)
                                      }}
                                      className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded"
                                      title="Rename task"
                                    >
                                      <Edit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteTask(task.id, task.name)
                                        setShowTaskDropdown(false)
                                      }}
                                      className="p-1 hover:bg-red-100 dark:hover:bg-red-800 rounded"
                                      title="Delete task"
                                    >
                                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                        {(user.role === 'admin' || user.role === 'manager') && (
                          <div
                            className="px-4 py-2 border-t border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer text-blue-600 dark:text-blue-400 font-medium"
                            onClick={() => {
                              setShowNewTaskInput(true)
                              setShowTaskDropdown(false)
                            }}
                          >
                            + Add New Task
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {showNewTaskInput && (
                    <div className="mt-2 flex items-center space-x-2">
                      <input
                        type="text"
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                        placeholder="Enter new task name"
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleCreateTask()
                          }
                        }}
                      />
                      <button
                        onClick={handleCreateTask}
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setShowNewTaskInput(false)
                          setNewTaskName('')
                          setFormData({ ...formData, task_id: '' })
                        }}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Project Managers Selection - Multi-select with search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Project Managers
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                    ({!editingProject && 'Default: You - Project Creator'})
                  </span>
                </label>
                <div className="relative" ref={managerDropdownRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowManagerDropdown(!showManagerDropdown)
                      if (showManagerDropdown) {
                        setManagerSearchTerm('')
                      }
                    }}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <span className="text-sm">
                      {formData.selectedProjectManagers.length === 0
                        ? (!editingProject ? 'You (Project Creator) - Default' : 'Select Project Managers')
                        : formData.selectedProjectManagers.length === 1
                        ? allUsers.find(u => u.id === formData.selectedProjectManagers[0])?.full_name || '1 manager selected'
                        : `${formData.selectedProjectManagers.length} managers selected`}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-500 transition-transform ${showManagerDropdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showManagerDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-[90]"
                        onClick={() => {
                          setShowManagerDropdown(false)
                          setManagerSearchTerm('')
                        }}
                      ></div>
                      <div 
                        className="absolute z-[100] mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Search Bar */}
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search managers..."
                              value={managerSearchTerm}
                              onChange={(e) => setManagerSearchTerm(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                            />
                          </div>
                        </div>
                        
                        {/* Select All Option */}
                        {(() => {
                          const filteredManagers = allUsers.filter(m => 
                            m.full_name?.toLowerCase().includes(managerSearchTerm.toLowerCase()) ||
                            m.email?.toLowerCase().includes(managerSearchTerm.toLowerCase())
                          )
                          return (
                            <label className="flex items-center space-x-2 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded cursor-pointer border-b border-gray-200 dark:border-gray-700 sticky top-[50px] bg-white dark:bg-gray-800">
                              <input
                                type="checkbox"
                                checked={filteredManagers.length > 0 && filteredManagers.every(m => formData.selectedProjectManagers.includes(m.id))}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    const newIds = [...new Set([...formData.selectedProjectManagers, ...filteredManagers.map(m => m.id)])]
                                    setFormData({ ...formData, selectedProjectManagers: newIds })
                                  } else {
                                    setFormData({ 
                                      ...formData, 
                                      selectedProjectManagers: formData.selectedProjectManagers.filter(id => !filteredManagers.some(m => m.id === id))
                                    })
                                  }
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Select All</span>
                              <span className="text-xs text-gray-500">({filteredManagers.length} managers)</span>
                            </label>
                          )
                        })()}
                        
                        {/* Manager List */}
                        <div className="p-1">
                          {allUsers
                            .filter(manager => 
                              manager.full_name?.toLowerCase().includes(managerSearchTerm.toLowerCase()) ||
                              manager.email?.toLowerCase().includes(managerSearchTerm.toLowerCase())
                            )
                            .map((manager) => (
                              <label
                                key={manager.id}
                                className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={formData.selectedProjectManagers.includes(manager.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setFormData({
                                        ...formData,
                                        selectedProjectManagers: [...formData.selectedProjectManagers, manager.id],
                                      })
                                    } else {
                                      setFormData({
                                        ...formData,
                                        selectedProjectManagers: formData.selectedProjectManagers.filter(id => id !== manager.id),
                                      })
                                    }
                                  }}
                                  className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">{manager.full_name}</span>
                                {manager.id === user.id && (
                                  <span className="text-xs text-gray-500">(You)</span>
                                )}
                                <span className="text-xs text-gray-500">({manager.role})</span>
                              </label>
                            ))}
                          {allUsers.filter(manager => 
                            manager.full_name?.toLowerCase().includes(managerSearchTerm.toLowerCase()) ||
                            manager.email?.toLowerCase().includes(managerSearchTerm.toLowerCase())
                          ).length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                              No managers found
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Project managers can add/remove team members from the entire organization for this project.
                  {!editingProject && ' If none selected, you will be the project manager by default.'}
                </p>
              </div>

              {/* Team Members Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Team Members
                  {editingProject && !canManageTeamMembers(editingProject) && (
                    <span className="text-xs text-orange-600 dark:text-orange-400 ml-2">
                      (Only project owner or manager can manage team members)
                    </span>
                  )}
                </label>
                <div className={`border border-gray-300 dark:border-gray-600 rounded-lg p-4 max-h-60 overflow-y-auto ${
                  editingProject && !canManageTeamMembers(editingProject) ? 'opacity-50 pointer-events-none' : ''
                }`}>
                  {/* Search Bar */}
                  <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 mb-2 pb-2 -mx-4 px-4">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search members..."
                        value={memberSearchTerm}
                        onChange={(e) => setMemberSearchTerm(e.target.value)}
                        className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  
                  {/* Select All Option */}
                  {(() => {
                    const filteredMembers = allUsers.filter(m => 
                      m.full_name?.toLowerCase().includes(memberSearchTerm.toLowerCase()) ||
                      m.email?.toLowerCase().includes(memberSearchTerm.toLowerCase())
                    )
                    return (
                      <label className="flex items-center space-x-2 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded cursor-pointer border-b border-gray-200 dark:border-gray-700 mb-2 pb-2">
                        <input
                          type="checkbox"
                          checked={filteredMembers.length > 0 && filteredMembers.every(m => formData.selectedMembers.includes(m.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              // Select all filtered users
                              const newIds = [...new Set([...formData.selectedMembers, ...filteredMembers.map(u => u.id)])]
                              setFormData({
                                ...formData,
                                selectedMembers: newIds,
                              })
                            } else {
                              // Deselect all filtered users
                              setFormData({
                                ...formData,
                                selectedMembers: formData.selectedMembers.filter(id => !filteredMembers.some(m => m.id === id)),
                              })
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Select All</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">({filteredMembers.length} members)</span>
                      </label>
                    )
                  })()}
                  
                  {/* Individual Members */}
                  {allUsers
                    .filter(member => 
                      member.full_name?.toLowerCase().includes(memberSearchTerm.toLowerCase()) ||
                      member.email?.toLowerCase().includes(memberSearchTerm.toLowerCase())
                    )
                    .map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.selectedMembers.includes(member.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              selectedMembers: [...formData.selectedMembers, member.id],
                            })
                          } else {
                            setFormData({
                              ...formData,
                              selectedMembers: formData.selectedMembers.filter((id) => id !== member.id),
                            })
                          }
                        }}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{member.full_name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">({member.role})</span>
                    </label>
                  ))}
                  {allUsers.filter(member => 
                    member.full_name?.toLowerCase().includes(memberSearchTerm.toLowerCase()) ||
                    member.email?.toLowerCase().includes(memberSearchTerm.toLowerCase())
                  ).length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                      No members found
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formData.selectedMembers.length} member(s) selected
                </p>
              </div>

              <div className="flex items-center space-x-3 pt-4">
                {editingProject && (
                  <button
                    onClick={async () => {
                      if (confirm(`Are you sure you want to delete "${editingProject.name}"? This action cannot be undone.`)) {
                        await handleDelete(editingProject.id)
                        setShowModal(false)
                        setEditingProject(null)
                        setMemberSearchTerm('')
                        setManagerSearchTerm('')
                      }
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-all font-medium"
                    title="Delete Project"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                )}
                <button
                  onClick={handleSave}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowModal(false)
                    setEditingProject(null)
                    setMemberSearchTerm('')
                    setManagerSearchTerm('')
                  }}
                  className="flex-1 border border-gray-300 dark:border-gray-600 px-6 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Details Modal */}
      {showDetailModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700 backdrop-blur-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{selectedProject.name}</h2>
              <div className="flex items-center space-x-2">
                {canEditProject(selectedProject) && (
                  <button
                    onClick={() => {
                      setShowDetailModal(false)
                      handleEdit(selectedProject)
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-300 font-medium"
                    title="Edit Project"
                  >
                    <Edit className="w-4 h-4" />
                    <span>Edit Project</span>
                  </button>
                )}
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Project Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Project Task</p>
                  <p className="text-lg font-semibold text-gray-800 dark:text-white">{(selectedProject as any).task?.name || 'No task'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Status</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedProject.status)}`}>
                    {selectedProject.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Total Hours Tracked</p>
                  <p className="text-lg font-semibold text-gray-800 dark:text-white">
                    {selectedProject.hours_spent?.toFixed(1) || 0} hours
                  </p>
                </div>
                {selectedProject.project_manager_profiles && selectedProject.project_manager_profiles.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Project Manager{selectedProject.project_manager_profiles.length > 1 ? 's' : ''}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {selectedProject.project_manager_profiles.map((pm) => (
                        <p key={pm.id} className="text-lg font-semibold text-gray-800 dark:text-white flex items-center space-x-2">
                          <UserPlus className="w-4 h-4" />
                          <span>{pm.full_name}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {selectedProject.created_by_profile && (
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Project Owner</p>
                    <p className="text-lg font-semibold text-gray-800 dark:text-white">
                      {selectedProject.created_by_profile.full_name}
                    </p>
                  </div>
                )}
              </div>

              {/* Time Tracking Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">Time Tracking Instructions</h4>
                <p className="text-sm text-blue-800 dark:text-blue-400 mb-2">
                  When starting your time tracker, select this project and choose from available tasks:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-1 px-3 py-1 bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 rounded-full text-xs text-blue-700 dark:text-blue-400 font-medium group"
                    >
                      {editingTaskId === task.id ? (
                        <>
                          <input
                            type="text"
                            value={editingTaskName}
                            onChange={(e) => setEditingTaskName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                handleRenameTask(task.id, editingTaskName)
                              } else if (e.key === 'Escape') {
                                cancelEditingTask()
                              }
                            }}
                            className="flex-1 min-w-[100px] px-2 py-0.5 border border-blue-400 rounded bg-white dark:bg-gray-800 text-blue-900 dark:text-blue-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={() => handleRenameTask(task.id, editingTaskName)}
                            className="p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded"
                            title="Save"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={cancelEditingTask}
                            className="p-0.5 hover:bg-red-100 dark:hover:bg-red-800 rounded"
                            title="Cancel"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span>{task.name}</span>
                          {(user.role === 'admin' || user.role === 'manager') && (
                            <>
                              <button
                                onClick={() => startEditingTask(task.id, task.name)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-opacity"
                                title="Rename task"
                              >
                                <Edit className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteTask(task.id, task.name)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-800 rounded transition-opacity"
                                title="Delete task"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Team Members Time Tracking */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Time Tracking by Team Member</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Team Member
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                          Total Hours
                        </th>
                        {canViewAllData(selectedProject) && (
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                            Percentage
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-transparent divide-y divide-gray-200 dark:divide-gray-700">
                      {selectedProject.member_hours && selectedProject.member_hours.length > 0 ? (
                        (canViewAllData(selectedProject)
                          ? selectedProject.member_hours
                          : selectedProject.member_hours.filter(m => m.user_id === user.id)
                        ).map((member) => (
                          <tr key={member.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                                    {member.user_name.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div className="ml-4">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {member.user_name}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400">
                              {member.hours} hrs
                            </td>
                            {canViewAllData(selectedProject) && (
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="w-full bg-gray-200 rounded-full h-2 mr-2">
                                    <div
                                      className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                                      style={{
                                        width: `${((member.hours / (selectedProject.hours_spent || 1)) * 100).toFixed(1)}%`,
                                      }}
                                    ></div>
                                  </div>
                                  <span className="text-xs text-gray-600 dark:text-gray-400">
                                    {((member.hours / (selectedProject.hours_spent || 1)) * 100).toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={canViewAllData(selectedProject) ? 3 : 2} className="px-6 py-4 text-center text-sm text-gray-500">
                            No time entries tracked yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Team Members List */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Team Members</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedProject.members && selectedProject.members.length > 0 ? (
                    selectedProject.members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center space-x-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg"
                      >
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 dark:text-blue-400 text-sm font-medium">
                            {member.profile.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">{member.profile.full_name}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No team members assigned</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
