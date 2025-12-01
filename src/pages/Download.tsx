import { useState, useEffect } from 'react'
import { Download as DownloadIcon, Monitor, Laptop, HardDrive, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import Loader from '../components/Loader'

export default function Download() {
  const [downloadLinks, setDownloadLinks] = useState({
    windows: '',
    macos: '',
    linux: '',
  })
  const [loading, setLoading] = useState(true)
  const { showError, showInfo } = useToast()

  useEffect(() => {
    fetchDownloadLinks()
  }, [])

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
      const linuxFiles = [
        'linux/TimeFlow.AppImage',
        'linux/TimeFlow-x86_64.AppImage',
        'TimeFlow.AppImage',
        'linux/timeflow.AppImage',
      ]

      let foundBucket = ''
      let foundWindows = ''
      let foundMacos = ''
      let foundLinux = ''

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

          // Find Linux file (.AppImage)
          const linuxFile = allFiles.find(file => 
            (file.toLowerCase().endsWith('.appimage') || file.toLowerCase().endsWith('.AppImage')) && 
            (file.toLowerCase().includes('linux') || file.toLowerCase().includes('appimage') || !file.includes('/'))
          )
          if (linuxFile) {
            const { data } = supabase.storage.from(bucketName).getPublicUrl(linuxFile)
            if (data?.publicUrl) {
              foundLinux = data.publicUrl
            }
          } else {
            // Fallback to trying predefined paths
            for (const filePath of linuxFiles) {
              try {
                const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath)
                if (data?.publicUrl) {
                  foundLinux = data.publicUrl
                  break
                }
              } catch (e) {
                continue
              }
            }
          }

          // If we found at least one file, use this bucket
          if (foundWindows || foundMacos || foundLinux) {
            setDownloadLinks({
              windows: foundWindows,
              macos: foundMacos,
              linux: foundLinux,
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
        linux: '',
      })
      setLoading(false)
    } catch (error) {
      console.error('Error fetching download links:', error)
      showError('Failed to fetch download links. Please try again later.')
      setLoading(false)
    }
  }

  const handleDownload = async (platform: 'windows' | 'macos' | 'linux', url: string) => {
    if (!url || url === '#') {
      showError(`${platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux'} download is not yet available.`)
      return
    }

    try {
      showInfo(`Starting download for ${platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux'}...`)
      
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

  const features = [
    'Track time automatically',
    'Offline mode support',
    'Desktop notifications',
    'Screenshot capture',
    'Activity monitoring',
    'Sync with web dashboard',
  ]

  if (loading) {
    return <Loader size="lg" text="Loading download links..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-600 dark:bg-blue-500 text-white p-8 rounded-xl">
        <h1 className="text-4xl font-bold mb-2">Download TimeFlow Desktop App</h1>
        <p className="text-blue-100 text-lg">
          Get the full-featured desktop application for Windows, macOS, and Linux
        </p>
      </div>

      {/* Download Options */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Windows */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-xl mb-4 mx-auto">
            <Monitor className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white text-center mb-2">Windows</h3>
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
          <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-xl mb-4 mx-auto">
            <Laptop className="w-8 h-8 text-gray-700" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white text-center mb-2">macOS</h3>
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

        {/* Linux */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-center w-16 h-16 bg-orange-100 rounded-xl mb-4 mx-auto">
            <HardDrive className="w-8 h-8 text-orange-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white text-center mb-2">Linux</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
            AppImage (64-bit)
          </p>
          <button
            onClick={() => handleDownload('linux', downloadLinks.linux)}
            disabled={!downloadLinks.linux}
            className="w-full flex items-center justify-center space-x-2 bg-orange-600 dark:bg-orange-500 text-white px-6 py-3 rounded-lg hover:bg-orange-700 dark:hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <DownloadIcon className="w-5 h-5" />
            <span>Download for Linux</span>
          </button>
          <p className="text-xs text-gray-500 text-center mt-3">.AppImage</p>
        </div>
      </div>

      {/* Features */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-6">Desktop App Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((feature, index) => (
            <div key={index} className="flex items-center space-x-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* System Requirements */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">System Requirements</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div>
            <h3 className="font-medium text-gray-800 dark:text-white mb-2">Linux</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Ubuntu 18.04+ or similar</li>
              <li>• 64-bit processor</li>
              <li>• 100 MB free disk space</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

