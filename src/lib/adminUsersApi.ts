import { supabase } from './supabase'

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
    throw new Error(error.message || 'Admin function failed')
  }
  if (data?.error) {
    throw new Error(String(data.error))
  }
  return data
}
