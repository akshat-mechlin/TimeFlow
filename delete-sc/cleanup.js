import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and set values from the Supabase Dashboard (never commit the service role key).',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const BUCKET = 'screenshots'

// List the exact file paths you want to delete
const filesToDelete = [
  // 'user-uuid/example.png',
]

async function deleteFiles() {
  if (!filesToDelete.length) {
    console.log('No files specified.')
    return
  }

  console.log('Deleting files:', filesToDelete)

  const { data, error } = await supabase.storage.from(BUCKET).remove(filesToDelete)

  if (error) {
    console.error('Error deleting files:', error)
  } else {
    console.log('Deleted files:', data)
  }
}

deleteFiles()
