/**
 * Tracker Version Management
 * 
 * This module provides functions for checking and managing tracker app versions.
 * The Electron tracker app should call checkTrackerVersion() to validate its version
 * against the required version stored in the database.
 */

import { supabase } from './supabase'

export interface TrackerVersionInfo {
  requiredVersion: string
  updateUrl: string | null
  forceUpdate: boolean
  isCompatible: boolean
  currentVersion?: string
}

/**
 * Compares two semantic versions
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0
    const part2 = parts2[i] || 0

    if (part1 < part2) return -1
    if (part1 > part2) return 1
  }

  return 0
}

/**
 * Checks if the current tracker version is compatible with the required version
 * Versions must match exactly (MAJOR.MINOR.PATCH)
 */
export function isVersionCompatible(currentVersion: string, requiredVersion: string): boolean {
  try {
    // Normalize versions (remove any leading 'v' prefix)
    const normalizedCurrent = currentVersion.replace(/^v/i, '').trim()
    const normalizedRequired = requiredVersion.replace(/^v/i, '').trim()

    // For now, we require exact match
    // In the future, we could support >= comparison for backward compatibility
    return normalizedCurrent === normalizedRequired
  } catch (error) {
    console.error('Error comparing versions:', error)
    return false
  }
}

/**
 * Fetches the required tracker version from system_settings
 * This function requires authentication (user must be logged in)
 */
export async function getRequiredTrackerVersion(): Promise<{
  requiredVersion: string
  updateUrl: string | null
  forceUpdate: boolean
} | null> {
  try {
    // Fetch all tracker-related settings
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['tracker_required_version', 'tracker_update_url', 'tracker_force_update'])

    if (error) {
      console.error('Error fetching tracker version settings:', error)
      return null
    }

    if (!data || data.length === 0) {
      console.warn('No tracker version settings found. Using defaults.')
      return {
        requiredVersion: '1.6.0',
        updateUrl: null,
        forceUpdate: false,
      }
    }

    // Parse settings
    const settingsMap: Record<string, any> = {}
    data.forEach((setting) => {
      let value = setting.setting_value
      
      // Handle JSONB values - they can be strings, numbers, booleans, or JSON strings
      if (typeof value === 'string') {
        // Try to parse if it's a JSON string (e.g., '"1.6.0"' or '{"key": "value"}')
        try {
          const parsed = JSON.parse(value)
          // If parsed result is a string, use it (removes outer quotes)
          // If it's an object/array/number/boolean, use the parsed value
          value = parsed
        } catch {
          // If parsing fails, check if it's a quoted string and remove quotes
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1)
          }
        }
      }
      
      settingsMap[setting.setting_key] = value
    })

      return {
        requiredVersion: settingsMap.tracker_required_version || '1.6.0',
        updateUrl: settingsMap.tracker_update_url || null,
        forceUpdate: settingsMap.tracker_force_update === true || settingsMap.tracker_force_update === 'true',
      }
  } catch (error) {
    console.error('Error in getRequiredTrackerVersion:', error)
    return null
  }
}

/**
 * Main function for the Electron app to check its version
 * This should be called when the app starts or when user logs in
 * 
 * @param currentVersion - The current version of the Electron app (from package.json)
 * @param userId - The authenticated user's ID (for logging)
 * @param deviceInfo - Optional device information for logging
 * @returns TrackerVersionInfo with compatibility status
 */
export async function checkTrackerVersion(
  currentVersion: string,
  userId: string,
  deviceInfo?: string
): Promise<TrackerVersionInfo> {
  try {
    // Get required version from database
    const versionSettings = await getRequiredTrackerVersion()

    if (!versionSettings) {
      // If we can't fetch settings, allow the app to continue (fail open)
      // Log this as an error
      await logVersionCheck(userId, currentVersion, null, false, 'Failed to fetch version settings', deviceInfo)
      return {
        requiredVersion: '1.6.0',
        updateUrl: null,
        forceUpdate: false,
        isCompatible: true, // Fail open
        currentVersion,
      }
    }

    const { requiredVersion, updateUrl, forceUpdate } = versionSettings
    const isCompatible = isVersionCompatible(currentVersion, requiredVersion)

    // Log the version check
    await logVersionCheck(
      userId,
      currentVersion,
      requiredVersion,
      isCompatible,
      isCompatible ? 'Version check passed' : 'Version mismatch detected',
      deviceInfo
    )

    return {
      requiredVersion,
      updateUrl,
      forceUpdate,
      isCompatible,
      currentVersion,
    }
  } catch (error) {
    console.error('Error in checkTrackerVersion:', error)
    // Fail open - allow app to continue if there's an error
    return {
      requiredVersion: '1.6.0',
      updateUrl: null,
      forceUpdate: false,
      isCompatible: true,
      currentVersion,
    }
  }
}

/**
 * Logs version check events to user_logs table
 */
async function logVersionCheck(
  userId: string,
  currentVersion: string,
  requiredVersion: string | null,
  isCompatible: boolean,
  message: string,
  deviceInfo?: string
): Promise<void> {
  try {
    await supabase.from('user_logs').insert({
      user_id: userId,
      log_type: isCompatible ? 'version_check_passed' : 'version_check_failed',
      log_message: message,
      metadata: {
        current_version: currentVersion,
        required_version: requiredVersion,
        is_compatible: isCompatible,
      },
      device_info: deviceInfo || null,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    // Don't throw - logging failures shouldn't break the version check
    console.error('Error logging version check:', error)
  }
}

/**
 * Updates the required tracker version (admin only)
 * This should be called from the admin panel
 */
export async function updateRequiredTrackerVersion(
  version: string,
  updateUrl: string | null = null,
  forceUpdate: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate version format (basic semantic versioning)
    const versionRegex = /^\d+\.\d+\.\d+$/
    if (!versionRegex.test(version)) {
      return {
        success: false,
        error: 'Invalid version format. Use semantic versioning (e.g., 1.0.0)',
      }
    }

    // Update required version
    const { error: versionError } = await supabase
      .from('system_settings')
      .upsert(
        {
          setting_key: 'tracker_required_version',
          setting_value: JSON.stringify(version),
          category: 'tracker',
          description: 'Required version of the Electron tracker app',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'setting_key' }
      )

    if (versionError) {
      return { success: false, error: versionError.message }
    }

    // Update update URL if provided
    if (updateUrl !== null) {
      const { error: urlError } = await supabase
        .from('system_settings')
        .upsert(
          {
            setting_key: 'tracker_update_url',
            setting_value: JSON.stringify(updateUrl),
            category: 'tracker',
            description: 'URL where users can download the latest version',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'setting_key' }
        )

      if (urlError) {
        return { success: false, error: urlError.message }
      }
    }

    // Update force update flag
    const { error: forceError } = await supabase
      .from('system_settings')
      .upsert(
        {
          setting_key: 'tracker_force_update',
          setting_value: JSON.stringify(forceUpdate),
          category: 'tracker',
          description: 'Force all tracker apps to update immediately',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'setting_key' }
      )

    if (forceError) {
      return { success: false, error: forceError.message }
    }

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Gets statistics about tracker versions in use
 * Returns count of users on outdated versions
 */
export async function getTrackerVersionStats(): Promise<{
  totalUsers: number
  outdatedUsers: number
  versionDistribution: Record<string, number>
} | null> {
  try {
    // Get required version
    const versionSettings = await getRequiredTrackerVersion()
    if (!versionSettings) {
      return null
    }

    // Get all unique app versions from time_entries (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: timeEntries, error } = await supabase
      .from('time_entries')
      .select('app_version, user_id')
      .not('app_version', 'is', null)
      .gte('start_time', thirtyDaysAgo.toISOString())

    if (error) {
      console.error('Error fetching version stats:', error)
      return null
    }

    // Count unique users per version
    const versionMap = new Map<string, Set<string>>()
    const allUsers = new Set<string>()

    timeEntries?.forEach((entry) => {
      if (entry.app_version && entry.user_id) {
        if (!versionMap.has(entry.app_version)) {
          versionMap.set(entry.app_version, new Set())
        }
        versionMap.get(entry.app_version)!.add(entry.user_id)
        allUsers.add(entry.user_id)
      }
    })

    // Count outdated users
    let outdatedUsers = 0
    const versionDistribution: Record<string, number> = {}

    versionMap.forEach((users, version) => {
      const userCount = users.size
      versionDistribution[version] = userCount

      if (!isVersionCompatible(version, versionSettings.requiredVersion)) {
        outdatedUsers += userCount
      }
    })

    return {
      totalUsers: allUsers.size,
      outdatedUsers,
      versionDistribution,
    }
  } catch (error) {
    console.error('Error in getTrackerVersionStats:', error)
    return null
  }
}

