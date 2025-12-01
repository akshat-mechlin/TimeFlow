# Setup Guide

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   
   Create a `.env` file in the root directory with your Supabase credentials:
   ```
   # You can use either VITE_ or NEXT_PUBLIC_ prefix (both are supported)
   NEXT_PUBLIC_SUPABASE_URL=https://yxkniwzsinqyjdqqzyjs.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4a25pd3pzaW5xeWpkcXF6eWpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4ODY2OTMsImV4cCI6MjA1MjQ2MjY5M30.9n2wAH28zZplcHDSSDquQ9dD3zXTDoNmZ69uKSUE3Pk
   ```
   
   Or use the `VITE_` prefix:
   ```
   VITE_SUPABASE_URL=https://yxkniwzsinqyjdqqzyjs.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4a25pd3pzaW5xeWpkcXF6eWpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4ODY2OTMsImV4cCI6MjA1MjQ2MjY5M30.9n2wAH28zZplcHDSSDquQ9dD3zXTDoNmZ69uKSUE3Pk
   ```
   
   **Note:** The application supports both `VITE_` and `NEXT_PUBLIC_` prefixes for compatibility. If no environment variables are set, it will use the default values from your Supabase project.

3. **Run Development Server**
   ```bash
   npm run dev
   ```

   This will start the Vite dev server on http://localhost:5173

## Building for Production

Build the application:

```bash
npm run build
```

The built files will be in the `dist` directory. You can preview the production build:

```bash
npm run preview
```

## Deployment

The `dist` folder contains the production-ready static files that can be deployed to any static hosting service:

- **Vercel**: Connect your repository and deploy
- **Netlify**: Drag and drop the `dist` folder or connect via Git
- **GitHub Pages**: Deploy the `dist` folder
- **Any web server**: Upload the `dist` folder contents

## Troubleshooting

### Port Already in Use
If port 5173 is already in use, you can change it in `vite.config.ts`:
```typescript
server: {
  port: 5174, // Change to any available port
}
```

### Supabase Connection Issues
- Verify your Supabase URL and anon key in `.env`
- Check that your Supabase project is active
- Ensure Row Level Security (RLS) policies allow your user to access the tables

## Database Setup

The application expects the following Supabase tables:
- `profiles` - User profiles
- `time_entries` - Time tracking entries (populated by external tracking app)
- `screenshots` - Screenshots (optional)
- `activity_logs` - Activity logs (optional)
- `leave_requests` - Leave management (optional)
- `notifications` - Notifications (optional)

Make sure your Supabase database has these tables with the correct schema as defined in `src/types/database.ts`.

**Note:** This application is designed to view time entries that are tracked by a separate time tracking application. Time entries are not created or modified through this web interface.
