import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useThemePackStore, type ActiveThemePayload } from './themePackStore'
import { ensureHanyeTheme } from './themeRuntime'

const LINK_ATTR = 'data-hanye-theme-css'
const SCRIPT_ATTR = 'data-hanye-theme-js'

function clearThemeLinks(): void {
  document.querySelectorAll(`link[${LINK_ATTR}]`).forEach((el) => el.remove())
}

function clearThemeScripts(): void {
  document.querySelectorAll(`script[${SCRIPT_ATTR}]`).forEach((el) => el.remove())
}

function absolutize(href: string, serverUrl: string): string {
  if (!href || href.startsWith('http://') || href.startsWith('https://')) return href
  const base = serverUrl.replace(/\/+$/, '')
  if (!base) return href
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const origin = window.location.origin.replace(/\/+$/, '')
      if (origin === base) return href
    }
  } catch {
    /* ignore */
  }
  return `${base}${href.startsWith('/') ? href : `/${href}`}`
}

function injectCss(urls: string[], serverUrl: string): void {
  clearThemeLinks()
  for (const href of urls) {
    if (!href) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = absolutize(href, serverUrl)
    link.setAttribute(LINK_ATTR, '1')
    document.head.appendChild(link)
  }
}

function loadScript(src: string, serverUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = absolutize(src, serverUrl)
    el.async = false
    el.setAttribute(SCRIPT_ATTR, '1')
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`theme script ${src}`))
    document.body.appendChild(el)
    ensureHanyeTheme().trackScript(el)
  })
}

async function fetchActive(serverUrl: string): Promise<ActiveThemePayload | null> {
  const path = '/api/v1/themes/active'
  const base = serverUrl.replace(/\/+$/, '')
  let url = path
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const origin = window.location.origin.replace(/\/+$/, '')
      if (base && base !== origin) url = `${base}${path}`
    } else if (base) {
      url = `${base}${path}`
    }
  } catch {
    if (base) url = `${base}${path}`
  }
  const res = await fetch(url)
  const data = (await res.json()) as { ok?: boolean; active?: ActiveThemePayload | null }
  if (!res.ok || data.ok === false) return null
  return data.active || null
}

/** Legacy fallback: fetch raw template files when server did not compile templateHtml. */
async function loadTemplatesLegacy(
  templates: Record<string, string>,
  serverUrl: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(
    Object.entries(templates || {}).map(async ([name, href]) => {
      try {
        const res = await fetch(absolutize(href, serverUrl))
        if (res.ok) out[name] = await res.text()
      } catch {
        /* ignore */
      }
    })
  )
  return out
}

function applyHtmlMap(
  runtime: ReturnType<typeof ensureHanyeTheme>,
  htmlMap: Record<string, string>,
  siteMode: string
): void {
  useThemePackStore.getState().setTemplateHtml(htmlMap)
  const full = siteMode === 'full'
  for (const [name, html] of Object.entries(htmlMap)) {
    // Full-site shell/login HTML is owned by ThemeFullSiteHost — do not double-register
    if (full && (name === 'app.shell.replace' || name === 'login.page.replace')) continue
    if (name.endsWith('.replace')) {
      runtime.replaceSlot(name.replace(/\.replace$/, ''), html)
    } else {
      runtime.registerSlot(name, html)
    }
  }
}

export async function refreshActiveThemePack(): Promise<ActiveThemePayload | null> {
  try {
    const serverUrl = useAuthStore.getState().serverUrl || ''
    const active = await fetchActive(serverUrl)
    useThemePackStore.getState().setActive(active)
    if (active) {
      document.documentElement.setAttribute('data-theme-pack', active.packId)
      document.documentElement.setAttribute('data-theme-layout', active.layout || 'classic')
      document.documentElement.setAttribute('data-theme-device-view', active.deviceView || 'grid')
      document.documentElement.setAttribute('data-theme-site-mode', active.siteMode || 'skin')
    }
    return active
  } catch {
    useThemePackStore.getState().setActive(null)
    return null
  }
}

/** Loads active theme pack CSS / layout.js / compiled .htm slots. Safe before auth. */
export function ThemeLoader({ mode }: { mode: 'public' | 'app' }): null {
  const serverUrl = useAuthStore((s) => s.serverUrl)

  useEffect(() => {
    let cancelled = false
    const runtime = ensureHanyeTheme()
    runtime.reset()
    runtime.mode = mode

    void (async () => {
      const active = await refreshActiveThemePack()
      if (cancelled || !active) return

      const urls =
        mode === 'public' ? [...(active.css || []), ...(active.loginCss || [])] : active.css || []
      injectCss(urls, serverUrl || '')
      document.documentElement.setAttribute('data-theme-pack', active.packId)
      document.documentElement.setAttribute('data-theme-layout', active.layout || 'classic')
      document.documentElement.setAttribute('data-theme-device-view', active.deviceView || 'grid')
      document.documentElement.setAttribute('data-theme-site-mode', active.siteMode || 'skin')

      let htmlMap: Record<string, string> = active.templateHtml || {}
      if (!Object.keys(htmlMap).length && active.templates) {
        htmlMap = await loadTemplatesLegacy(active.templates, serverUrl || '')
      }
      if (cancelled) return
      applyHtmlMap(runtime, htmlMap, active.siteMode || 'skin')

      clearThemeScripts()
      for (const src of active.layoutJs || []) {
        try {
          await loadScript(src, serverUrl || '')
        } catch (e) {
          console.error('[ThemeLoader]', e)
        }
      }
      if (!cancelled) runtime.emit('ready', { mode, packId: active.packId })
    })()

    return () => {
      cancelled = true
    }
  }, [mode, serverUrl])

  return null
}
