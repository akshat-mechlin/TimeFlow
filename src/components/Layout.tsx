import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Calendar,
  BarChart3,
  FolderKanban,
  Users,
  Settings,
  User,
  LogOut,
  Menu,
  Clock,
  Download,
  Image,
  Sun,
  Moon,
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import NotificationBell from './NotificationBell'
import type { Tables } from '../types/database'

type Profile = Tables<'profiles'>

interface LayoutProps {
  children: React.ReactNode
  user: Profile
}

export default function Layout({ children, user }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [imageError, setImageError] = useState(false)

  // Reset image error when avatar_url changes
  useEffect(() => {
    setImageError(false)
  }, [(user as any).avatar_url])

  const handleLogout = async () => {
    const { supabase } = await import('../lib/supabase')
    await supabase.auth.signOut()
    navigate('/login')
  }

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Calendar, label: 'Attendance', path: '/attendance' },
    { icon: BarChart3, label: 'Reports', path: '/reports' },
    { icon: FolderKanban, label: 'Projects', path: '/projects' },
    { icon: Users, label: 'Team Members', path: '/team' },
    { icon: Image, label: 'Screenshots', path: '/screenshots' },
    ...(user.role === 'admin'
      ? [{ icon: Settings, label: 'Admin Panel', path: '/admin' }]
      : []),
    { icon: Download, label: 'Download App', path: '/download' },
    { icon: User, label: 'Profile', path: '/profile' },
  ]

  // Get current page name and icon
  const getCurrentPageInfo = () => {
    const currentItem = menuItems.find(item => item.path === location.pathname)
    if (currentItem) {
      return { label: currentItem.label, icon: currentItem.icon }
    }
    // Fallback for unknown routes
    return { label: 'Dashboard', icon: LayoutDashboard }
  }

  const currentPage = getCurrentPageInfo()
  const CurrentPageIcon = currentPage.icon

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-72' : 'w-20'
        } bg-gradient-to-b from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col backdrop-blur-lg`}
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`relative h-16 flex items-center border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 ${
            sidebarOpen ? 'justify-between px-4' : 'justify-center px-2'
          }`}
        >
          {sidebarOpen ? (
            <>
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-lg flex items-center justify-center shadow-lg flex-shrink-0">
                  <Clock className="w-6 h-6 text-white" />
                </div>
                <motion.span
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-xl font-bold text-gray-800 dark:text-white truncate"
                >
                  TimeFlow
                </motion.span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-200 flex items-center justify-center group flex-shrink-0 ml-2"
                aria-label="Collapse sidebar"
              >
                <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
              </motion.button>
            </>
          ) : (
            <div className="flex items-center justify-center w-full">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-200 flex items-center justify-center group"
                aria-label="Expand sidebar"
              >
                <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
              </motion.button>
            </div>
          )}
        </motion.div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {menuItems.map((item, index) => {
      const Icon = item.icon
        const isActive = location.pathname === item.path
        return (
          <motion.div
            key={item.path}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
          >
              <Link
                to={item.path}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 relative overflow-hidden group ${
                isActive
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 text-white shadow-md'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gradient-to-r hover:from-gray-100 hover:to-gray-50 dark:hover:from-gray-700 dark:hover:to-gray-800'
              }`}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`} />
                {sidebarOpen && <span className={`font-medium ${isActive ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>{item.label}</span>}
              </Link>
          </motion.div>
        )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-gradient-to-r from-white via-white to-gray-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 shadow-sm backdrop-blur-lg">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-lg flex items-center justify-center shadow-lg">
                <CurrentPageIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800 dark:text-white">
                  {currentPage.label}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
                {/* Notification Bell */}
                <NotificationBell userId={user.id} />

                {/* Theme Toggle */}
                <motion.button
                  onClick={toggleTheme}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
              <AnimatePresence mode="wait">
                {theme === 'light' ? (
                  <motion.div
                    key="moon"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="sun"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Sun className="w-5 h-5 text-yellow-500 dark:text-yellow-400" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  </motion.button>

            {/* User Profile */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-500 dark:to-purple-500 rounded-full flex items-center justify-center text-white font-semibold shadow-lg overflow-hidden relative">
                {(user as any).avatar_url && !imageError ? (
                  <img
                    key={(user as any).avatar_url}
                    src={(user as any).avatar_url}
                    alt={user.full_name}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <span>{user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}</span>
                )}
              </div>
              {sidebarOpen && (
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {user.full_name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {user.role}
                  </span>
                </div>
              )}
            </div>

                {/* Logout */}
                <button
                  onClick={handleLogout}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <LogOut className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                </button>
          </div>
        </header>

            {/* Page Content */}
            <main className="flex-1 overflow-y-auto p-6 bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">{children}</main>
      </div>
    </div>
  )
}

