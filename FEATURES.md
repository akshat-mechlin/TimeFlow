# Features Documentation

## Overview

This Time Tracker Web Application is a comprehensive dashboard solution for viewing time entries, managing attendance, projects, and monitoring team activity. Built with modern web technologies and designed as a web application.

## Core Features

### 1. Dashboard
- **Today's Hours**: Display of hours worked today (from time entries)
- **Total Hours**: Cumulative hours tracked
- **Recent Time Entries**: List of recent time tracking entries with timestamps
- **Quick Stats**: Active projects count and team online status
- **Visual Design**: Clean, modern interface with card-based layout

**Note:** Time entries are viewed from the database but are created by a separate time tracking application.

### 2. Attendance Management
- **Employee Records**: View all employee attendance records
- **Clock In/Out Times**: Track when employees start and end their day
- **Status Indicators**: Visual indicators for Present/Absent status
- **Duration Calculation**: Automatic calculation of work duration
- **Date Filters**: Filter by Today, This Week, or Custom Date Range
- **Search Functionality**: Search by employee name or department
- **Export Reports**: Export attendance data (PDF, Excel, CSV)

### 3. Reports & Analytics
- **Multiple Report Types**: Daily, Weekly, Monthly, Project, and Team reports
- **Interactive Charts**:
  - Line chart for total hours tracked over time
  - Bar chart for weekly hours breakdown
  - Pie chart for project distribution
- **Summary Metrics**:
  - Total Hours
  - Billable vs Non-Billable Hours
  - Productive Teams count
- **Export Options**: PDF, Excel, and CSV export functionality
- **Date Range Selection**: Customizable date ranges for reports

### 4. Project Management
- **Project Cards**: Visual project cards with key information
- **Status Tracking**: Active, Pending, and Completed statuses
- **Progress Bars**: Visual progress indicators for hours spent vs. total hours
- **Deadline Tracking**: Display project deadlines
- **Team Assignment**: View assigned team members per project
- **Filtering**: Filter by status (All, Active, Pending, Completed)
- **Search**: Search projects by name or client
- **Quick Actions**: Edit and View Details buttons for each project

### 5. Team Members Dashboard
- **Team Grid**: Visual grid layout of all team members
- **Status Indicators**: Online, Offline, and Break status with color coding
- **Profile Information**: Name, role, and department
- **Activity Tracking**:
  - Last active time
  - Current task being worked on
  - Hours worked today
  - Projects assigned count
- **Quick Actions**: View Profile, Message, and Assign Task buttons
- **Advanced Filtering**: Filter by Role, Status, and Department
- **Search**: Search team members by name or role

### 6. Admin Panel
- **Access Control**: Restricted to Admin, HR, and Manager roles
- **User Management**: Add, edit, and manage users
- **System Settings**: Configure application settings
- **Permissions Management**: Manage user roles and permissions
- **Analytics Dashboard**: System-wide analytics and insights
- **Tabbed Interface**: Organized sections for different admin functions

### 7. Profile
- **User Information**: Display and edit profile details
- **Editable Fields**:
  - Full Name
  - Email
  - Team/Department
- **Read-only Information**:
  - Role (managed by admin)
  - Member Since date
- **Avatar Display**: Initial-based avatar
- **Save Functionality**: Update profile information

## Design Features

### User Interface
- **Modern Design**: Clean, professional interface inspired by the reference images
- **Responsive Layout**: Adapts to different screen sizes
- **Color Scheme**: Blue primary color with gray accents
- **Card-based Layout**: Information organized in cards for easy scanning
- **Smooth Animations**: Fade-in animations and hover effects
- **Icon System**: Lucide React icons throughout the application

### Navigation
- **Sidebar Navigation**: Collapsible sidebar with main navigation items
- **Active State Indicators**: Clear indication of current page
- **Search Bar**: Global search functionality in header

### Data Visualization
- **Chart.js Integration**: Professional charts for data visualization
- **Color-coded Status**: Visual status indicators (green, orange, gray)
- **Progress Bars**: Visual progress indicators
- **Metrics Cards**: Key metrics displayed prominently

## Technical Features

### Authentication
- **Supabase Auth**: Secure authentication using Supabase
- **Session Management**: Automatic session handling
- **Role-based Access**: Different features based on user role

### Data Management
- **Real-time Updates**: Live data from Supabase
- **Error Handling**: Graceful error handling and user feedback
- **Loading States**: Loading indicators during data fetch
- **Read-only Time Entries**: Time entries are viewed from database but created by external app

### Performance
- **Code Splitting**: Efficient code organization
- **Optimized Queries**: Efficient database queries
- **Caching**: Client-side caching where appropriate

## Database Integration

The application integrates with Supabase and uses the following tables:
- `profiles` - User information and roles
- `time_entries` - Time tracking data (read-only, populated by external app)
- `screenshots` - Screenshot storage (optional)
- `activity_logs` - Activity tracking (optional)
- `leave_requests` - Leave management
- `notifications` - User notifications
- `employee_managers` - Manager relationships

## Security

- **Row Level Security**: Supabase RLS policies for data access
- **Environment Variables**: Sensitive data in environment variables
- **Secure Authentication**: Supabase authentication system

## Important Notes

- **Time Tracking**: This application does NOT track time. Time entries are created by a separate time tracking application and are only viewed through this dashboard.
- **Web Application**: This is a web application, not a desktop application. It runs in a web browser.
- **Deployment**: The application can be deployed to any static hosting service (Vercel, Netlify, GitHub Pages, etc.)
