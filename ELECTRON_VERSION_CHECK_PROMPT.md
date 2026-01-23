# Electron Tracker App - Version Check Integration

## Quick Integration Guide

Your Electron tracker app needs to check its version against the required version stored in Supabase. If versions don't match, tracking must be blocked.

## Implementation Steps

### 1. Install/Import the Version Check Function

The version check functionality is available in the web app's codebase. You can either:
- Copy the `src/lib/trackerVersion.ts` file to your Electron app
- Or create a similar function that calls Supabase

### 2. Check Version on App Startup

Add this code when your app starts or when user logs in:

```typescript
import { checkTrackerVersion } from './lib/trackerVersion' // or your equivalent
import { shell } from 'electron'

async function validateTrackerVersion(userId: string) {
  const currentVersion = require('./package.json').version // e.g., "1.4.0"
  const deviceInfo = `${process.platform} ${process.arch}` // e.g., "win32 x64"
  
  try {
    const versionInfo = await checkTrackerVersion(currentVersion, userId, deviceInfo)
    
    if (!versionInfo.isCompatible) {
      // Version mismatch - block tracking
      const message = `Your tracker app version (${versionInfo.currentVersion}) does not match the required version (${versionInfo.requiredVersion}). Please update to continue tracking.`
      
      // Show error dialog
      dialog.showErrorBox('Version Mismatch', message)
      
      // Open download URL if provided
      if (versionInfo.updateUrl) {
        shell.openExternal(versionInfo.updateUrl)
      }
      
      // Prevent tracking from starting
      return false
    }
    
    // Version is compatible
    return true
  } catch (error) {
    console.error('Error checking version:', error)
    // Fail open - allow app to continue if version check fails
    // (This prevents network issues from blocking the app)
    return true
  }
}

// Call this before starting tracking
const canTrack = await validateTrackerVersion(user.id)
if (!canTrack) {
  // Exit or show update required screen
  return
}
```

### 3. Required Supabase Setup

Ensure your Electron app has:
- Supabase client configured with the same project URL and anon key
- User authentication working (user must be logged in to check version)
- Access to `system_settings` table (read access)
- Access to `user_logs` table (write access for logging)

### 4. Version Format

- Use semantic versioning: `MAJOR.MINOR.PATCH` (e.g., `1.4.0`)
- Version must match exactly with the required version in the database
- The version is stored in your `package.json` file

### 5. Error Handling

- If version check fails (network error, etc.), the function returns `isCompatible: true` (fail open)
- This prevents network issues from blocking legitimate users
- All version checks are logged to the database for monitoring

## API Response Format

```typescript
{
  requiredVersion: "1.0.0",      // Required version from database
  updateUrl: "https://...",      // Download URL (or null)
  forceUpdate: false,             // Whether force update is enabled
  isCompatible: true,             // Whether versions match
  currentVersion: "1.4.0"         // The version you sent
}
```

## Testing

1. Set required version in Admin Panel → System Settings → Tracker Version Management
2. Start your Electron app with a matching version → Should work
3. Start your Electron app with a different version → Should be blocked
4. Check User Logs in Admin Panel to see version check logs

## Notes

- Version checks are logged automatically
- Admins can view version statistics in the Admin Panel
- Force update can be enabled to immediately block all outdated versions
- Update URL is optional but recommended for better user experience

