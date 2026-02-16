
# Electron App Integration Prompt

## Context

The web application (TimeFlow) has been updated with a new feature that allows administrators to control screenshot and camera capture settings per user. The following changes have been made to the shared Supabase database:

### Database Changes

1. **New fields added to `profiles` table:**
   - `enable_screenshot_capture` (BOOLEAN, NOT NULL, DEFAULT: true)
   - `enable_camera_capture` (BOOLEAN, NOT NULL, DEFAULT: true)

2. **Default behavior:**
   - Both settings default to `true` (enabled) for all users
   - Admins can toggle these settings per user through the admin panel

## Task: Integrate Capture Settings Check in Electron Tracker App

### Requirements

1. **Fetch user capture settings** from Supabase when the app starts or when user logs in
2. **Check settings before capturing screenshots** - skip if `enable_screenshot_capture` is `false`
3. **Check settings before capturing camera shots** - skip if `enable_camera_capture` is `false`
4. **Handle settings gracefully** - if settings can't be fetched, default to enabled (don't break existing functionality)
5. **Optional: Real-time updates** - subscribe to profile changes to respond immediately when admin changes settings

### Implementation Steps

#### Step 1: Create a Settings Manager/Service

Create a service or utility to manage capture settings:

```typescript
// Example: src/services/captureSettings.ts or similar

interface CaptureSettings {
  enableScreenshotCapture: boolean
  enableCameraCapture: boolean
}

class CaptureSettingsManager {
  private settings: CaptureSettings = {
    enableScreenshotCapture: true, // Default to enabled
    enableCameraCapture: true, // Default to enabled
  }
  
  private userId: string | null = null
  private settingsChannel: any = null

  // Initialize with user ID
  async initialize(userId: string) {
    this.userId = userId
    await this.fetchSettings()
    this.setupRealtimeSubscription()
  }

  // Fetch settings from Supabase
  async fetchSettings(): Promise<CaptureSettings> {
    if (!this.userId) {
      return this.settings
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('enable_screenshot_capture, enable_camera_capture')
        .eq('id', this.userId)
        .single()

      if (error) {
        console.error('Error fetching capture settings:', error)
        // Return default (enabled) settings on error
        return this.settings
      }

      this.settings = {
        enableScreenshotCapture: data.enable_screenshot_capture ?? true,
        enableCameraCapture: data.enable_camera_capture ?? true,
      }

      return this.settings
    } catch (error) {
      console.error('Exception fetching capture settings:', error)
      return this.settings
    }
  }

  // Get current settings (cached)
  getSettings(): CaptureSettings {
    return { ...this.settings }
  }

  // Check if screenshot capture is enabled
  canCaptureScreenshot(): boolean {
    return this.settings.enableScreenshotCapture
  }

  // Check if camera capture is enabled
  canCaptureCamera(): boolean {
    return this.settings.enableCameraCapture
  }

  // Setup real-time subscription to profile changes
  setupRealtimeSubscription() {
    if (!this.userId) return

    this.settingsChannel = supabase
      .channel(`capture-settings-${this.userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${this.userId}`,
        },
        (payload) => {
          const updatedProfile = payload.new as any
          const oldSettings = { ...this.settings }
          
          this.settings = {
            enableScreenshotCapture: updatedProfile.enable_screenshot_capture ?? true,
            enableCameraCapture: updatedProfile.enable_camera_capture ?? true,
          }

          // Notify user if settings changed
          if (oldSettings.enableScreenshotCapture !== this.settings.enableScreenshotCapture) {
            this.onScreenshotSettingChanged(this.settings.enableScreenshotCapture)
          }
          if (oldSettings.enableCameraCapture !== this.settings.enableCameraCapture) {
            this.onCameraSettingChanged(this.settings.enableCameraCapture)
          }
        }
      )
      .subscribe()

    // Refresh settings periodically as fallback (every 5 minutes)
    setInterval(() => {
      this.fetchSettings()
    }, 5 * 60 * 1000)
  }

  // Callback when screenshot setting changes
  private onScreenshotSettingChanged(enabled: boolean) {
    if (!enabled) {
      // Show notification to user
      console.log('Screenshot capture has been disabled by administrator')
      // You can show a system notification here
      // e.g., showNotification('Screenshot capture disabled by admin')
    } else {
      console.log('Screenshot capture has been enabled by administrator')
    }
  }

  // Callback when camera setting changes
  private onCameraSettingChanged(enabled: boolean) {
    if (!enabled) {
      // Show notification to user
      console.log('Camera capture has been disabled by administrator')
      // You can show a system notification here
      // e.g., showNotification('Camera capture disabled by admin')
    } else {
      console.log('Camera capture has been enabled by administrator')
    }
  }

  // Cleanup
  cleanup() {
    if (this.settingsChannel) {
      supabase.removeChannel(this.settingsChannel)
      this.settingsChannel = null
    }
  }
}

// Export singleton instance
export const captureSettingsManager = new CaptureSettingsManager()
```

#### Step 2: Initialize Settings on App Start/Login

```typescript
// In your main app initialization or login handler

import { captureSettingsManager } from './services/captureSettings'

// After user logs in and you have the user ID
async function onUserLogin(userId: string) {
  // ... existing login logic ...
  
  // Initialize capture settings
  await captureSettingsManager.initialize(userId)
  
  // ... rest of initialization ...
}

// On app shutdown
function onAppShutdown() {
  captureSettingsManager.cleanup()
}
```

#### Step 3: Update Screenshot Capture Logic

Find where you capture screenshots and add the check:

```typescript
// In your screenshot capture function

import { captureSettingsManager } from './services/captureSettings'

async function captureScreenshot() {
  // Check if screenshot capture is enabled
  if (!captureSettingsManager.canCaptureScreenshot()) {
    console.log('Screenshot capture is disabled for this user')
    return // Skip screenshot capture
  }

  // Proceed with your existing screenshot capture logic
  // ... your screenshot capture code ...
  
  // Example:
  // const screenshot = await takeScreenshot()
  // await uploadScreenshot(screenshot)
  // etc.
}
```

#### Step 4: Update Camera Capture Logic

Find where you capture camera shots and add the check:

```typescript
// In your camera capture function

import { captureSettingsManager } from './services/captureSettings'

async function captureCameraShot() {
  // Check if camera capture is enabled
  if (!captureSettingsManager.canCaptureCamera()) {
    console.log('Camera capture is disabled for this user')
    return // Skip camera capture
  }

  // Proceed with your existing camera capture logic
  // ... your camera capture code ...
  
  // Example:
  // const cameraShot = await takeCameraPhoto()
  // await uploadCameraShot(cameraShot)
  // etc.
}
```

#### Step 5: Update Periodic Capture Loops

If you have intervals/timers that capture screenshots/camera shots:

```typescript
// Example: If you have a setInterval for periodic captures

setInterval(async () => {
  // Check settings before each capture
  if (captureSettingsManager.canCaptureScreenshot()) {
    await captureScreenshot()
  }
  
  if (captureSettingsManager.canCaptureCamera()) {
    await captureCameraShot()
  }
}, captureInterval)
```

### Database Query Reference

The settings are stored in the `profiles` table:

```sql
SELECT enable_screenshot_capture, enable_camera_capture 
FROM profiles 
WHERE id = '<user_id>'
```

### TypeScript Types (if using Supabase client)

If you're using Supabase TypeScript client, you can use the generated types:

```typescript
import type { Database } from './types/database'

type Profile = Database['public']['Tables']['profiles']['Row']

const { data: profile } = await supabase
  .from('profiles')
  .select('enable_screenshot_capture, enable_camera_capture')
  .eq('id', userId)
  .single()

// profile.enable_screenshot_capture (boolean)
// profile.enable_camera_capture (boolean)
```

### Error Handling Best Practices

1. **Default to Enabled**: If settings can't be fetched, default to `true` (enabled) to maintain existing behavior
2. **Log Errors**: Log errors but don't crash the app
3. **Graceful Degradation**: If Supabase is unavailable, continue with default enabled settings
4. **User Feedback**: Optionally show notifications when settings change

### Testing Checklist

- [ ] Settings are fetched on app startup/login
- [ ] Screenshot capture is skipped when `enable_screenshot_capture` is `false`
- [ ] Camera capture is skipped when `enable_camera_capture` is `false`
- [ ] Settings default to enabled if fetch fails
- [ ] Real-time updates work (if implemented)
- [ ] App doesn't crash if Supabase is unavailable
- [ ] Settings persist correctly after app restart
- [ ] Multiple capture attempts respect the settings

### Example Integration Points

Look for these patterns in your codebase:

1. **Screenshot capture functions:**
   - `captureScreenshot()`
   - `takeScreenshot()`
   - `saveScreenshot()`
   - Any function that creates screenshot files

2. **Camera capture functions:**
   - `captureCamera()`
   - `takeCameraPhoto()`
   - `saveCameraShot()`
   - Any function that accesses the camera

3. **Periodic timers:**
   - `setInterval()` calls that trigger captures
   - Scheduled tasks
   - Background workers

### Notes

- The feature is **opt-out** by default (all users have captures enabled)
- Admins control settings through the web admin panel
- Changes take effect immediately (or on next capture cycle)
- No user action required in the Electron app
- The app should handle settings gracefully without breaking existing functionality

### Questions to Consider

1. Where in your codebase do you capture screenshots?
2. Where in your codebase do you capture camera shots?
3. How do you handle user authentication/login?
4. Do you have a service/utility layer for Supabase queries?
5. Do you want real-time updates or periodic refresh?

---

**Summary**: Add checks before screenshot and camera capture operations to respect the `enable_screenshot_capture` and `enable_camera_capture` settings from the user's profile in Supabase. Default to enabled if settings can't be fetched.

