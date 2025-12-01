import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Support both VITE_ and NEXT_PUBLIC_ prefixes for compatibility
const supabaseUrl = 
  import.meta.env.VITE_SUPABASE_URL || 
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 
  'https://yxkniwzsinqyjdqqzyjs.supabase.co'

const supabaseAnonKey = 
  import.meta.env.VITE_SUPABASE_ANON_KEY || 
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4a25pd3pzaW5xeWpkcXF6eWpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4ODY2OTMsImV4cCI6MjA1MjQ2MjY5M30.9n2wAH28zZplcHDSSDquQ9dD3zXTDoNmZ69uKSUE3Pk'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce', // Explicitly enable PKCE flow for OAuth
    detectSessionInUrl: true, // Automatically detect and handle OAuth callbacks
  },
})

