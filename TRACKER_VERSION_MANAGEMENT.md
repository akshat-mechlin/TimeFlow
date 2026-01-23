# Tracker Version Management System

## Overview

This system provides centralized version control for the Electron tracker app. Administrators can set a required version, and the tracker app will check its version against this requirement on startup. If versions don't match, tracking is blocked, ensuring all users are on compatible versions.

## Features

- **Version Enforcement**: Block tracking if app version doesn't match required version
- **Force Update**: Option to immediately block all outdated versions
- **Update URL**: Provide download link for latest version
- **Version Statistics**: Track how many users are on outdated versions
- **Logging**: All version checks are logged to `user_logs` table

## Database Schema

### System Settings

The following settings are stored in the `system_settings` table:

- **`tracker_required_version`** (string): Required version in semantic versioning format (e.g., "1.0.0")
- **`tracker_update_url`** (string, optional): URL where users can download the latest version
- **`tracker_force_update`** (boolean): If true, all outdated versions are blocked immediately

## API Usage

### For Electron Tracker App

The Electron app should call `checkTrackerVersion()` when it starts or when the user logs in:

```typescript
import { checkTrackerVersion } from './lib/trackerVersion'

// In your Electron app startup/login code
const currentVersion = require('./package.json').version // e.g., "1.4.0"
const userId = authenticatedUser.id
const deviceInfo = `${process.platform} ${process.arch}` // e.g., "win32 x64"

const versionInfo = await checkTrackerVersion(currentVersion, userId, deviceInfo)

if (!versionInfo.isCompatible) {
  // Block tracking
  console.error(`Version mismatch! Required: ${versionInfo.requiredVersion}, Current: ${versionInfo.currentVersion}`)
  
  // Show update dialog to user
  if (versionInfo.updateUrl) {
    // Open download URL
    shell.openExternal(versionInfo.updateUrl)
  }
  
  // Prevent tracking from starting
  return
}

// Version is compatible, proceed with tracking
```

### Response Format

```typescript
interface TrackerVersionInfo {
  requiredVersion: string      // Required version (e.g., "1.0.0")
  updateUrl: string | null     // Download URL if provided
  forceUpdate: boolean         // Whether force update is enabled
  isCompatible: boolean        // Whether current version matches required
  currentVersion?: string       // The version that was checked
}
```

## Admin Panel

### Access

1. Navigate to **Admin Panel** → **System Settings** tab
2. Scroll to **Tracker Version Management** section

### Configuration

1. **Required Tracker Version**: Enter the version in semantic versioning format (MAJOR.MINOR.PATCH)
   - Example: `1.4.0`
   - This version must match exactly with the tracker app version

2. **Update Download URL**: (Optional) Provide a URL where users can download the latest version
   - Example: `https://example.com/download/tracker-latest.exe`

3. **Force Update**: Toggle to immediately block all outdated versions
   - When enabled: All apps with non-matching versions are blocked
   - When disabled: Apps can continue with a warning (future enhancement)

4. **Version Statistics**: View how many users are on each version
   - Shows total active users (last 30 days)
   - Shows count of users on outdated versions
   - Displays version distribution

### Updating Version

1. Enter the new required version
2. Optionally update the download URL
3. Toggle force update if needed
4. Click **Save Version Settings**

## Version Comparison Logic

Currently, versions must match **exactly** (MAJOR.MINOR.PATCH). For example:
- Required: `1.4.0`
- Current: `1.4.0` → ✅ Compatible
- Current: `1.4.1` → ❌ Not compatible
- Current: `1.3.0` → ❌ Not compatible

Future enhancements could support:
- `>=` comparison (allow newer versions)
- Major version enforcement only
- Version ranges

## Logging

All version checks are logged to the `user_logs` table with:
- **Log Type**: `version_check_passed` or `version_check_failed`
- **Metadata**: Contains current version, required version, and compatibility status
- **Device Info**: Platform and architecture information

Admins can view these logs in the **User Logs** tab of the Admin Panel.

## Security

- Version checks require user authentication (Supabase session)
- Settings can only be updated by admins
- Version information is stored securely in the database
- All version checks are logged for audit purposes

## Best Practices

1. **Version Format**: Always use semantic versioning (MAJOR.MINOR.PATCH)
2. **Update URL**: Provide a reliable download URL when updating versions
3. **Gradual Rollout**: Consider disabling force update initially, then enabling it after most users have updated
4. **Monitoring**: Regularly check version statistics to see adoption rates
5. **Communication**: Notify users before forcing an update

## Troubleshooting

### Version Check Fails

If version checks are failing:
1. Verify the required version format is correct (e.g., `1.0.0` not `v1.0.0`)
2. Check that the tracker app is sending the correct version string
3. Review logs in the User Logs tab for error details

### Users Can't Update

If users report they can't update:
1. Verify the update URL is correct and accessible
2. Check that force update is not blocking legitimate versions
3. Ensure the download link works from different networks

### Statistics Not Showing

If version statistics are empty:
1. Check that users have created time entries in the last 30 days
2. Verify that `app_version` is being set in `time_entries` table
3. Ensure the tracker app is sending version information

## Future Enhancements

- Support for version ranges (e.g., `>=1.4.0`)
- Automatic update notifications
- Version rollout strategies (gradual, immediate)
- Version compatibility matrix
- Rollback functionality

