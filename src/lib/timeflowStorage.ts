const TIMEFLOW_STORAGE_BASE_URL = 'https://timeflowstorage.mechlintech.com'

export const MANUAL_ENTRY_MAX_FILE_SIZE = 10 * 1024 * 1024

export const MANUAL_ENTRY_ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.txt',
  '.xls',
  '.xlsx',
  '.csv',
])

export function getTimeflowStorageBaseUrl(): string {
  return TIMEFLOW_STORAGE_BASE_URL
}

function buildStorageEndpoint(
  endpoint: string,
  params?: Record<string, string>,
): string {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = `${TIMEFLOW_STORAGE_BASE_URL}${path}`
  if (!params || Object.keys(params).length === 0) return url
  return `${url}?${new URLSearchParams(params).toString()}`
}

export function validateManualEntryFile(file: File): string | null {
  if (file.size > MANUAL_ENTRY_MAX_FILE_SIZE) {
    return 'File must be 10 MB or smaller.'
  }

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
  if (!MANUAL_ENTRY_ALLOWED_EXTENSIONS.has(ext)) {
    return 'Allowed types: PDF, Word, Excel, images, or text files.'
  }

  return null
}

/** Path shape: manual-updates/{timeEntryId}/{fileName} */
export function parseManualAttachmentPath(storagePath: string): {
  type: string
  uuid: string
  file: string
} | null {
  const segments = storagePath.split('/').filter(Boolean)
  if (segments.length < 3) return null
  const [type, uuid, ...rest] = segments
  if (type !== 'manual-updates' || !uuid || rest.length === 0) return null
  return { type, uuid, file: rest.join('/') }
}

export function buildTimeflowStorageFileUrl(storagePath: string): string | null {
  const parsed = parseManualAttachmentPath(storagePath)
  if (!parsed) return null

  const params = new URLSearchParams({
    type: parsed.type,
    uuid: parsed.uuid,
    file: parsed.file,
  })
  return `${TIMEFLOW_STORAGE_BASE_URL}/file?${params.toString()}`
}

export async function uploadManualEntryAttachment(
  timeEntryId: string,
  file: File,
  accessToken?: string,
): Promise<string> {
  const validationError = validateManualEntryFile(file)
  if (validationError) throw new Error(validationError)

  const formData = new FormData()
  // Text fields must come before the file so multer can read them in destination()
  formData.append('type', 'manual-updates')
  formData.append('uuid', timeEntryId)
  formData.append('filename', file.name)
  formData.append('file', file)

  const uploadUrl = buildStorageEndpoint('/upload', {
    type: 'manual-updates',
    uuid: timeEntryId,
  })

  const headers: HeadersInit = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  let response: Response
  try {
    response = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: formData,
    })
  } catch (error) {

    throw new Error(
      `Cannot reach the storage server at ${TIMEFLOW_STORAGE_BASE_URL}.`,
    )
  }

  if (!response.ok) {
    let message = `Upload failed (${response.status}).`
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }

  const result = await response.json()
  if (!result?.path) {
    throw new Error('Upload succeeded but storage path was not returned.')
  }

  return result.path as string
}

export function openStorageFileInNewTab(storagePath: string): void {
  const url = buildTimeflowStorageFileUrl(storagePath)
  if (!url) {
    throw new Error('Invalid attachment path.')
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
