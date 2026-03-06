import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Support both VITE_ and NEXT_PUBLIC_ prefixes for compatibility
const supabaseUrl = 
  'https://ljhnrsejkjtbsabumonk.supabase.co'

const supabaseAnonKey = 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqaG5yc2Vqa2p0YnNhYnVtb25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDA5NTksImV4cCI6MjA4NTExNjk1OX0.CJ2xmJMJFr0-Pg5irL3d70QRkRpTcfiJ61wSalabaJ8'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce', // Explicitly enable PKCE flow for OAuth
    detectSessionInUrl: true, // Automatically detect and handle OAuth callbacks
  },
})

// HRMS Supabase client for leave management
const hrmsSupabaseUrl = 
  import.meta.env.VITE_HRMS_SUPABASE_URL || 
  import.meta.env.NEXT_PUBLIC_HRMS_SUPABASE_URL || 
  'https://gfencmpeybxarrnmermr.supabase.co'

const hrmsSupabaseAnonKey = 
  import.meta.env.VITE_HRMS_SUPABASE_ANON_KEY || 
  import.meta.env.NEXT_PUBLIC_HRMS_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmZW5jbXBleWJ4YXJybm1lcm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMDY2MTgsImV4cCI6MjA3MjU4MjYxOH0.3hKb1ijaCUn0HU4LbuuvlPGqUyKQuHUwYTmxonWYqMY'

export const hrmsSupabase = createClient(hrmsSupabaseUrl, hrmsSupabaseAnonKey)

