# Copy-Paste Prompt for Electron Repo

## Prompt to Use

```
I need to integrate screenshot and camera capture settings from Supabase into the Electron tracker app.

CONTEXT:
- The Supabase database has been updated with two new fields in the `profiles` table:
  - `enable_screenshot_capture` (BOOLEAN, default: true)
  - `enable_camera_capture` (BOOLEAN, default: true)
- Admins can control these settings per user through the web admin panel
- Both default to `true` (enabled) for all users

REQUIREMENTS:
1. Fetch user capture settings from Supabase when app starts or user logs in
2. Before capturing screenshots, check if `enable_screenshot_capture` is true - skip if false
3. Before capturing camera shots, check if `enable_camera_capture` is true - skip if false
4. If settings can't be fetched, default to enabled (don't break existing functionality)
5. Optionally: Subscribe to real-time profile updates to respond immediately to admin changes

IMPLEMENTATION NEEDED:
- Create a settings manager/service to fetch and cache capture settings
- Add checks in screenshot capture functions to respect `enable_screenshot_capture`
- Add checks in camera capture functions to respect `enable_camera_capture`
- Handle errors gracefully (default to enabled if fetch fails)
- Initialize settings on user login/app start

QUERY EXAMPLE:
```typescript
const { data } = await supabase
  .from('profiles')
  .select('enable_screenshot_capture, enable_camera_capture')
  .eq('id', userId)
  .single()
```

Please:
1. Find all screenshot capture functions in the codebase
2. Find all camera capture functions in the codebase
3. Add the settings checks before each capture operation
4. Create a reusable settings manager/service
5. Initialize it on app start/login
6. Ensure graceful error handling (default to enabled)
```

## Additional Context (if needed)

If you need more details, refer to:
- `ELECTRON_APP_INTEGRATION_PROMPT.md` - Full detailed implementation guide
- `SCREENSHOT_CAMERA_CAPTURE_WORKFLOW.md` - Complete workflow documentation

