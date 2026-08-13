import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getHanyeTheme } from './themeRuntime'
import { useThemePackStore } from './themePackStore'

/**
 * Theme template slot. Prefer theme templates / layout.js over children when replace.
 */
export function ThemeSlot({
  name,
  children,
  className,
  replace = false
}: {
  name: string
  children?: ReactNode
  className?: string
  replace?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const runtime = getHanyeTheme()
  const templateHtml = useThemePackStore((s) => s.templateHtml[`${name}.replace`] || s.templateHtml[name])

  useEffect(() => {
    return runtime.on('slot:change', (p) => {
      const n = (p as { name?: string } | null)?.name
      if (!n || n === name || n === `${name}.replace`) setTick((t) => t + 1)
    })
  }, [name, runtime])

  const replaceKey = `${name}.replace`
  const fromStore = replace && !!useThemePackStore.getState().templateHtml[replaceKey]
  const doReplace = replace && (runtime.shouldReplace(name) || fromStore || !!templateHtml)
  const entries = doReplace
    ? runtime.getSlotEntries(replaceKey)
    : runtime.getSlotEntries(name)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const cleanups: Array<() => void> = []

    if (doReplace && templateHtml && !entries.length) {
      el.innerHTML = templateHtml
    } else {
      for (const entry of entries) {
        const wrap = document.createElement('div')
        wrap.dataset.themeSlot = name
        if (typeof entry.render === 'string') {
          wrap.innerHTML = entry.render
        } else {
          try {
            const ret = entry.render(wrap, { slot: doReplace ? replaceKey : name, mode: runtime.mode })
            if (typeof ret === 'function') cleanups.push(ret)
          } catch (e) {
            console.error('[ThemeSlot]', name, e)
          }
        }
        el.appendChild(wrap)
      }
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
  }, [name, tick, doReplace, templateHtml, entries.map((e) => e.id).join(',')])

  if (doReplace) {
    return <div ref={hostRef} className={className || `theme-slot theme-slot-${name.replace(/\./g, '-')}`} />
  }

  return (
    <>
      <div
        ref={hostRef}
        className={className || `theme-slot theme-slot-${name.replace(/\./g, '-')}`}
        style={entries.length ? undefined : { display: 'contents' }}
      />
      {children}
    </>
  )
}
