import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { writeUserLog } from './lib/userLogs'
import { sanitizeOAuthCallback } from './lib/oauthCallbackAllowlist'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import Layout from './components/Layout'
import Loader from './components/Loader'
import DevToolsGuard from './components/DevToolsGuard'
import type { Tables } from './types/database'

// Lazy load pages for better performance
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Reports = lazy(() => import('./pages/Reports'))
const ProjectManagement = lazy(() => import('./pages/ProjectManagement'))
const TeamMembers = lazy(() => import('./pages/TeamMembers'))
const Screenshots = lazy(() => import('./pages/Screenshots'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const Profile = lazy(() => import('./pages/Profile'))
const Download = lazy(() => import('./pages/Download'))
const Login = lazy(() => import('./pages/Login'))
const LoginDirect = lazy(() => import('./pages/LoginDirect'))

// Helper function to build redirect URL with query parameters
// Handles both custom protocol URLs (tracker://callback) and HTTP URLs (http://localhost:5174/callback)
const buildCallbackRedirectUrl = (callbackUrl: string, params: Record<string, string>) => {
  const allowed = sanitizeOAuthCallback(callbackUrl)
  if (!allowed) {
    throw new Error('Callback URL is not on the allowlist')
  }
  try {
    // Check if it's a custom protocol URL (e.g., tracker://callback)
    if (allowed.includes('://') && !allowed.startsWith('http://') && !allowed.startsWith('https://')) {
      // Custom protocol - use query parameters
      const queryString = new URLSearchParams(params).toString()
      return `${allowed}?${queryString}`
    } else {
      // HTTP/HTTPS URL - use query parameters (important for HTTP servers to read them)
      const url = new URL(allowed)
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value)
      })
      return url.toString()
    }
  } catch (error) {
    // Fallback: if URL parsing fails, use simple query string concatenation
    const queryString = new URLSearchParams(params).toString()
    return `${allowed}?${queryString}`
  }
}

function resolveStoredCallback(): string | null {
  const queryParams = new URLSearchParams(window.location.search)
  return (
    sanitizeOAuthCallback(queryParams.get('callback')) ||
    sanitizeOAuthCallback(sessionStorage.getItem('oauth_callback_url'))
  )
}

// Auth Callback component to handle OAuth redirects
function AuthCallback({ onAuthSuccess }: { onAuthSuccess: (userId: string) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Check for error in URL (can be in hash or query params)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const queryParams = new URLSearchParams(window.location.search)
        
        const errorParam = hashParams.get('error') || queryParams.get('error')
        const errorDescription = hashParams.get('error_description') || queryParams.get('error_description')

        if (errorParam) {
          const decodedError = decodeURIComponent(errorDescription || errorParam)
          setError(decodedError)
          setLoading(false)
          
          // Check if this is a callback (Electron app or HTTP server) - redirect with error
          const callbackUrl = resolveStoredCallback()
          if (callbackUrl) {
            sessionStorage.removeItem('oauth_callback_url')
            // Use query parameters for error (important for HTTP servers)
            const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
              error: decodedError
            })
            window.location.href = redirectUrl
            return
          }
          
          setTimeout(() => navigate('/'), 5000)
          return
        }

        // Get allowlisted callback URL (Electron / local desktop handoff only)
        const callbackUrl = resolveStoredCallback()
        const code = hashParams.get('code') || queryParams.get('code')

        if (code) {
          // Exchange the authorization code for a session (PKCE flow)
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          
          if (exchangeError) {
            throw exchangeError
          }

          if (data.session?.user) {
            // If callback URL is present (Electron app or HTTP server), redirect with tokens
            // IMPORTANT: Do this BEFORE calling onAuthSuccess to prevent navigation to dashboard
            if (callbackUrl) {
              sessionStorage.removeItem('oauth_callback_url')
              
              // Extract access_token and refresh_token from session
              const accessToken = data.session.access_token
              const refreshToken = data.session.refresh_token || ''
              
              // Build redirect URL with tokens using query parameters
              // This is important for HTTP servers which need to read query params (not hash fragments)
              const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
                access_token: accessToken,
                refresh_token: refreshToken
              })
              
              // Immediately redirect - don't wait for anything else
              window.location.href = redirectUrl
              return
            }
            
            // Normal web flow - create/update profile and navigate to dashboard
            onAuthSuccess(data.session.user.id)
            // Clear the URL parameters
            window.history.replaceState({}, document.title, window.location.pathname)
            navigate('/')
          } else {
            setError('No session found after code exchange')
            setLoading(false)
            
            // If callback URL exists, redirect with error
            if (callbackUrl) {
              sessionStorage.removeItem('oauth_callback_url')
              const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
                error: 'No session found after code exchange'
              })
              window.location.href = redirectUrl
              return
            }
            
            setTimeout(() => navigate('/'), 3000)
          }
        } else {
          // Fallback: try to get existing session
          const { data: { session }, error: sessionError } = await supabase.auth.getSession()

          if (sessionError) {
            throw sessionError
          }

          if (session?.user) {
            // Check if callback URL exists
            if (callbackUrl) {
              sessionStorage.removeItem('oauth_callback_url')
              const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
                access_token: session.access_token,
                refresh_token: session.refresh_token || ''
              })
              window.location.href = redirectUrl
              return
            }
            
            onAuthSuccess(session.user.id)
            navigate('/')
          } else {
            setError('No authorization code or session found')
            setLoading(false)
            
            // If callback URL exists, redirect with error
            if (callbackUrl) {
              sessionStorage.removeItem('oauth_callback_url')
              const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
                error: 'No authorization code or session found'
              })
              window.location.href = redirectUrl
              return
            }
            
            setTimeout(() => navigate('/'), 3000)
          }
        }
      } catch (err: any) {

        const errorMessage = err.message || 'Authentication failed'
        setError(errorMessage)
        setLoading(false)
        
        // Check if callback URL exists and redirect with error
        const queryParams = new URLSearchParams(window.location.search)
        const callbackUrl = resolveStoredCallback()
        if (callbackUrl) {
          sessionStorage.removeItem('oauth_callback_url')
          const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
            error: errorMessage
          })
          window.location.href = redirectUrl
          return
        }
        
        setTimeout(() => navigate('/'), 5000)
      }
    }

    handleAuthCallback()
  }, [navigate, onAuthSuccess])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader size="lg" text="Completing sign in..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700 text-center">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">Authentication Error</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">Redirecting to login...</p>
        </div>
      </div>
    )
  }

  return null
}

type Profile = Tables<'profiles'>

function App() {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if there's a callback URL in the current URL (for Electron app)
    // If user is already logged in and has a callback URL, redirect immediately
    const checkCallbackAndRedirect = async () => {
      const queryParams = new URLSearchParams(window.location.search)
      const callbackUrl = resolveStoredCallback()
      
      if (callbackUrl) {
        // Check if user is already logged in
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          sessionStorage.removeItem('oauth_callback_url')
          
          const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
            access_token: session.access_token,
            refresh_token: session.refresh_token || ''
          })
          
          window.location.href = redirectUrl
          return true // Indicate that redirect happened
        } else {
          // Store callback URL for later use
          if (callbackUrl) sessionStorage.setItem('oauth_callback_url', callbackUrl)
        }
      }
      return false
    }

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // First check if we need to redirect due to callback URL
      const redirected = await checkCallbackAndRedirect()
      if (redirected) {
        return // Don't proceed with normal flow if redirect happened
      }
      
      if (session?.user) {
        fetchUserProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Check callback URL on auth state change too
      const queryParams = new URLSearchParams(window.location.search)
      const callbackUrl = resolveStoredCallback()
      
      if (session?.user && callbackUrl) {
        sessionStorage.removeItem('oauth_callback_url')
        
        const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
          access_token: session.access_token,
          refresh_token: session.refresh_token || ''
        })
        
        window.location.href = redirectUrl
        return
      }
      
      if (session?.user) {
        fetchUserProfile(session.user.id)
        if (event === 'SIGNED_IN') {
          const alreadyLogged = sessionStorage.getItem(`activity_login_logged_${session.user.id}`)
          if (!alreadyLogged) {
            sessionStorage.setItem(`activity_login_logged_${session.user.id}`, '1')
            const name =
              session.user.user_metadata?.full_name ||
              session.user.user_metadata?.name ||
              session.user.email ||
              'Someone'
            writeUserLog({
              userId: session.user.id,
              logType: 'login',
              source: 'website',
              message: `${name} logged in with Azure SSO`,
              metadata: {
                api_action: 'Sign in',
                api_table: 'auth',
                api_operation: 'signIn',
                login_method: 'azure_sso',
                user_email: session.user.email || null,
              },
            })
          }
        }
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserProfile = async (userId: string) => {
    try {
      // Get user metadata from auth
      const { data: { user: authUser } } = await supabase.auth.getUser()
      
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      // If profile doesn't exist, create it (for SSO users)
      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist, create it
        const userMetadata = authUser?.user_metadata || {}
        const email = authUser?.email || userMetadata.email || ''
        const fullName = userMetadata.full_name || userMetadata.name || email.split('@')[0] || 'User'
        
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email: email,
            full_name: fullName,
            role: 'employee', // Default role for new SSO users
            team: null,
            manager_id: null,
            force_password_change: false, // SSO users don't need password change
          })
          .select()
          .single()

        if (insertError) {

          throw insertError
        }

        data = newProfile
      } else if (error) {
        throw error
      } else if (data && authUser) {
        // Update email if it's different (in case user changed email in Azure)
        const email = authUser.email || authUser.user_metadata?.email
        if (email && data.email !== email) {
          const { data: updatedProfile, error: updateError } = await supabase
            .from('profiles')
            .update({ email })
            .eq('id', userId)
            .select()
            .single()

          if (!updateError && updatedProfile) {
            data = updatedProfile
          }
        }
      }

      setUser(data)
    } catch (error) {

    } finally {
      setLoading(false)
    }
  }

  // Check for callback URL when user is logged in (for Electron app)
  useEffect(() => {
    if (user) {
      const queryParams = new URLSearchParams(window.location.search)
      const callbackUrl = resolveStoredCallback()
      
      if (callbackUrl) {
        // Get current session to extract tokens
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            sessionStorage.removeItem('oauth_callback_url')
            
            const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
              access_token: session.access_token,
              refresh_token: session.refresh_token || ''
            })
            
            window.location.href = redirectUrl
          }
        })
      }
    }
  }, [user])

  if (loading) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <Loader fullScreen size="lg" text="Initializing..." />
        </ToastProvider>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        <DevToolsGuard user={user} source="website" />
        <BrowserRouter>
          <Suspense fallback={<Loader size="lg" />}>
            <Routes>
              <Route 
                path="/auth/callback" 
                element={<AuthCallback onAuthSuccess={fetchUserProfile} />} 
              />
              {import.meta.env.DEV && (
                <Route 
                  path="/login/direct" 
                  element={<LoginDirect onLogin={fetchUserProfile} />} 
                />
              )}
              {!user ? (
                <Route path="*" element={<Login onLogin={fetchUserProfile} />} />
              ) : (
                <Route
                  path="*"
                  element={
                    <Layout user={user}>
                      <Routes>
                        <Route path="/" element={<Dashboard user={user} />} />
                        <Route path="/attendance" element={<Attendance user={user} />} />
                        <Route path="/reports" element={<Reports user={user} />} />
                        <Route path="/projects" element={<ProjectManagement user={user} />} />
                        <Route path="/team" element={<TeamMembers user={user} />} />
                        <Route path="/screenshots" element={<Screenshots user={user} />} />
                        <Route 
                          path="/admin" 
                          element={
                            user.role === 'admin' 
                              ? <AdminPanel user={user} /> 
                              : <Navigate to="/" replace />
                          } 
                        />
                        <Route path="/download" element={<Download />} />
                        <Route path="/profile" element={<Profile user={user} onProfileUpdate={fetchUserProfile} />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Layout>
                  }
                />
              )}
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App

