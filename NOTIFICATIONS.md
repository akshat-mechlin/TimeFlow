# Notification System Documentation

This document explains how to use the in-app notification system in TimeFlow.

## Overview

The notification system provides:
- **Bell icon** in the header with unread count badge
- **Dropdown panel** showing all notifications
- **Real-time updates** when new notifications arrive
- **Automatic redirection** based on notification type
- **Mark as read** functionality

## Notification Types

The system supports the following notification types:

1. **`leave_request`** - New leave request submitted (for managers/admins)
2. **`leave_approved`** - Leave request approved
3. **`leave_rejected`** - Leave request rejected
4. **`time_tracking`** - Time tracking related notifications
5. **`system`** - System-wide notifications

## Usage Examples

### Creating Notifications

Import the notification helpers:

```typescript
import {
  createNotification,
  notifyLeaveApproved,
  notifyLeaveRejected,
  notifyNewLeaveRequest,
  notifyTimeTracking,
  notifySystem,
} from '../lib/notifications'
```

### Example 1: Notify Leave Approval

```typescript
// When a leave request is approved
await notifyLeaveApproved(
  userId,
  `Your leave request from ${startDate} to ${endDate} has been approved.`
)
```

### Example 2: Notify Leave Rejection

```typescript
// When a leave request is rejected
await notifyLeaveRejected(
  userId,
  `Your leave request from ${startDate} to ${endDate} has been rejected. Reason: ${reason}`
)
```

### Example 3: Notify Manager of New Leave Request

```typescript
// When an employee submits a leave request
const managerId = employee.manager_id
if (managerId) {
  await notifyNewLeaveRequest(
    managerId,
    employee.full_name,
    `${employee.full_name} has submitted a leave request from ${startDate} to ${endDate}.`
  )
}
```

### Example 4: Time Tracking Notification

```typescript
// When time tracking needs attention
await notifyTimeTracking(
  userId,
  'You have not logged any time entries today. Please start tracking your time.'
)
```

### Example 5: System Notification

```typescript
// For system-wide announcements
await notifySystem(
  userId,
  'System Maintenance',
  'Scheduled maintenance will occur on Saturday, 10 PM - 12 AM.'
)
```

### Example 6: Custom Notification

```typescript
// For custom notifications
await createNotification({
  userId: 'user-id',
  title: 'Project Assignment',
  message: 'You have been assigned to a new project: Project Name',
  type: 'system', // or any other type
})
```

## Integration Points

### 1. Leave Management System

If you have a leave management system (HRMS), add notifications when:

```typescript
// In your leave approval handler
async function approveLeaveRequest(leaveRequestId: string, approverId: string) {
  // ... your approval logic ...
  
  // Get leave request details
  const { data: leaveRequest } = await supabase
    .from('leave_requests')
    .select('*, profiles(full_name)')
    .eq('id', leaveRequestId)
    .single()
  
  if (leaveRequest) {
    // Notify the employee
    await notifyLeaveApproved(
      leaveRequest.user_id,
      `Your leave request from ${leaveRequest.start_date} to ${leaveRequest.end_date} has been approved.`
    )
  }
}
```

### 2. Project Management

Notify team members when assigned to projects:

```typescript
// When adding members to a project
async function addProjectMembers(projectId: string, memberIds: string[]) {
  // ... your logic to add members ...
  
  // Notify each member
  for (const memberId of memberIds) {
    await notifySystem(
      memberId,
      'Project Assignment',
      `You have been added to project: ${projectName}`
    )
  }
}
```

### 3. Admin Actions

Notify users when admins make changes:

```typescript
// When admin updates user role
async function updateUserRole(userId: string, newRole: string) {
  // ... your update logic ...
  
  await notifySystem(
    userId,
    'Role Updated',
    `Your role has been updated to ${newRole}.`
  )
}
```

### 4. Time Tracking Alerts

Notify users about time tracking issues:

```typescript
// Check for missing time entries
async function checkMissingTimeEntries() {
  const today = new Date().toISOString().split('T')[0]
  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name')
  
  for (const user of users || []) {
    const { data: entries } = await supabase
      .from('time_entries')
      .select('id')
      .eq('user_id', user.id)
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`)
    
    if (!entries || entries.length === 0) {
      await notifyTimeTracking(
        user.id,
        `You haven't logged any time entries for today (${today}). Please start tracking your time.`
      )
    }
  }
}
```

## Database Triggers (Optional)

You can also create database triggers to automatically send notifications. Here's an example SQL trigger:

```sql
-- Example: Trigger to notify when leave request status changes
CREATE OR REPLACE FUNCTION notify_leave_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    INSERT INTO notifications (user_id, title, message, type, read)
    VALUES (
      NEW.user_id,
      'Leave Request Approved',
      'Your leave request has been approved.',
      'leave_approved',
      false
    );
  ELSIF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
    INSERT INTO notifications (user_id, title, message, type, read)
    VALUES (
      NEW.user_id,
      'Leave Request Rejected',
      'Your leave request has been rejected.',
      'leave_rejected',
      false
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_status_change_trigger
AFTER UPDATE ON leave_requests
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION notify_leave_status_change();
```

## Notification Redirection

The notification system automatically redirects users when they click on notifications:

- **`leave_request`**, **`leave_approved`**, **`leave_rejected`** → `/attendance`
- **`time_tracking`** → `/` (Dashboard)
- **`system`** → No redirection (or customize as needed)

## Real-time Updates

The notification system uses Supabase real-time subscriptions to automatically update when:
- New notifications are created
- Notifications are marked as read
- Notifications are updated

No manual refresh is needed!

## Best Practices

1. **Keep messages concise** - Notifications should be brief and actionable
2. **Include relevant details** - Add dates, names, or other context when helpful
3. **Use appropriate types** - Choose the right notification type for proper redirection
4. **Don't spam** - Avoid creating too many notifications for the same event
5. **Handle errors gracefully** - Notification creation failures shouldn't break your main flow

## Testing

To test the notification system:

1. Create a test notification:
```typescript
await notifySystem(
  'your-user-id',
  'Test Notification',
  'This is a test notification to verify the system is working.'
)
```

2. Check the bell icon in the header - it should show a badge with count "1"
3. Click the bell icon to see the notification dropdown
4. Click on the notification to test redirection
5. Mark notifications as read to test the read/unread functionality





