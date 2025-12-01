export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity_logs: {
        Row: {
          created_at: string | null
          id: string
          keystrokes: number
          mouse_movements: number
          productivity_score: number
          screenshot_id: string
          urls: string[] | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          keystrokes?: number
          mouse_movements?: number
          productivity_score?: number
          screenshot_id: string
          urls?: string[] | null
        }
        Update: {
          created_at?: string | null
          id?: string
          keystrokes?: number
          mouse_movements?: number
          productivity_score?: number
          screenshot_id?: string
          urls?: string[] | null
        }
      }
      attendance: {
        Row: {
          clock_in_time: string | null
          clock_out_time: string | null
          created_at: string | null
          date: string
          id: string
          notes: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          clock_in_time?: string | null
          clock_out_time?: string | null
          created_at?: string | null
          date: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          clock_in_time?: string | null
          clock_out_time?: string | null
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
      }
      clients: {
        Row: {
          address: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string | null
        }
      }
      employee_managers: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          manager_id: string
          manager_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: string
          manager_id: string
          manager_type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: string
          manager_id?: string
          manager_type?: string
          updated_at?: string | null
        }
      }
      leave_approvers: {
        Row: {
          approver_id: string
          comment: string | null
          created_at: string | null
          id: string
          leave_request_id: string
          status: 'pending' | 'approved' | 'rejected' | null
          updated_at: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          created_at?: string | null
          id?: string
          leave_request_id: string
          status?: 'pending' | 'approved' | 'rejected' | null
          updated_at?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          created_at?: string | null
          id?: string
          leave_request_id?: string
          status?: 'pending' | 'approved' | 'rejected' | null
          updated_at?: string | null
        }
      }
      leave_requests: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          reason: string
          start_date: string
          status: 'pending' | 'approved' | 'rejected' | null
          type_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          reason: string
          start_date: string
          status?: 'pending' | 'approved' | 'rejected' | null
          type_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          reason?: string
          start_date?: string
          status?: 'pending' | 'approved' | 'rejected' | null
          type_id?: string
          updated_at?: string | null
          user_id?: string
        }
      }
      leave_types: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
        }
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          read: boolean | null
          title: string
          type: 'leave_request' | 'leave_approved' | 'leave_rejected' | 'time_tracking' | 'system'
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          read?: boolean | null
          title: string
          type: 'leave_request' | 'leave_approved' | 'leave_rejected' | 'time_tracking' | 'system'
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          read?: boolean | null
          title?: string
          type?: 'leave_request' | 'leave_approved' | 'leave_rejected' | 'time_tracking' | 'system'
          user_id?: string
        }
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          force_password_change: boolean | null
          full_name: string
          id: string
          manager_id: string | null
          role: 'employee' | 'manager' | 'admin' | 'hr' | 'accountant'
          team: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          force_password_change?: boolean | null
          full_name: string
          id: string
          manager_id?: string | null
          role?: 'employee' | 'manager' | 'admin' | 'hr' | 'accountant'
          team?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          force_password_change?: boolean | null
          full_name?: string
          id?: string
          manager_id?: string | null
          role?: 'employee' | 'manager' | 'admin' | 'hr' | 'accountant'
          team?: string | null
          updated_at?: string | null
        }
      }
      project_members: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          role?: string | null
          user_id?: string
        }
      }
      project_time_entries: {
        Row: {
          billable: boolean | null
          created_at: string | null
          id: string
          project_id: string | null
          time_entry_id: string
        }
        Insert: {
          billable?: boolean | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          time_entry_id: string
        }
        Update: {
          billable?: boolean | null
          created_at?: string | null
          id?: string
          project_id?: string | null
          time_entry_id?: string
        }
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string | null
          deadline: string | null
          description: string | null
          id: string
          name: string
          status: string
          total_hours: number | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name: string
          status?: string
          total_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: string
          total_hours?: number | null
          updated_at?: string | null
        }
      }
      screenshots: {
        Row: {
          created_at: string | null
          id: string
          storage_path: string
          taken_at: string | null
          time_entry_id: string
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          storage_path: string
          taken_at?: string | null
          time_entry_id: string
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          storage_path?: string
          taken_at?: string | null
          time_entry_id?: string
          type?: string
        }
      }
      time_entries: {
        Row: {
          created_at: string | null
          description: string | null
          duration: number | null
          end_time: string | null
          id: string
          start_time: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          duration?: number | null
          end_time?: string | null
          id?: string
          start_time?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          duration?: number | null
          end_time?: string | null
          id?: string
          start_time?: string
          updated_at?: string | null
          user_id?: string
        }
      }
    }
    Enums: {
      leave_status: 'pending' | 'approved' | 'rejected'
      notification_type: 'leave_request' | 'leave_approved' | 'leave_rejected' | 'time_tracking' | 'system'
      user_role: 'employee' | 'manager' | 'admin' | 'hr' | 'accountant'
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
