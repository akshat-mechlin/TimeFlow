import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void
  showSuccess: (message: string, duration?: number) => void
  showError: (message: string, duration?: number) => void
  showWarning: (message: string, duration?: number) => void
  showInfo: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 5000) => {
      const id = Math.random().toString(36).substring(2, 9)
      const newToast: Toast = { id, message, type, duration }

      setToasts((prev) => [...prev, newToast])

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id)
        }, duration)
      }
    },
    [removeToast]
  )

  const showSuccess = useCallback(
    (message: string, duration?: number) => {
      showToast(message, 'success', duration)
    },
    [showToast]
  )

  const showError = useCallback(
    (message: string, duration?: number) => {
      showToast(message, 'error', duration)
    },
    [showToast]
  )

  const showWarning = useCallback(
    (message: string, duration?: number) => {
      showToast(message, 'warning', duration)
    },
    [showToast]
  )

  const showInfo = useCallback(
    (message: string, duration?: number) => {
      showToast(message, 'info', duration)
    },
    [showToast]
  )

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-50 dark:bg-green-900/90',
          border: 'border-green-200 dark:border-green-700',
          text: 'text-green-800 dark:text-green-100',
          icon: 'text-green-600 dark:text-green-300',
          iconBg: 'bg-green-100 dark:bg-green-800',
        }
      case 'error':
        return {
          bg: 'bg-red-50 dark:bg-red-900/90',
          border: 'border-red-200 dark:border-red-700',
          text: 'text-red-800 dark:text-red-100',
          icon: 'text-red-600 dark:text-red-300',
          iconBg: 'bg-red-100 dark:bg-red-800',
        }
      case 'warning':
        return {
          bg: 'bg-yellow-50 dark:bg-yellow-900/90',
          border: 'border-yellow-200 dark:border-yellow-700',
          text: 'text-yellow-800 dark:text-yellow-100',
          icon: 'text-yellow-600 dark:text-yellow-300',
          iconBg: 'bg-yellow-100 dark:bg-yellow-800',
        }
      case 'info':
        return {
          bg: 'bg-blue-50 dark:bg-blue-900/90',
          border: 'border-blue-200 dark:border-blue-700',
          text: 'text-blue-800 dark:text-blue-100',
          icon: 'text-blue-600 dark:text-blue-300',
          iconBg: 'bg-blue-100 dark:bg-blue-800',
        }
    }
  }

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />
      case 'error':
        return <XCircle className="w-5 h-5" />
      case 'warning':
        return <AlertCircle className="w-5 h-5" />
      case 'info':
        return <Info className="w-5 h-5" />
    }
  }

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-md w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            const styles = getToastStyles(toast.type)
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -50, x: 100 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className={`${styles.bg} ${styles.border} ${styles.text} border rounded-lg shadow-xl dark:shadow-2xl p-4 flex items-start space-x-3 pointer-events-auto backdrop-blur-sm`}
              >
                <div className={`${styles.iconBg} ${styles.icon} rounded-full p-1.5 flex-shrink-0`}>
                  {getIcon(toast.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words">{toast.message}</p>
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className={`${styles.text} hover:opacity-70 flex-shrink-0 p-1 rounded transition-opacity`}
                  aria-label="Close toast"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

