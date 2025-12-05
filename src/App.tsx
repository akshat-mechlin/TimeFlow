import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import Layout from './components/Layout'
import Loader from './components/Loader'
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
  try {
    // Check if it's a custom protocol URL (e.g., tracker://callback)
    if (callbackUrl.includes('://') && !callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
      // Custom protocol - use query parameters
      const queryString = new URLSearchParams(params).toString()
      return `${callbackUrl}?${queryString}`
    } else {
      // HTTP/HTTPS URL - use query parameters (important for HTTP servers to read them)
      const url = new URL(callbackUrl)
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value)
      })
      return url.toString()
    }
  } catch (error) {
    // Fallback: if URL parsing fails, use simple query string concatenation
    const queryString = new URLSearchParams(params).toString()
    return `${callbackUrl}?${queryString}`
  }
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
          const callbackUrl = queryParams.get('callback') || sessionStorage.getItem('oauth_callback_url')
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

        // For PKCE flow, we need to extract the code from URL and exchange it
        const code = hashParams.get('code') || queryParams.get('code')
        
        // Get callback URL from query params or sessionStorage (for Electron app or HTTP server)
        // Check both places to ensure we don't lose it
        const callbackFromQuery = queryParams.get('callback')
        const callbackFromStorage = sessionStorage.getItem('oauth_callback_url')
        const callbackUrl = callbackFromQuery || callbackFromStorage
        
        // Debug logging
        console.log('Auth callback - Code:', code ? 'present' : 'missing')
        console.log('Auth callback - Callback from query:', callbackFromQuery)
        console.log('Auth callback - Callback from storage:', callbackFromStorage)
        console.log('Auth callback - Final callback URL:', callbackUrl)
        
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
              console.log('Redirecting to callback URL with tokens:', callbackUrl)
              sessionStorage.removeItem('oauth_callback_url')
              
              // Extract access_token and refresh_token from session
              const accessToken = data.session.access_token
              const refreshToken = data.session.refresh_token || ''
              
              console.log('Tokens extracted - Access token:', accessToken ? 'present' : 'missing')
              console.log('Tokens extracted - Refresh token:', refreshToken ? 'present' : 'missing')
              
              // Build redirect URL with tokens using query parameters
              // This is important for HTTP servers which need to read query params (not hash fragments)
              const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
                access_token: accessToken,
                refresh_token: refreshToken
              })
              
              console.log('Final redirect URL:', redirectUrl)
              
              // Immediately redirect - don't wait for anything else
              window.location.href = redirectUrl
              return
            }
            
            // Normal web flow - create/update profile and navigate to dashboard
            console.log('No callback URL - proceeding with normal web flow')
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
        console.error('Auth callback error:', err)
        const errorMessage = err.message || 'Authentication failed'
        setError(errorMessage)
        setLoading(false)
        
        // Check if callback URL exists and redirect with error
        const queryParams = new URLSearchParams(window.location.search)
        const callbackUrl = queryParams.get('callback') || sessionStorage.getItem('oauth_callback_url')
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
      const callbackUrl = queryParams.get('callback') || sessionStorage.getItem('oauth_callback_url')
      
      if (callbackUrl) {
        // Check if user is already logged in
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          console.log('User already logged in with callback URL - redirecting immediately')
          sessionStorage.removeItem('oauth_callback_url')
          
          const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
            access_token: session.access_token,
            refresh_token: session.refresh_token || ''
          })
          
          console.log('Redirecting to callback URL:', redirectUrl)
          window.location.href = redirectUrl
          return true // Indicate that redirect happened
        } else {
          // Store callback URL for later use
          sessionStorage.setItem('oauth_callback_url', callbackUrl)
          console.log('Stored callback URL for later:', callbackUrl)
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
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Check callback URL on auth state change too
      const queryParams = new URLSearchParams(window.location.search)
      const callbackUrl = queryParams.get('callback') || sessionStorage.getItem('oauth_callback_url')
      
      if (session?.user && callbackUrl) {
        console.log('Auth state changed - user logged in with callback URL')
        sessionStorage.removeItem('oauth_callback_url')
        
        const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
          access_token: session.access_token,
          refresh_token: session.refresh_token || ''
        })
        
        console.log('Redirecting to callback URL:', redirectUrl)
        window.location.href = redirectUrl
        return
      }
      
      if (session?.user) {
        fetchUserProfile(session.user.id)
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
          console.error('Error creating user profile:', insertError)
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
      console.error('Error fetching user profile:', error)
    } finally {
      setLoading(false)
    }
  }

  // Check for callback URL when user is logged in (for Electron app)
  useEffect(() => {
    if (user) {
      const queryParams = new URLSearchParams(window.location.search)
      const callbackUrl = queryParams.get('callback') || sessionStorage.getItem('oauth_callback_url')
      
      if (callbackUrl) {
        console.log('User logged in with callback URL - checking session for tokens')
        // Get current session to extract tokens
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            console.log('Session found - redirecting to callback URL')
            sessionStorage.removeItem('oauth_callback_url')
            
            const redirectUrl = buildCallbackRedirectUrl(callbackUrl, {
              access_token: session.access_token,
              refresh_token: session.refresh_token || ''
            })
            
            console.log('Redirecting to callback URL:', redirectUrl)
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
        <BrowserRouter>
          <Suspense fallback={<Loader size="lg" />}>
            <Routes>
              <Route 
                path="/auth/callback" 
                element={<AuthCallback onAuthSuccess={fetchUserProfile} />} 
              />
              <Route 
                path="/login/direct" 
                element={<LoginDirect onLogin={fetchUserProfile} />} 
              />
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

