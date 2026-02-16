import { useState, useEffect } from 'react'
import { Download as DownloadIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import Loader from '../components/Loader'
import packageJson from '../../package.json'
import { getRequiredTrackerVersion } from '../lib/trackerVersion'

// Windows Icon Component
const WindowsIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M3 12V6.75l6-1.5v6.75L3 12zm17-9v8.75l-10 .15V5.21L20 3zM3 13l6 .15v6.75l-6-1.5V13zm17 8v-8.75L10 12.4v6.44l10 1.6z" />
  </svg>
)

// Apple/Mac Icon Component
const AppleIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
)

export default function Download() {
  const [downloadLinks, setDownloadLinks] = useState({
    windows: '',
    macos: '',
  })
  const [version, setVersion] = useState<string>(packageJson.version)
  const [loading, setLoading] = useState(true)
  const { showError, showInfo } = useToast()

  useEffect(() => {
    fetchDownloadLinks()
    fetchTrackerVersion()
  }, [])

  const fetchTrackerVersion = async () => {
    try {
      const versionSettings = await getRequiredTrackerVersion()
      if (versionSettings && versionSettings.requiredVersion) {
        setVersion(versionSettings.requiredVersion)
      }
    } catch (error) {
      console.error('Error fetching tracker version:', error)
      // Keep default version from package.json if fetch fails
    }
  }

  const fetchDownloadLinks = async () => {
    try {
      setLoading(true)
      
      // Try multiple possible bucket names (prioritize tracker-application)
      const possibleBuckets = ['tracker-application', 'downloads', 'desktop-apps', 'apps', 'releases']
      
      // Try multiple possible file names for each platform
      const windowsFiles = [
        'windows/TimeFlow-Setup.exe',
        'windows/TimeFlow.exe',
        'TimeFlow-Setup.exe',
        'TimeFlow.exe',
        'windows/timeflow-setup.exe',
      ]
      const macosFiles = [
        'macos/TimeFlow.dmg',
        'macos/TimeFlow.app.dmg',
        'TimeFlow.dmg',
        'macos/timeflow.dmg',
      ]

      let foundBucket = ''
      let foundWindows = ''
      let foundMacos = ''

      // Try each bucket
      for (const bucketName of possibleBuckets) {
        try {
          // Check if bucket exists by trying to list files
          const { data: listData, error: listError } = await supabase.storage
            .from(bucketName)
            .list('', { limit: 100 })

          if (listError) {
            continue // Bucket doesn't exist or not accessible
          }

          foundBucket = bucketName

          // Helper function to recursively find files
          const findFilesRecursively = async (path: string = ''): Promise<string[]> => {
            const { data, error } = await supabase.storage.from(bucketName).list(path, { limit: 100 })
            if (error || !data) return []
            
            const files: string[] = []
            for (const item of data) {
              const fullPath = path ? `${path}/${item.name}` : item.name
              if (item.id === null) {
                // It's a folder, recurse
                const subFiles = await findFilesRecursively(fullPath)
                files.push(...subFiles)
              } else {
                // It's a file
                files.push(fullPath)
              }
            }
            return files
          }

          // Get all files in the bucket
          const allFiles = await findFilesRecursively()

          // Find Windows file (.exe)
          const windowsFile = allFiles.find(file => 
            file.toLowerCase().endsWith('.exe') && 
            (file.toLowerCase().includes('windows') || file.toLowerCase().includes('win') || !file.includes('/'))
          )
          if (windowsFile) {
            const { data } = supabase.storage.from(bucketName).getPublicUrl(windowsFile)
            if (data?.publicUrl) {
              foundWindows = data.publicUrl
            }
          } else {
            // Fallback to trying predefined paths
            for (const filePath of windowsFiles) {
              try {
                const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath)
                if (data?.publicUrl) {
                  foundWindows = data.publicUrl
                  break
                }
              } catch (e) {
                continue
              }
            }
          }

          // Find macOS file (.dmg)
          const macosFile = allFiles.find(file => 
            file.toLowerCase().endsWith('.dmg') && 
            (file.toLowerCase().includes('macos') || file.toLowerCase().includes('mac') || !file.includes('/'))
          )
          if (macosFile) {
            const { data } = supabase.storage.from(bucketName).getPublicUrl(macosFile)
            if (data?.publicUrl) {
              foundMacos = data.publicUrl
            }
          } else {
            // Fallback to trying predefined paths
            for (const filePath of macosFiles) {
              try {
                const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath)
                if (data?.publicUrl) {
                  foundMacos = data.publicUrl
                  break
                }
              } catch (e) {
                continue
              }
            }
          }

          // If we found at least one file, use this bucket
          if (foundWindows || foundMacos) {
            setDownloadLinks({
              windows: foundWindows,
              macos: foundMacos,
            })
            setLoading(false)
            return
          }
        } catch (e) {
          console.error(`Error checking bucket ${bucketName}:`, e)
          // Continue to next bucket
          continue
        }
      }

      // If no files found, set empty links (buttons will be disabled)
      setDownloadLinks({
        windows: '',
        macos: '',
      })
      setLoading(false)
    } catch (error) {
      console.error('Error fetching download links:', error)
      showError('Failed to fetch download links. Please try again later.')
      setLoading(false)
    }
  }

  const handleDownload = async (platform: 'windows' | 'macos', url: string) => {
    if (!url || url === '#') {
      showError(`${platform === 'windows' ? 'Windows' : 'macOS'} download is not yet available.`)
      return
    }

    try {
      showInfo(`Starting download for ${platform === 'windows' ? 'Windows' : 'macOS'}...`)
      
      // Create a temporary anchor element to trigger download
      const link = document.createElement('a')
      link.href = url
      link.download = ''
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Error downloading file:', error)
      showError('Failed to start download. Please try again.')
    }
  }

  if (loading) {
    return <Loader size="lg" text="Loading download links..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-600 dark:bg-blue-500 text-white p-8 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-4xl font-bold">Download TimeFlow Desktop App</h1>
          <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-sm font-semibold border border-white/30">
            v{version}
          </span>
        </div>
        <p className="text-blue-100 text-lg">
          Get the full-featured desktop application for Windows and macOS
        </p>
      </div>

      {/* Download Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Windows */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-xl mb-4 mx-auto">
            <WindowsIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <h3 className="text-xl font-semibold text-gray-800 dark:text-white text-center">Windows</h3>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-semibold">
              v{version}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
            Windows 10/11 (64-bit)
          </p>
          <button
            onClick={() => handleDownload('windows', downloadLinks.windows)}
            disabled={!downloadLinks.windows}
            className="w-full flex items-center justify-center space-x-2 bg-blue-600 dark:bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <DownloadIcon className="w-5 h-5" />
            <span>Download for Windows</span>
          </button>
          <p className="text-xs text-gray-500 text-center mt-3">.exe installer</p>
        </div>

        {/* macOS */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-center w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-xl mb-4 mx-auto">
            <AppleIcon className="w-8 h-8 text-gray-800 dark:text-gray-200" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <h3 className="text-xl font-semibold text-gray-800 dark:text-white text-center">macOS</h3>
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-semibold">
              v{version}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
            macOS 10.15 or later
          </p>
          <button
            onClick={() => handleDownload('macos', downloadLinks.macos)}
            disabled={!downloadLinks.macos}
            className="w-full flex items-center justify-center space-x-2 bg-gray-800 dark:bg-gray-700 text-white px-6 py-3 rounded-lg hover:bg-gray-900 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <DownloadIcon className="w-5 h-5" />
            <span>Download for macOS</span>
          </button>
          <p className="text-xs text-gray-500 text-center mt-3">.dmg installer</p>
        </div>
      </div>

      {/* System Requirements */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">System Requirements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-800 dark:text-white mb-2">Windows</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Windows 10 or later</li>
              <li>• 64-bit processor</li>
              <li>• 100 MB free disk space</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-800 dark:text-white mb-2">macOS</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• macOS 10.15 or later</li>
              <li>• Intel or Apple Silicon</li>
              <li>• 100 MB free disk space</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

