import { supabase } from './supabase'
import { FunctionsHttpError } from '@supabase/supabase-js'

type AdminAction = 'create' | 'update' | 'delete' | 'recovery_link'

export async function callAdminUsers(body: Record<string, unknown> & { action: AdminAction }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Not authenticated')
  }

  const { data, error } = await supabase.functions.invoke('admin-users', {
    body,
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
  })

  if (error) {
    let message = error.message || 'Admin function failed'
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json()
        if (payload?.error) message = String(payload.error)
      } catch {
        /* keep message */
      }
    }
    throw new Error(message)
  }
  if (data?.error) {
    throw new Error(String(data.error))
  }
  return data
}
