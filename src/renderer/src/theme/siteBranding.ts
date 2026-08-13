import {
  DEFAULT_SITE_NAME,
  resolveDocumentTitle,
  type SiteBranding
} from '@shared/siteBranding'

const FAVICON_ID = 'hanye-site-favicon'

/** Apply document.title + favicon link from branding settings */
export function applySiteBranding(
  branding: Pick<SiteBranding, 'siteName' | 'siteTitle' | 'siteFavicon'>
): void {
  if (typeof document === 'undefined') return
  document.title = resolveDocumentTitle(branding)

  let link = document.getElementById(FAVICON_ID) as HTMLLinkElement | null
  const href = String(branding.siteFavicon || '').trim()
  if (!href) {
    if (link) link.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.id = FAVICON_ID
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  // Guess type from data URL
  const m = /^data:(image\/[^;]+)/i.exec(href)
  if (m) link.type = m[1]!
  else link.removeAttribute('type')
  link.href = href
}

export function resolveSiteLogoUrl(logo: string | undefined, fallback: string): string {
  const s = String(logo || '').trim()
  return s.startsWith('data:image/') ? s : fallback
}

export function resolveSiteDisplayName(name: string | undefined): string {
  const s = String(name || '').trim()
  return s || DEFAULT_SITE_NAME
}
