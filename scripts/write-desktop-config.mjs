/**
 * Writes public/desktop-config.json for the Electron app to fetch at runtime.
 * Keys stay on the web server / CI — not inside the desktop installer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outPath = path.join(root, 'public', 'desktop-config.json')

const url =
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
const publishableKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''

if (!url || !publishableKey) {
  console.warn(
    '[write-desktop-config] Skipped: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_*) so public/desktop-config.json is generated for the desktop app.',
  )
  process.exit(0)
}

const payload = {
  supabaseUrl: url,
  supabasePublishableKey: publishableKey,
  updatedAt: new Date().toISOString(),
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

