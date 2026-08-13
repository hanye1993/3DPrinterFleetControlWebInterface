import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ThemeFullSiteIslands = {
  'header-brand'?: ReactNode
  'header-actions'?: ReactNode
  nav?: ReactNode
  main?: ReactNode
  footer?: ReactNode
  'mobile-toolbar'?: ReactNode
  'login-form'?: ReactNode
  'login-hero'?: ReactNode
}

const MOUNT_KEYS = [
  'header-brand',
  'header-actions',
  'nav',
  'main',
  'footer',
  'mobile-toolbar',
  'login-form',
  'login-hero'
] as const

type MountKey = (typeof MOUNT_KEYS)[number]

/**
 * Discuz-style full-site host: theme HTML owns the chrome;
 * React islands mount into [data-hanye-mount="…"] nodes.
 *
 * HTML updates are two-phase so portals unmount before innerHTML replaces
 * their DOM targets (avoids removeChild / not-a-child warnings).
 */
export function ThemeFullSiteHost({
  html,
  islands,
  className
}: {
  html: string
  islands: ThemeFullSiteIslands
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<Partial<Record<MountKey, Element>>>({})
  const [appliedHtml, setAppliedHtml] = useState<string | null>(null)
  const pending = html || ''

  // Phase 1: when HTML changes, drop portal targets first
  useLayoutEffect(() => {
    if (appliedHtml === pending) return
    setNodes({})
    setAppliedHtml(null)
  }, [pending, appliedHtml])

  // Phase 2: after portals cleared, write HTML and rediscover mounts
  useLayoutEffect(() => {
    if (appliedHtml === pending) return
    if (Object.keys(nodes).length > 0) return
    const host = hostRef.current
    if (!host) return
    host.innerHTML = pending
    const next: Partial<Record<MountKey, Element>> = {}
    for (const key of MOUNT_KEYS) {
      const el = host.querySelector(`[data-hanye-mount="${key}"]`)
      if (el) next[key] = el
    }
    setNodes(next)
    setAppliedHtml(pending)
  }, [pending, appliedHtml, nodes])

  const portals: ReactNode[] = []
  for (const key of MOUNT_KEYS) {
    const target = nodes[key]
    const child = islands[key]
    if (!target || child == null) continue
    portals.push(createPortal(child, target, `hanye-mount-${key}`))
  }

  return (
    <>
      <div
        ref={hostRef}
        className={['theme-fullsite-root', className].filter(Boolean).join(' ')}
        data-hanye-fullsite="1"
      />
      {portals}
    </>
  )
}

export function hasFullSiteShell(templateHtml: Record<string, string> | undefined): boolean {
  return Boolean(templateHtml && String(templateHtml['app.shell.replace'] || '').trim())
}

export function hasFullSiteLogin(templateHtml: Record<string, string> | undefined): boolean {
  return Boolean(templateHtml && String(templateHtml['login.page.replace'] || '').trim())
}
