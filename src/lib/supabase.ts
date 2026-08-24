import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Support both VITE_ and NEXT_PUBLIC_ prefixes for compatibility
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_* equivalents).',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
  },
})

// HRMS Supabase client for leave management (env-only; no hardcoded keys)
const hrmsSupabaseUrl =
  import.meta.env.VITE_HRMS_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_HRMS_SUPABASE_URL

const hrmsSupabaseAnonKey =
  import.meta.env.VITE_HRMS_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_HRMS_SUPABASE_ANON_KEY

if (!hrmsSupabaseUrl || !hrmsSupabaseAnonKey) {

}

export const hrmsSupabase =
  hrmsSupabaseUrl && hrmsSupabaseAnonKey
    ? createClient(hrmsSupabaseUrl, hrmsSupabaseAnonKey)
    : (null as unknown as ReturnType<typeof createClient>)
