import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getHanyePlugin } from './runtime'
import { getHanyeTheme } from '../theme/themeRuntime'
import { useThemePackStore } from '../theme/themePackStore'

type CombinedEntry = {
  id: string
  source: 'theme' | 'plugin'
  render: string | ((el: HTMLElement, ctx: Record<string, unknown>) => void | (() => void))
}

/**
 * Host UI embedding for **themes + plugins** (same slot names).
 *
 * Inject: theme templates / HanyeTheme first, then plugin slots, then children.
 * Replace priority: plugin `.replace` > theme `.replace` > children.
 * Themes may use any PluginSlot name (header/nav/footer/pages/detail/…).
 */
export function PluginSlot({
  name,
  children,
  className,
  replace = false,
  context
}: {
  name: string
  children?: ReactNode
  className?: string
  replace?: boolean
  context?: Record<string, unknown>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const pluginRt = getHanyePlugin()
  const themeRt = getHanyeTheme()
  const contextKey = context ? JSON.stringify(context) : ''
  const templateReplace = useThemePackStore((s) => s.templateHtml[`${name}.replace`])
  const templatePlain = useThemePackStore((s) => s.templateHtml[name])

  useEffect(() => {
    const unsubP = pluginRt.on('slot:change', (p) => {
      const n = (p as { name?: string } | null)?.name
      if (!n || n === name || n === `${name}.replace`) setTick((t) => t + 1)
    })
    const unsubT = themeRt.on('slot:change', (p) => {
      const n = (p as { name?: string } | null)?.name
      if (!n || n === name || n === `${name}.replace`) setTick((t) => t + 1)
    })
    return () => {
      unsubP()
      unsubT()
    }
  }, [name, pluginRt, themeRt])

  const replaceKey = `${name}.replace`
  const pluginReplace = replace && pluginRt.shouldReplace(name)
  const themeReplace =
    replace && !pluginReplace && (themeRt.shouldReplace(name) || !!templateReplace)
  const doReplace = pluginReplace || themeReplace
  const replaceSource: 'plugin' | 'theme' | null = pluginReplace
    ? 'plugin'
    : themeReplace
      ? 'theme'
      : null

  const entries: CombinedEntry[] = (() => {
    if (pluginReplace) {
      return pluginRt.getSlotEntries(replaceKey).map((e) => ({
        id: `p:${e.id}`,
        source: 'plugin' as const,
        render: e.render as CombinedEntry['render']
      }))
    }
    if (themeReplace) {
      const list = themeRt.getSlotEntries(replaceKey)
      if (list.length) {
        return list.map((e) => ({
          id: `t:${e.id}`,
          source: 'theme' as const,
          render: e.render as CombinedEntry['render']
        }))
      }
      if (templateReplace) {
        return [{ id: 't:template-replace', source: 'theme', render: templateReplace }]
      }
      return []
    }
    const themeList = themeRt.getSlotEntries(name).map((e) => ({
      id: `t:${e.id}`,
      source: 'theme' as const,
      render: e.render as CombinedEntry['render']
    }))
    if (!themeList.length && templatePlain) {
      themeList.push({ id: 't:template', source: 'theme', render: templatePlain })
    }
    const pluginList = pluginRt.getSlotEntries(name).map((e) => ({
      id: `p:${e.id}`,
      source: 'plugin' as const,
      render: e.render as CombinedEntry['render']
    }))
    return [...themeList, ...pluginList]
  })()

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const cleanups: Array<() => void> = []
    for (const entry of entries) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginSlot = name
      wrap.dataset.slotSource = entry.source
      wrap.dataset.pluginEntry = entry.id
      wrap.style.display = 'contents'
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          if (v == null) continue
          wrap.dataset[`ctx${k[0].toUpperCase()}${k.slice(1)}`] = String(v)
        }
      }
      if (typeof entry.render === 'string') {
        wrap.innerHTML = entry.render
      } else {
        try {
          const ret = entry.render(wrap, {
            slot: doReplace ? replaceKey : name,
            mode: entry.source === 'theme' ? themeRt.mode : pluginRt.mode,
            user: pluginRt.user,
            context,
            source: entry.source
          })
          if (typeof ret === 'function') cleanups.push(ret)
        } catch (e) {
          console.error('[PluginSlot]', entry.source, name, e)
        }
      }
      el.appendChild(wrap)
    }
    return () => {
      cleanups.forEach((fn) => {
        try {
          fn()
        } catch {
          /* ignore */
        }
      })
      el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, tick, doReplace, replaceSource, contextKey, entries.map((e) => e.id).join(',')])

  if (doReplace) {
    return (
      <div
        ref={hostRef}
        className={className || `plugin-slot plugin-slot-${name.replace(/\./g, '-')}`}
        data-slot-replace={replaceSource || undefined}
      />
    )
  }

  // Keep a stable tree so page children (e.g. ToolsPage) are not remounted when
  // slot entries appear/disappear or tick updates.
  return (
    <>
      {entries.length ? (
        <div
          ref={hostRef}
          className={className || `plugin-slot plugin-slot-${name.replace(/\./g, '-')}`}
          style={{ display: 'contents' }}
        />
      ) : null}
      {children}
    </>
  )
}
