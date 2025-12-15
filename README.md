# Time Tracker Web Application

A professional web-based dashboard application for viewing time entries, managing attendance, projects, and team members. Built with React, TypeScript, and Supabase.

## Features

- 🎯 **Dashboard** - View recent time entries and total hours logged today
- 📅 **Attendance Management** - Track employee attendance and clock in/out times
- 📊 **Reports & Analytics** - Comprehensive reports with charts and visualizations
- 📁 **Project Management** - Manage projects, track progress, and assign team members
- 👥 **Team Members Dashboard** - View team status, activity, and assignments
- ⚙️ **Admin Panel** - User management and system settings (Admin/HR/Manager only)
- 👤 **Profile** - Manage your profile information

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **Charts**: Chart.js with react-chartjs-2
- **Icons**: Lucide React
- **Build Tool**: Vite

## Prerequisites

- Node.js 18+ and npm
- Supabase account and project

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd "Tracker new website"
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Or use the `VITE_` prefix:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Development

Run the application in development mode:

```bash
npm run dev
```

This will start the Vite dev server on http://localhost:5173

## Building for Production

Build the application for production:

```bash
npm run build
```

The built files will be in the `dist` directory. You can preview the production build with:

```bash
npm run preview
```

## Deployment to GitHub Pages

This project is configured for automatic deployment to GitHub Pages using GitHub Actions.

### Setup Instructions

1. **Enable GitHub Pages in your repository:**
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**

2. **Push to main/master branch:**
   - The workflow will automatically trigger on push to `main` or `master` branch
   - You can also manually trigger it from the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**

3. **Access your deployed site:**
   - After deployment completes, your site will be available at:
   - `https://<username>.github.io/<repository-name>/`
   - The URL will be shown in the Actions workflow output

### Manual Deployment

If you need to build locally for GitHub Pages:

```bash
# Set the base path to match your repository name
VITE_BASE_PATH=/your-repo-name/ npm run build
```

The built files in the `dist` directory can then be deployed manually to the `gh-pages` branch or uploaded via GitHub Pages settings.

### Environment Variables

For GitHub Pages deployment, make sure to set your environment variables in the GitHub repository:
- Go to **Settings** → **Secrets and variables** → **Actions**
- Add your Supabase credentials as repository secrets:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - Any other required environment variables

**Note:** If your repository name changes, update the `VITE_BASE_PATH` in `.github/workflows/deploy.yml` to match your new repository name.

## Project Structure

```
├── src/
│   ├── components/   # React components
│   │   └── Layout.tsx
│   ├── lib/          # Utilities and services
│   │   └── supabase.ts
│   ├── pages/        # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Attendance.tsx
│   │   ├── Reports.tsx
│   │   ├── ProjectManagement.tsx
│   │   ├── TeamMembers.tsx
│   │   ├── AdminPanel.tsx
│   │   ├── Profile.tsx
│   │   └── Login.tsx
│   ├── types/        # TypeScript types
│   │   └── database.ts
│   ├── App.tsx       # Main app component
│   ├── main.tsx      # React entry point
│   └── index.css     # Global styles
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## Database Schema

The application uses the following Supabase tables:
- `profiles` - User profiles and roles
- `time_entries` - Time tracking entries (viewed from external tracking app)
- `screenshots` - Screenshots linked to time entries
- `activity_logs` - Activity tracking data
- `leave_requests` - Leave management
- `notifications` - User notifications
- `employee_managers` - Manager-employee relationships

## Features Overview

### Dashboard
- Displays today's total hours worked (from time entries)
- Shows recent time entries
- Quick stats: Total hours, Active projects, Team online

### Attendance Management
- View employee attendance records
- Filter by date range (Today, This Week, Custom)
- Search employees and departments
- Export attendance reports

### Reports & Analytics
- Monthly, weekly, and daily reports
- Interactive charts (Line, Bar, Pie)
- Export to PDF, Excel, CSV
- Total hours, billable/non-billable breakdown

### Project Management
- Create and manage projects
- Track project progress and hours
- Filter by status (Active, Pending, Completed)
- Assign team members

### Team Members Dashboard
- View all team members
- See online/offline status
- Current tasks and hours worked
- Quick actions: View Profile, Message, Assign Task

### Admin Panel
- User management (Admin/HR/Manager only)
- System settings
- Permissions management
- Analytics dashboard

## License

MIT

## Author

Mechlin Technology
