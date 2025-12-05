import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'

interface LoginProps {
  onLogin: (userId: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  // Email/Password login state (commented out - SSO only)
  // const [email, setEmail] = useState('')
  // const [password, setPassword] = useState('')
  // const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const { showError } = useToast()

  // Read callback URL from query params (for Electron app integration)
  // Read directly from window.location since Login is rendered outside Router
  const getCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    return params.get('callback')
  }

  const callbackUrl = getCallbackUrl()

  // Store callback URL in sessionStorage so it persists through OAuth redirect
  useEffect(() => {
    if (callbackUrl) {
      console.log('Storing callback URL in sessionStorage:', callbackUrl)
      sessionStorage.setItem('oauth_callback_url', callbackUrl)
    } else {
      // Also check if it's already in sessionStorage (in case page was refreshed)
      const storedCallback = sessionStorage.getItem('oauth_callback_url')
      if (storedCallback) {
        console.log('Found existing callback URL in sessionStorage:', storedCallback)
      }
    }
  }, [callbackUrl])

  // Email/Password login handler (commented out - SSO only)
  // const handleLogin = async (e: React.FormEvent) => {
  //   e.preventDefault()
  //   setLoading(true)

  //   try {
  //     const { data, error } = await supabase.auth.signInWithPassword({
  //       email,
  //       password,
  //     })

  //     if (error) throw error

  //     if (data.user) {
  //       onLogin(data.user.id)
  //     }
  //   } catch (err: any) {
  //     showError(err.message || 'Failed to login')
  //   } finally {
  //     setLoading(false)
  //   }
  // }

  const handleMicrosoftLogin = async () => {
    try {
      setSsoLoading(true)
      
      // Get callback URL from current URL or sessionStorage
      const currentCallbackUrl = callbackUrl || sessionStorage.getItem('oauth_callback_url')
      
      // Ensure callback URL is stored in sessionStorage
      if (currentCallbackUrl) {
        sessionStorage.setItem('oauth_callback_url', currentCallbackUrl)
        console.log('Initiating OAuth with callback URL:', currentCallbackUrl)
      }
      
      // Get the current origin for redirect URL
      // Include callback parameter if present (for Electron app)
      // This ensures the callback URL is preserved even if sessionStorage fails
      const callbackParam = currentCallbackUrl ? `?callback=${encodeURIComponent(currentCallbackUrl)}` : ''
      const redirectUrl = `${window.location.origin}/auth/callback${callbackParam}`
      
      console.log('OAuth redirect URL:', redirectUrl)
      
      // Check if tenant URL is configured in environment variables
      const azureTenantUrl = import.meta.env.VITE_AZURE_TENANT_URL || import.meta.env.NEXT_PUBLIC_AZURE_TENANT_URL
      
      const oauthOptions: any = {
        scopes: 'email',
        redirectTo: redirectUrl,
      }

      // If tenant URL is provided via env var, add it to query params
      // Note: The tenant URL should primarily be configured in Supabase Dashboard
      // This is just a fallback if needed
      if (azureTenantUrl) {
        oauthOptions.queryParams = {
          domain_hint: azureTenantUrl.includes('tenant') ? azureTenantUrl.split('/').pop() : undefined
        }
      }
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: oauthOptions,
      })

      if (error) throw error

      // The redirect will happen automatically, so we don't need to do anything else here
    } catch (err: any) {
      setSsoLoading(false)
      // Provide more helpful error messages for common Azure issues
      if (err.message?.includes('AADSTS50194') || err.message?.includes('multi-tenant')) {
        showError('Azure authentication is not properly configured. Please configure the Azure Tenant URL in Supabase Dashboard under Authentication > Providers > Azure.')
      } else if (err.message?.includes('AADSTS9002325') || err.message?.includes('PKCE')) {
        showError('PKCE is required for Azure authentication. This should be handled automatically. Please check your Supabase configuration.')
      } else {
        showError(err.message || 'Failed to initiate Microsoft login')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img 
              src="/mechlin-logo.svg" 
              alt="Mechlin Logo" 
              className="h-16 w-auto"
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">TimeFlow</h1>
          <p className="text-gray-600 dark:text-gray-300">Sign in to your account</p>
        </div>

        {/* Email/Password login form (commented out - SSO only) */}
        {/* <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || ssoLoading}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white py-3 rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 dark:hover:from-blue-600 dark:hover:to-purple-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                Or continue with
              </span>
            </div>
          </div> */}

          <button
            onClick={handleMicrosoftLogin}
            disabled={ssoLoading}
            className="w-full flex items-center justify-center space-x-3 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ssoLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
                <span>Connecting to Microsoft...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
                  <rect x="12" y="0" width="10" height="10" fill="#7FBA00"/>
                  <rect x="0" y="12" width="10" height="10" fill="#00A4EF"/>
                  <rect x="12" y="12" width="10" height="10" fill="#FFB900"/>
                </svg>
                <span>Sign in with Microsoft</span>
              </>
            )}
          </button>

        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Sign in with your Microsoft account
        </p>
      </div>
    </div>
  )
}

