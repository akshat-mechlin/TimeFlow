import { supabase } from './supabase'
import type { Database } from '../types/database'

type NotificationType = Database['public']['Tables']['notifications']['Row']['type']

interface CreateNotificationParams {
  userId: string
  title: string
  message: string
  type: NotificationType
}

/**
 * Create a notification for a user
 */
export async function createNotification({
  userId,
  title,
  message,
  type,
}: CreateNotificationParams) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        type,
        read: false,
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating notification:', error)
    throw error
  }
}

/**
 * Create a notification for leave request approval
 */
export async function notifyLeaveApproved(userId: string, leaveDetails?: string) {
  return createNotification({
    userId,
    title: 'Leave Request Approved',
    message: leaveDetails || 'Your leave request has been approved.',
    type: 'leave_approved',
  })
}

/**
 * Create a notification for leave request rejection
 */
export async function notifyLeaveRejected(userId: string, leaveDetails?: string) {
  return createNotification({
    userId,
    title: 'Leave Request Rejected',
    message: leaveDetails || 'Your leave request has been rejected.',
    type: 'leave_rejected',
  })
}

/**
 * Create a notification for new leave request (for managers/admins)
 */
export async function notifyNewLeaveRequest(managerId: string, employeeName: string, leaveDetails?: string) {
  return createNotification({
    userId: managerId,
    title: 'New Leave Request',
    message: leaveDetails || `${employeeName} has submitted a leave request.`,
    type: 'leave_request',
  })
}

/**
 * Create a time tracking notification
 */
export async function notifyTimeTracking(userId: string, message: string) {
  return createNotification({
    userId,
    title: 'Time Tracking Update',
    message,
    type: 'time_tracking',
  })
}

/**
 * Create a system notification
 */
export async function notifySystem(userId: string, title: string, message: string) {
  return createNotification({
    userId,
    title,
    message,
    type: 'system',
  })
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error marking notification as read:', error)
    throw error
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    throw error
  }
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) throw error
    return count || 0
  } catch (error) {
    console.error('Error getting unread notification count:', error)
    return 0
  }
}


