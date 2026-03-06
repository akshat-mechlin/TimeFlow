import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://yxkniwzsinqyjdqqzyjs.supabase.co"
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4a25pd3pzaW5xeWpkcXF6eWpzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNjg4NjY5MywiZXhwIjoyMDUyNDYyNjkzfQ.nCkBT9tENopqLC1iE2appaKdixGTNum3HbieIvlbGLU"

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const BUCKET = "screenshots"

// List the exact file paths you want to delete
const filesToDelete = 
[
  "1bf95988-123a-439b-a74f-3517cabc6e2a/desktop_2025-11-18_0-12-56.png",
  "77f44e19-8270-4a30-909a-cc9df948b3b9/desktop_2025-11-18_0-13-0.png",
]

async function deleteFiles() {
  if (!filesToDelete.length) {
    console.log("No files specified.")
    return
  }

  console.log("Deleting files:", filesToDelete)

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .remove(filesToDelete)

  if (error) {
    console.error("Error deleting files:", error)
  } else {
    console.log("Deleted files:", data)
  }
}

deleteFiles()