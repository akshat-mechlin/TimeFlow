import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { writeUserLog } from '../lib/userLogs'

export type DevToolsGuardUser = {
  id: string
  email?: string | null
  full_name?: string | null
  role?: string | null
} | null

type Props = {
  user: DevToolsGuardUser
  source?: 'website' | 'desktop'
}

function collectClientInfo(extra: Record<string, unknown> = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const scr = typeof screen !== 'undefined' ? screen : null
  return {
    ...extra,
    href: typeof location !== 'undefined' ? location.href : null,
    pathname: typeof location !== 'undefined' ? location.pathname : null,
    referrer: typeof document !== 'undefined' ? document.referrer : null,
    language: nav?.language ?? null,
    languages: nav?.languages ? [...nav.languages] : null,
    platform: nav?.platform ?? null,
    user_agent: nav?.userAgent ?? null,
    vendor: nav?.vendor ?? null,
    cookie_enabled: nav?.cookieEnabled ?? null,
    hardware_concurrency: nav?.hardwareConcurrency ?? null,
    device_memory: (nav as Navigator & { deviceMemory?: number })?.deviceMemory ?? null,
    max_touch_points: nav?.maxTouchPoints ?? null,
    online: nav?.onLine ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset_min: new Date().getTimezoneOffset(),
    screen_width: scr?.width ?? null,
    screen_height: scr?.height ?? null,
    screen_avail_width: scr?.availWidth ?? null,
    screen_avail_height: scr?.availHeight ?? null,
    screen_color_depth: scr?.colorDepth ?? null,
    screen_pixel_depth: scr?.pixelDepth ?? null,
    window_inner_width: typeof window !== 'undefined' ? window.innerWidth : null,
    window_inner_height: typeof window !== 'undefined' ? window.innerHeight : null,
    window_outer_width: typeof window !== 'undefined' ? window.outerWidth : null,
    window_outer_height: typeof window !== 'undefined' ? window.outerHeight : null,
    device_pixel_ratio: typeof window !== 'undefined' ? window.devicePixelRatio : null,
    visibility_state: typeof document !== 'undefined' ? document.visibilityState : null,
    recorded_at_client: new Date().toISOString(),
  }
}

function isDevToolsOpenHeuristic(): boolean {
  const widthGap = window.outerWidth - window.innerWidth
  const heightGap = window.outerHeight - window.innerHeight
  if (widthGap > 160 || heightGap > 160) return true

  const firebug = (window as unknown as { Firebug?: { chrome?: { isInitialized?: boolean } } }).Firebug
  if (firebug?.chrome?.isInitialized) return true

  return false
}

/**
 * Deterrent only on the web — DevTools cannot be fully blocked in a browser.
 * Set VITE_ALLOW_DEVTOOLS=true to disable the guard (local debugging).
 */
export default function DevToolsGuard({ user, source = 'website' }: Props) {
  const [visible, setVisible] = useState(false)
  const lastLogAt = useRef(0)
  const dockOpenRef = useRef(false)
  // Opt-out only — guard runs in Vite DEV too so you can verify the warning.
  const enabled = import.meta.env.VITE_ALLOW_DEVTOOLS !== 'true'

  const report = useCallback(
    async (trigger: string, extra: Record<string, unknown> = {}) => {
      setVisible(true)

      const now = Date.now()
      if (now - lastLogAt.current < 8000) return
      lastLogAt.current = now

      if (!user?.id) return

      const info = collectClientInfo({
        trigger,
        source,
        api_action: 'DevTools / inspector access attempt',
        api_table: 'user_logs',
        api_operation: 'security_event',
        actor_id: user.id,
        actor_email: user.email ?? null,
        actor_name: user.full_name ?? null,
        actor_role: user.role ?? null,
        ...extra,
      })

      await writeUserLog({
        userId: user.id,
        logType: 'devtools_attempt',
        message: `${user.full_name || user.email || 'Someone'} attempted to open developer tools (${trigger}). Action captured.`,
        source,
        metadata: info,
        deviceInfo: `${info.platform || 'unknown'} | ${info.screen_width}x${info.screen_height}`,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
    },
    [user, source],
  )

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase?.() || ''
      const code = e.code || ''
      const isF12 = e.key === 'F12' || code === 'F12'
      const isCtrlShiftI = e.ctrlKey && e.shiftKey && (key === 'i' || code === 'KeyI')
      const isCtrlShiftJ = e.ctrlKey && e.shiftKey && (key === 'j' || code === 'KeyJ')
      const isCtrlShiftC = e.ctrlKey && e.shiftKey && (key === 'c' || code === 'KeyC')
      const isCtrlShiftK = e.ctrlKey && e.shiftKey && (key === 'k' || code === 'KeyK')
      const isCmdOptI = e.metaKey && e.altKey && (key === 'i' || code === 'KeyI')
      const isCmdOptJ = e.metaKey && e.altKey && (key === 'j' || code === 'KeyJ')
      const isCmdOptC = e.metaKey && e.altKey && (key === 'c' || code === 'KeyC')
      const isCtrlU = (e.ctrlKey || e.metaKey) && (key === 'u' || code === 'KeyU')

      if (
        isF12 ||
        isCtrlShiftI ||
        isCtrlShiftJ ||
        isCtrlShiftC ||
        isCtrlShiftK ||
        isCmdOptI ||
        isCmdOptJ ||
        isCmdOptC ||
        isCtrlU
      ) {
        e.preventDefault()
        e.stopPropagation()
        void report('keyboard_shortcut', {
          key: e.key,
          code: e.code,
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        })
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      void report('context_menu')
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('contextmenu', onContextMenu, true)

    const interval = window.setInterval(() => {
      const open = isDevToolsOpenHeuristic()
      if (open && !dockOpenRef.current) {
        dockOpenRef.current = true
        void report('devtools_dock_detected')
      } else if (!open && dockOpenRef.current) {
        dockOpenRef.current = false
        // Do not auto-hide the warning — user must dismiss it.
      }
    }, 1200)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      window.clearInterval(interval)
    }
  }, [report, enabled])

  if (!enabled || !visible || typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483646,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(0,0,0,0.88)',
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="devtools-warning-title"
      onClick={() => setVisible(false)}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          borderRadius: 12,
          border: '1px solid rgba(239,68,68,0.65)',
          background: '#020617',
          color: '#fff',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
          padding: 28,
          pointerEvents: 'none',
        }}
      >
        <h2
          id="devtools-warning-title"
          style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 700, color: '#f87171' }}
        >
          Developer tools are not allowed
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 15, lineHeight: 1.55, color: '#e2e8f0' }}>
          Your action has been captured. This attempt to open developer tools / inspect the application
          has been recorded.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
          Unauthorized inspection of this internal system may be reviewed by administrators.
        </p>
      </div>
    </div>,
    document.body,
  )
}
