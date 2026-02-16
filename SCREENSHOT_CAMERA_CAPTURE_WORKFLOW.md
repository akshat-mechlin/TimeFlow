# Screenshot & Camera Capture Configuration Workflow

## Overview

This feature allows administrators to control per-user screenshot and camera capture settings for the Electron tracker app. Admins can enable/disable screenshot and camera capture independently for each user through the admin panel.

## Database Schema

### New Fields in `profiles` Table

Two new boolean fields have been added to the `profiles` table:

- **`enable_screenshot_capture`** (BOOLEAN, NOT NULL, DEFAULT: true)
  - Controls whether the tracker app should capture screenshots for this user
  - Default: `true` (enabled for all users by default)

- **`enable_camera_capture`** (BOOLEAN, NOT NULL, DEFAULT: true)
  - Controls whether the tracker app should capture camera shots for this user
  - Default: `true` (enabled for all users by default)

### Migration Applied

The migration `add_screenshot_camera_capture_settings` has been applied, which:
1. Adds the two new columns to the `profiles` table
2. Sets default values to `true` for all existing users
3. Creates indexes for faster queries
4. Adds helpful comments to the columns

## Admin Panel Workflow

### Access
- Only users with `role = 'admin'` can access the admin panel
- Navigate to: Admin Panel → User Management tab

### User Interface

1. **User Table Display**
   - A new "Capture Settings" column has been added to the user management table
   - Each user row displays two toggle switches:
     - **Screenshot Toggle** (Monitor icon) - Controls screenshot capture
     - **Camera Toggle** (Camera icon) - Controls camera capture

2. **Toggle Functionality**
   - Toggles are immediately active (no save button needed)
   - Changes are saved to the database in real-time
   - Success/error notifications are shown after each toggle
   - The UI updates immediately to reflect the change

3. **Visual Indicators**
   - **Green/Blue toggle (ON)**: Capture is enabled
   - **Gray toggle (OFF)**: Capture is disabled
   - Text label shows "On" or "Off" next to each toggle

### Admin Actions

1. **Enable Screenshot Capture for a User**
   - Find the user in the table
   - Toggle the Screenshot switch to ON (right position)
   - The tracker app will start capturing screenshots for this user

2. **Disable Screenshot Capture for a User**
   - Find the user in the table
   - Toggle the Screenshot switch to OFF (left position)
   - The tracker app will stop capturing screenshots for this user

3. **Enable Camera Capture for a User**
   - Find the user in the table
   - Toggle the Camera switch to ON (right position)
   - The tracker app will start capturing camera shots for this user

4. **Disable Camera Capture for a User**
   - Find the user in the table
   - Toggle the Camera switch to OFF (left position)
   - The tracker app will stop capturing camera shots for this user

### Default Behavior

- **New Users**: When a new user is created, both settings default to `true` (enabled)
- **Existing Users**: All existing users have both settings set to `true` by default
- **No Configuration Required**: The feature works out-of-the-box with all captures enabled

## Electron Tracker App Integration

### How It Should Work

The Electron tracker app needs to check these settings before capturing screenshots or camera shots.

### Implementation Steps

#### 1. Fetch User Settings on App Start

```typescript
// Example: Fetch user profile with capture settings
const { data: profile, error } = await supabase
  .from('profiles')
  .select('enable_screenshot_capture, enable_camera_capture')
  .eq('id', userId)
  .single()

if (error) {
  console.error('Error fetching capture settings:', error)
  // Default to enabled if fetch fails
  return {
    enableScreenshotCapture: true,
    enableCameraCapture: true
  }
}

return {
  enableScreenshotCapture: profile.enable_screenshot_capture ?? true,
  enableCameraCapture: profile.enable_camera_capture ?? true
}
```

#### 2. Check Settings Before Capturing Screenshots

```typescript
// Before taking a screenshot
async function captureScreenshot() {
  // Fetch current settings (or use cached settings)
  const settings = await getUserCaptureSettings()
  
  if (!settings.enableScreenshotCapture) {
    console.log('Screenshot capture is disabled for this user')
    return // Skip screenshot capture
  }
  
  // Proceed with screenshot capture
  // ... your screenshot capture logic
}
```

#### 3. Check Settings Before Capturing Camera Shots

```typescript
// Before taking a camera shot
async function captureCameraShot() {
  // Fetch current settings (or use cached settings)
  const settings = await getUserCaptureSettings()
  
  if (!settings.enableCameraCapture) {
    console.log('Camera capture is disabled for this user')
    return // Skip camera capture
  }
  
  // Proceed with camera capture
  // ... your camera capture logic
}
```

#### 4. Real-time Settings Updates (Recommended)

To respond immediately to admin changes, subscribe to profile updates:

```typescript
// Subscribe to profile changes
const channel = supabase
  .channel('user-capture-settings')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'profiles',
      filter: `id=eq.${userId}`
    },
    (payload) => {
      const updatedProfile = payload.new as Profile
      // Update local settings cache
      updateCaptureSettings({
        enableScreenshotCapture: updatedProfile.enable_screenshot_capture ?? true,
        enableCameraCapture: updatedProfile.enable_camera_capture ?? true
      })
      
      // Optionally show notification to user
      if (!updatedProfile.enable_screenshot_capture) {
        showNotification('Screenshot capture has been disabled by administrator')
      }
      if (!updatedProfile.enable_camera_capture) {
        showNotification('Camera capture has been disabled by administrator')
      }
    }
  )
  .subscribe()

// Cleanup on app close
return () => {
  supabase.removeChannel(channel)
}
```

#### 5. Periodic Settings Refresh (Alternative)

If real-time updates aren't needed, refresh settings periodically:

```typescript
// Refresh settings every 5 minutes
setInterval(async () => {
  const settings = await getUserCaptureSettings()
  updateCaptureSettings(settings)
}, 5 * 60 * 1000) // 5 minutes
```

### Best Practices

1. **Cache Settings**: Store settings in memory/local storage to avoid frequent database queries
2. **Default to Enabled**: If settings can't be fetched, default to enabled (safer)
3. **Handle Errors Gracefully**: Don't crash if settings can't be fetched
4. **Log Changes**: Log when capture is skipped due to settings
5. **User Notification**: Optionally notify users when their capture settings change

## API Usage Examples

### Query User Capture Settings

```typescript
// Get settings for current user
const { data, error } = await supabase
  .from('profiles')
  .select('enable_screenshot_capture, enable_camera_capture')
  .eq('id', userId)
  .single()
```

### Update Settings (Admin Only)

```typescript
// Update screenshot capture setting
const { error } = await supabase
  .from('profiles')
  .update({ 
    enable_screenshot_capture: false,
    updated_at: new Date().toISOString()
  })
  .eq('id', userId)

// Update camera capture setting
const { error } = await supabase
  .from('profiles')
  .update({ 
    enable_camera_capture: false,
    updated_at: new Date().toISOString()
  })
  .eq('id', userId)
```

### Bulk Operations

```typescript
// Disable screenshot capture for all users in a team
const { error } = await supabase
  .from('profiles')
  .update({ 
    enable_screenshot_capture: false,
    updated_at: new Date().toISOString()
  })
  .eq('team', 'Engineering')
```

## Security Considerations

1. **RLS Policies**: Ensure Row Level Security (RLS) policies allow:
   - Users to read their own profile (including capture settings)
   - Admins to read and update all profiles
   - Tracker app to read user's own profile

2. **Admin Access**: Only admins should be able to modify these settings through the admin panel

3. **Default Behavior**: Defaulting to `true` ensures no data loss if settings can't be fetched

## Testing Checklist

- [ ] Admin can toggle screenshot capture for a user
- [ ] Admin can toggle camera capture for a user
- [ ] Changes are saved immediately
- [ ] UI updates reflect changes in real-time
- [ ] New users have both settings enabled by default
- [ ] Electron app respects disabled screenshot capture
- [ ] Electron app respects disabled camera capture
- [ ] Electron app handles settings fetch errors gracefully
- [ ] Real-time updates work (if implemented)
- [ ] Settings persist after app restart

## Troubleshooting

### Settings Not Updating in Tracker App

1. Check if the tracker app is fetching settings on startup
2. Verify the user ID matches between admin panel and tracker app
3. Check Supabase connection in tracker app
4. Verify RLS policies allow reading the profile

### Toggle Not Working in Admin Panel

1. Check browser console for errors
2. Verify admin role permissions
3. Check Supabase connection
4. Verify RLS policies allow updating profiles

### Default Values Not Applied

1. Check migration was applied successfully
2. Verify default values in database schema
3. Check if new user creation includes default values

## Future Enhancements

Potential improvements:
- Bulk enable/disable for multiple users
- Team-level default settings
- Schedule-based capture (e.g., only during work hours)
- Capture frequency settings
- Notification when settings change
- Audit log of setting changes

