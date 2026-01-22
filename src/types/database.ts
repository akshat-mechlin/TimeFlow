export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
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
        Relationships: [
          {
            foreignKeyName: "activity_logs_screenshot_id_fkey"
            columns: ["screenshot_id"]
            isOneToOne: false
            referencedRelation: "screenshots"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "employee_managers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_managers_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          manager_id: string | null
          name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          manager_id?: string | null
          name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          manager_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_approvers: {
        Row: {
          approver_id: string
          comment: string | null
          created_at: string | null
          id: string
          leave_request_id: string
          status: Database["public"]["Enums"]["leave_status"] | null
          updated_at: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          created_at?: string | null
          id?: string
          leave_request_id: string
          status?: Database["public"]["Enums"]["leave_status"] | null
          updated_at?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          created_at?: string | null
          id?: string
          leave_request_id?: string
          status?: Database["public"]["Enums"]["leave_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_approvers_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_approvers_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          reason: string
          start_date: string
          status: Database["public"]["Enums"]["leave_status"] | null
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
          status?: Database["public"]["Enums"]["leave_status"] | null
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
          status?: Database["public"]["Enums"]["leave_status"] | null
          type_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          read: boolean | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          read?: boolean | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          read?: boolean | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          enable_camera_capture: boolean
          enable_screenshot_capture: boolean
          force_password_change: boolean | null
          full_name: string
          id: string
          location: string | null
          manager_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          team: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          enable_camera_capture?: boolean
          enable_screenshot_capture?: boolean
          force_password_change?: boolean | null
          full_name: string
          id: string
          location?: string | null
          manager_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          enable_camera_capture?: boolean
          enable_screenshot_capture?: boolean
          force_password_change?: boolean | null
          full_name?: string
          id?: string
          location?: string | null
          manager_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "project_time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_time_entries_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string | null
          created_by: string | null
          deadline: string | null
          description: string | null
          id: string
          name: string
          project_managers: string[] | null
          status: string
          task_id: string | null
          total_hours: number | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name: string
          project_managers?: string[] | null
          status?: string
          task_id?: string | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name?: string
          project_managers?: string[] | null
          status?: string
          task_id?: string | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      screenshot_activity: {
        Row: {
          active_applications: Json | null
          app_version: string | null
          created_at: string | null
          device_os: string | null
          id: string
          interval_duration_seconds: number
          interval_end_time: string
          interval_start_time: string
          keyboard_activity_details: Json
          keyboard_usage_percentage: number
          mouse_activity_details: Json
          mouse_usage_percentage: number
          project_id: string | null
          screenshot_id: string
          suspicious_activity_flags: string[] | null
          time_entry_id: string | null
          updated_at: string | null
          user_id: string
          visited_websites: Json | null
        }
        Insert: {
          active_applications?: Json | null
          app_version?: string | null
          created_at?: string | null
          device_os?: string | null
          id?: string
          interval_duration_seconds: number
          interval_end_time: string
          interval_start_time: string
          keyboard_activity_details?: Json
          keyboard_usage_percentage?: number
          mouse_activity_details?: Json
          mouse_usage_percentage?: number
          project_id?: string | null
          screenshot_id: string
          suspicious_activity_flags?: string[] | null
          time_entry_id?: string | null
          updated_at?: string | null
          user_id: string
          visited_websites?: Json | null
        }
        Update: {
          active_applications?: Json | null
          app_version?: string | null
          created_at?: string | null
          device_os?: string | null
          id?: string
          interval_duration_seconds?: number
          interval_end_time?: string
          interval_start_time?: string
          keyboard_activity_details?: Json
          keyboard_usage_percentage?: number
          mouse_activity_details?: Json
          mouse_usage_percentage?: number
          project_id?: string | null
          screenshot_id?: string
          suspicious_activity_flags?: string[] | null
          time_entry_id?: string | null
          updated_at?: string | null
          user_id?: string
          visited_websites?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "screenshot_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenshot_activity_screenshot_id_fkey"
            columns: ["screenshot_id"]
            isOneToOne: false
            referencedRelation: "screenshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenshot_activity_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenshot_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "screenshots_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          app_version: string | null
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
          app_version?: string | null
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
          app_version?: string | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          end_time?: string | null
          id?: string
          start_time?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_employee_managers: {
        Args: { emp_id: string }
        Returns: {
          manager_id: string
          manager_type: string
        }[]
      }
      get_user_id_by_email: { Args: { user_email: string }; Returns: string }
      is_admin: { Args: { user_id: string }; Returns: boolean }
      is_manager: { Args: { user_id: string }; Returns: boolean }
      is_manager_of_employee: {
        Args: { employee_uuid: string; manager_uuid: string }
        Returns: boolean
      }
      manages_employee: {
        Args: { employee_id: string; manager_id: string }
        Returns: boolean
      }
    }
    Enums: {
      leave_status: "pending" | "approved" | "rejected"
      notification_type:
        | "leave_request"
        | "leave_approved"
        | "leave_rejected"
        | "time_tracking"
        | "system"
      user_role: "employee" | "manager" | "admin" | "hr" | "accountant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      leave_status: ["pending", "approved", "rejected"],
      notification_type: [
        "leave_request",
        "leave_approved",
        "leave_rejected",
        "time_tracking",
        "system",
      ],
      user_role: ["employee", "manager", "admin", "hr", "accountant"],
    },
  },
} as const
