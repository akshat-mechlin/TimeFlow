// Creates a Supabase Auth user and public.profiles row. Callable only by users with role admin.
// Gateway JWT verification can be disabled in dashboard so OAuth/PKCE clients are not blocked;
// this handler always validates JWT + admin role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type UserRole = 'employee' | 'manager' | 'admin' | 'hr' | 'accountant'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  const jwtMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  const jwt = jwtMatch?.[1]?.trim() ?? ''
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // getUser() with no args ignores global headers in Edge; must pass the access token explicitly.
  const supabaseAdmin = createClient(supabaseUrl, serviceKey)
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt)
  if (userErr || !userData.user) {
    return new Response(
      JSON.stringify({ error: userErr?.message || 'Invalid session' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const { data: callerProfile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  if (profileErr || callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: {
    email?: string
    password?: string
    full_name?: string
    role?: UserRole
    team?: string | null
    manager_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const email = body.email?.trim()
  const password = body.password
  const full_name = body.full_name?.trim()
  const role = body.role
  const team = body.team?.trim() || null
  const manager_id = body.manager_id?.trim() || null

  if (!email || !password || !full_name || !role) {
    return new Response(JSON.stringify({ error: 'email, password, full_name, and role are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const validRoles: UserRole[] = ['employee', 'manager', 'admin', 'hr', 'accountant']
  if (!validRoles.includes(role)) {
    return new Response(JSON.stringify({ error: 'Invalid role' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (password.length < 6) {
    return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return new Response(
      JSON.stringify({ error: authError?.message ?? 'Failed to create user account' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // handle_new_user() trigger already inserts a profiles row on auth.users INSERT — use upsert to apply admin fields.
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: authData.user.id,
      email,
      full_name,
      role,
      team,
      manager_id,
      force_password_change: true,
      enable_screenshot_capture: true,
      enable_camera_capture: true,
    },
    { onConflict: 'id' },
  )

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return new Response(JSON.stringify({ error: profileError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ userId: authData.user.id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
