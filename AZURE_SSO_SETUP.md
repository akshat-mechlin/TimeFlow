# Microsoft Azure SSO Setup Guide

## Production Deployment

**Production Domain:** `https://newtracker.mechlintech.com`

### Important Configuration Steps for Production:

1. **Supabase Dashboard - Redirect URLs:**
   - Go to Supabase Dashboard > Authentication > URL Configuration
   - Add: `https://newtracker.mechlintech.com/auth/callback`
   - Keep: `http://localhost:5173/auth/callback` for local development

2. **Azure App Registration - Redirect URI:**
   - The redirect URI in Azure should **always** point to Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
   - **Do NOT** add your website domain (`newtracker.mechlintech.com`) as a redirect URI in Azure
   - Supabase handles the OAuth flow and redirects to your website

3. **Code Configuration:**
   - The code automatically uses `window.location.origin` for redirects, so no code changes are needed
   - The website will work on any domain once deployed

4. **Electron App Integration:**
   - Update your Electron app to use: `https://newtracker.mechlintech.com?callback=<callback-url>`
   - For local development, continue using: `http://localhost:5173?callback=<callback-url>`

## Common Errors and Solutions

### Error: AADSTS50194 - Application is not configured as multi-tenant

If you're seeing this error, it means your Azure application is configured as **single-tenant** (My organization only), but Supabase is trying to use the `/common` endpoint which only works for multi-tenant applications.

### Error: AADSTS9002325 - PKCE is required

If you're seeing this error, it means Azure AD requires PKCE (Proof Key for Code Exchange) for the OAuth flow. This is automatically handled by Supabase, but ensure:

1. Your Supabase client is configured with `flowType: 'pkce'` (already done in the code)
2. The callback handler properly exchanges the authorization code using `exchangeCodeForSession()` (already implemented)
3. Your redirect URL is correctly configured in both Azure and Supabase

## Solution Options

You have **two options** to fix this:

### Option 1: Configure Tenant URL in Supabase (Recommended)

This is the recommended approach if you want to keep your Azure app as single-tenant.

1. **Get your Azure Tenant ID:**
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to **Microsoft Entra ID** > **Overview**
   - Copy your **Tenant ID** (it looks like: `12345678-1234-1234-1234-123456789012`)

2. **Configure in Supabase Dashboard:**
   - Go to your Supabase project dashboard
   - Navigate to **Authentication** > **Providers**
   - Find **Azure** in the list and click to configure
   - In the **Azure Tenant URL** field, enter:
     ```
     https://login.microsoftonline.com/<your-tenant-id>
     ```
     Replace `<your-tenant-id>` with your actual Tenant ID
   - Click **Save**

3. **Verify your Azure App Registration:**
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to **Microsoft Entra ID** > **App registrations**
   - Select your application (Mechlin TimeFlow)
   - Go to **Authentication**
   - Under **Redirect URIs**, make sure you have:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
     Replace `<your-project-ref>` with your Supabase project reference
     **Important:** This should be your Supabase callback URL, not your website URL

### Option 2: Make Azure App Multi-Tenant

If you want to allow users from any Azure AD tenant to sign in:

1. **Update Azure App Registration:**
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to **Microsoft Entra ID** > **App registrations**
   - Select your application (Mechlin TimeFlow)
   - Click **Authentication** in the left sidebar
   - Under **Supported account types**, select:
     - **Accounts in any organizational directory (Any Azure AD directory - Multitenant)**
   - Click **Save**

2. **No Supabase Configuration Needed:**
   - If you make the app multi-tenant, Supabase will automatically use the `/common` endpoint
   - You don't need to configure a tenant URL in Supabase

## Complete Azure App Setup Checklist

### 1. Create App Registration
- [ ] Go to Azure Portal > Microsoft Entra ID > App registrations
- [ ] Click **New registration**
- [ ] Enter name: `Mechlin TimeFlow` (or your preferred name)
- [ ] Select supported account types (single-tenant or multi-tenant)
- [ ] Add redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- [ ] Click **Register**

**Note:** The redirect URI in Azure should always point to your Supabase project's callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`), not your website's domain. Supabase handles the OAuth flow and then redirects to your website.

### 2. Get Client ID and Secret
- [ ] Copy the **Application (client) ID** from the Overview page
- [ ] Go to **Certificates & secrets**
- [ ] Click **New client secret**
- [ ] Add description and expiration
- [ ] Copy the **Value** (not the Secret ID) - you'll only see it once!

### 3. Configure in Supabase
- [ ] Go to Supabase Dashboard > Authentication > Providers
- [ ] Enable **Azure** provider
- [ ] Enter **Client ID** from Azure
- [ ] Enter **Client Secret** from Azure
- [ ] If single-tenant, enter **Azure Tenant URL**: `https://login.microsoftonline.com/<tenant-id>`
- [ ] Click **Save**

### 4. Add Redirect URLs in Supabase
- [ ] Go to Supabase Dashboard > Authentication > URL Configuration
- [ ] Add redirect URL: `http://localhost:5173/auth/callback` (for local dev)
- [ ] Add redirect URL: `https://newtracker.mechlintech.com/auth/callback` (for production)

## Testing

After configuration:
1. Try signing in with Microsoft on your login page
2. You should be redirected to Microsoft login
3. After authentication, you'll be redirected back to your app
4. A user profile will be automatically created if it doesn't exist

## Troubleshooting

### Error: "Application is not configured as multi-tenant"
- **Solution**: Follow Option 1 above to configure the tenant URL in Supabase

### Error: "Redirect URI mismatch"
- **Solution**: Make sure the redirect URI in Azure matches exactly: `https://<project-ref>.supabase.co/auth/v1/callback`

### Error: "Invalid client secret"
- **Solution**: Generate a new client secret in Azure and update it in Supabase

### Users not being created
- **Solution**: Check that the `profiles` table has proper RLS policies allowing inserts
- Check browser console for any errors during profile creation

## Electron App Integration

This website supports integration with an Electron desktop application that uses the same Azure SSO authentication. It supports both custom protocol URLs and HTTP callback URLs.

### How It Works

1. **Electron App Initiates Login:**
   - Electron app opens the system browser to: `https://newtracker.mechlintech.com?callback=<callback-url>` (production) or `http://localhost:5173?callback=<callback-url>` (local dev)
   - The `callback` parameter can be:
     - Custom protocol URL: `tracker://callback`
     - HTTP URL: `http://localhost:5174/callback`

2. **Website Handles OAuth:**
   - The website reads the `callback` parameter from the URL query string
   - Stores it in sessionStorage to persist through OAuth redirects
   - Initiates Azure OAuth authentication flow

3. **After Successful Authentication:**
   - Website exchanges the authorization code for access and refresh tokens
   - Redirects to the callback URL with tokens using **query parameters** (not hash fragments)
   - For custom protocol: `tracker://callback?access_token=...&refresh_token=...`
   - For HTTP URL: `http://localhost:5174/callback?access_token=...&refresh_token=...`

4. **Electron App Receives Tokens:**
   - **Custom Protocol**: Electron intercepts the `tracker://` protocol handler and extracts tokens
   - **HTTP URL**: Electron's HTTP server reads tokens from query parameters
   - Uses these tokens to authenticate the user in the Electron app

### Important Notes

- **Query Parameters Required**: The website uses query parameters (not hash fragments) for token transmission because HTTP servers need to read them from the URL
- **Both URL Types Supported**: The implementation automatically detects and handles both custom protocol URLs and HTTP URLs
- **Error Handling**: If authentication fails, errors are also passed via query parameters to the callback URL

### Implementation Details

The website automatically:
- Detects the `callback` query parameter on the login page
- Preserves it through the OAuth redirect flow
- Redirects to the callback URL with tokens after successful authentication
- Handles errors by redirecting to the callback URL with an error parameter

### Testing Electron Integration

#### Option 1: Custom Protocol (tracker://)

**For Production:**
1. Deploy your website to `https://newtracker.mechlintech.com`
2. From your Electron app, open: `https://newtracker.mechlintech.com?callback=tracker://callback`
3. Click "Sign in with Microsoft"
4. Complete the Azure authentication
5. You should be redirected back to `tracker://callback?access_token=...&refresh_token=...`

**For Local Development:**
1. Start your website on `http://localhost:5173`
2. From your Electron app, open: `http://localhost:5173?callback=tracker://callback`
3. Click "Sign in with Microsoft"
4. Complete the Azure authentication
5. You should be redirected back to `tracker://callback?access_token=...&refresh_token=...`

#### Option 2: HTTP Callback (http://localhost:5174/callback)

**For Production:**
1. Deploy your website to `https://newtracker.mechlintech.com`
2. Start your Electron app's HTTP server on `http://localhost:5174`
3. From your Electron app, open: `https://newtracker.mechlintech.com?callback=http://localhost:5174/callback`
4. Click "Sign in with Microsoft"
5. Complete the Azure authentication
6. You should be redirected to `http://localhost:5174/callback?access_token=...&refresh_token=...`
7. Your Electron HTTP server reads the tokens from query parameters

**For Local Development:**
1. Start your website on `http://localhost:5173`
2. Start your Electron app's HTTP server on `http://localhost:5174`
3. From your Electron app, open: `http://localhost:5173?callback=http://localhost:5174/callback`
4. Click "Sign in with Microsoft"
5. Complete the Azure authentication
6. You should be redirected to `http://localhost:5174/callback?access_token=...&refresh_token=...`
7. Your Electron HTTP server reads the tokens from query parameters

### Custom Protocol Setup

If using a custom protocol (e.g., `tracker://`), make sure your Electron app has registered the protocol handler:

```javascript
// In Electron main process
app.setAsDefaultProtocolClient('tracker')

app.on('open-url', (event, url) => {
  // Parse the URL and extract tokens from query parameters
  const urlObj = new URL(url)
  const accessToken = urlObj.searchParams.get('access_token')
  const refreshToken = urlObj.searchParams.get('refresh_token')
  const error = urlObj.searchParams.get('error')
  
  if (error) {
    // Handle authentication error
    console.error('Auth error:', error)
  } else if (accessToken && refreshToken) {
    // Use tokens to authenticate user
    authenticateUser(accessToken, refreshToken)
  }
})
```

### HTTP Server Setup

If using an HTTP callback URL, your Electron app should run an HTTP server:

```javascript
// In Electron main process
const http = require('http')

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/callback')) {
    // Parse query parameters from URL
    const urlObj = new URL(req.url, 'http://localhost:5174')
    const accessToken = urlObj.searchParams.get('access_token')
    const refreshToken = urlObj.searchParams.get('refresh_token')
    const error = urlObj.searchParams.get('error')
    
    if (error) {
      // Handle authentication error
      console.error('Auth error:', error)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>Authentication Error</h1><p>' + error + '</p></body></html>')
    } else if (accessToken && refreshToken) {
      // Use tokens to authenticate user
      authenticateUser(accessToken, refreshToken)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>Authentication Successful</h1><p>You can close this window.</p></body></html>')
    }
  }
})

server.listen(5174, () => {
  console.log('HTTP server listening on http://localhost:5174')
})
```

## Additional Resources

- [Supabase Azure Auth Documentation](https://supabase.com/docs/guides/auth/social-login/auth-azure)
- [Azure App Registration Guide](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- [Electron Protocol Handler Documentation](https://www.electronjs.org/docs/latest/api/protocol)

