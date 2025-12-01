import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  fullScreen?: boolean
}

export default function Loader({ size = 'md', text = 'Loading...', fullScreen = false }: LoaderProps) {
  const { theme } = useTheme()
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  }

  const containerClasses = fullScreen 
    ? 'flex items-center justify-center h-screen w-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900'
    : 'flex items-center justify-center h-full min-h-[200px]'

  return (
    <div className={containerClasses}>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center justify-center space-y-4"
      >
        {/* Main Spinner */}
        <div className="relative">
          {/* Outer rotating ring with gradient */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className={`${sizeClasses[size]} rounded-full ${
              theme === 'dark' 
                ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500' 
                : 'bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600'
            } p-0.5`}
          >
            <div className={`w-full h-full rounded-full ${
              theme === 'dark' 
                ? 'bg-gray-900' 
                : 'bg-white'
            }`} />
          </motion.div>
          
          {/* Inner pulsing circle with gradient */}
          <motion.div
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className={`absolute inset-0 ${sizeClasses[size]} rounded-full ${
              theme === 'dark' 
                ? 'bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-blue-500/20' 
                : 'bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-blue-600/20'
            }`}
          />
          
          {/* Center icon with gradient */}
          <div className={`absolute inset-0 flex items-center justify-center ${sizeClasses[size]}`}>
            <motion.div
              animate={{ 
                rotate: [0, -10, 10, -10, 0],
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <Clock className={`${
                size === 'sm' ? 'w-4 h-4' : size === 'md' ? 'w-5 h-5' : 'w-6 h-6'
              } ${
                theme === 'dark' 
                  ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400' 
                  : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600'
              }`} style={{ WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }} />
            </motion.div>
          </div>
        </div>

        {/* Loading text with dots animation */}
        {text && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center space-x-1"
          >
            <span className={`text-sm font-medium ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              {text}
            </span>
            <div className="flex space-x-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={{ 
                    opacity: [0.3, 1, 0.3],
                    y: [0, -4, 0]
                  }}
                  transition={{ 
                    duration: 1.2,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut"
                  }}
                  className={`${
                    theme === 'dark' 
                      ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400' 
                      : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600'
                  }`}
                  style={{ WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                >
                  .
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Optional: Progress dots */}
        <div className="flex space-x-2 mt-2">
          {[0, 1, 2, 3].map((i) => (
            <motion.div
              key={i}
              animate={{ 
                scale: [1, 1.3, 1],
                opacity: [0.4, 1, 0.4]
              }}
              transition={{ 
                duration: 1.5,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut"
              }}
              className={`w-2 h-2 rounded-full ${
                theme === 'dark' 
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500' 
                  : 'bg-gradient-to-r from-blue-600 to-purple-600'
              }`}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

