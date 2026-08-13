import { useEffect, useRef } from 'react'
import { ensureHanyePlugin } from './runtime'
import type { PluginUiAssets, PluginUiNavItem } from '@shared/plugin'
import { useAuthStore } from '../stores/authStore'

type UiPayload = {
  ok?: boolean
  nav?: PluginUiNavItem[]
  assets?: PluginUiAssets
  plugins?: unknown[]
  i18n?: Record<string, Record<string, string>>
  kernelVersion?: string
}

async function fetchJson(url: string, token?: string | null): Promise<UiPayload> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
  return (await res.json()) as UiPayload
}

function loadCss(href: string, mark: string): HTMLLinkElement {
  const el = document.createElement('link')
  el.rel = 'stylesheet'
  el.href = href
  el.dataset.pluginLoader = mark
  document.head.appendChild(el)
  return el
}

function loadScript(src: string, mark: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.dataset.pluginLoader = mark
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`load ${src}`))
    document.body.appendChild(el)
  })
}

/**
 * Loads plugin CSS/JS and hydrates slots.
 * mode=public → login page ( /api/v1/plugins/public-ui )
 * mode=app → authed ( /api/v1/plugins/ui )
 */
export function PluginLoader({
  mode,
  onNav
}: {
  mode: 'public' | 'app'
  onNav?: (nav: PluginUiNavItem[]) => void
}) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const serverUrl = useAuthStore((s) => s.serverUrl)
  const mark = useRef(`pl-${mode}-${Date.now()}`)

  useEffect(() => {
    const runtime = ensureHanyePlugin()
    runtime.reset()
    runtime.mode = mode
    runtime.user = user
    const m = mark.current
    let cancelled = false
    let offPerm: (() => void) | undefined

    const run = async () => {
      try {
        const path = mode === 'public' ? '/api/v1/plugins/public-ui' : '/api/v1/plugins/ui'
        const base =
          mode === 'public' && serverUrl
            ? `${serverUrl.replace(/\/+$/, '')}${path}`
            : path
        const data = await fetchJson(base, mode === 'app' ? token : null)
        if (cancelled) return
        const assets = data.assets || {}
        runtime.hydrateFromAssets(assets, mode)
        if (mode === 'app') {
          runtime.hydratePlugins(
            (data.plugins || []) as never,
            data.i18n as Record<string, Record<string, string>> | undefined,
            data.kernelVersion as string | undefined
          )
        }
        onNav?.(data.nav || [])

        const cssList =
          mode === 'public'
            ? [...(assets.publicCss || []), ...(assets.css || []).filter((u) => u.includes('theme'))]
            : [...(assets.css || [])]
        for (const href of cssList) {
          loadCss(href.startsWith('http') ? href : href, m)
        }

        const jsList = mode === 'public' ? assets.publicJs || [] : assets.js || []
        for (const src of jsList) {
          try {
            await loadScript(src.startsWith('http') ? src : src, m)
          } catch (e) {
            console.error('[PluginLoader]', e)
          }
        }

        document.querySelectorAll(`[data-plugin-html="${m}"]`).forEach((n) => n.remove())
        if (assets.htmlHeader) {
          const wrap = document.createElement('div')
          wrap.dataset.pluginHtml = m
          wrap.dataset.pluginHtmlPos = 'header'
          wrap.innerHTML = assets.htmlHeader
          document.body.prepend(wrap)
        }
        if (assets.htmlFooter) {
          const wrap = document.createElement('div')
          wrap.dataset.pluginHtml = m
          wrap.dataset.pluginHtmlPos = 'footer'
          wrap.innerHTML = assets.htmlFooter
          document.body.appendChild(wrap)
        }

        if (mode === 'app' && token) {
          const st = useAuthStore.getState()
          if (st.permissions?.length) {
            const next = runtime.applyPermissions(st.permissions, st.user)
            if (next.join('\0') !== st.permissions.join('\0')) {
              useAuthStore.setState({ permissions: next })
            }
          }
          offPerm = runtime.on('permissions:change', () => {
            const cur = useAuthStore.getState()
            if (!cur.permissions?.length) return
            const next = runtime.applyPermissions(cur.permissions, cur.user)
            useAuthStore.setState({ permissions: next })
          })
        }

        runtime.emit('ready', { mode })
      } catch (e) {
        console.error('[PluginLoader]', e)
      }
    }

    void run()
    return () => {
      cancelled = true
      offPerm?.()
      document.querySelectorAll(`[data-plugin-loader="${m}"]`).forEach((n) => n.remove())
      document.querySelectorAll(`[data-plugin-html="${m}"]`).forEach((n) => n.remove())
    }
  }, [mode, token, serverUrl, user, onNav])

  return null
}
