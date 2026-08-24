import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  process.stderr.write(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and set values from the Supabase Dashboard (never commit the service role key).\n',
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
    return
  }

  const { error } = await supabase.storage.from(BUCKET).remove(filesToDelete)

  if (error) {
    process.stderr.write(`Error deleting files: ${error.message || error}\n`)
    process.exit(1)
  }
}

deleteFiles()
