/**
 * Site branding (name, title, logo, favicon, footer) applied across shell / login.
 */

export type SiteBranding = {
  siteName: string
  siteTitle: string
  siteLogo: string
  siteFavicon: string
  siteFooter: string
}

export const DEFAULT_SITE_NAME = 'hanye-3D打印机监控台'

export function defaultSiteBranding(): SiteBranding {
  return {
    siteName: DEFAULT_SITE_NAME,
    siteTitle: '',
    siteLogo: '',
    siteFavicon: '',
    siteFooter: ''
  }
}

/** Accept data-URL images (png/jpeg/gif/webp/svg/ico), empty string clears */
export function normalizeDataImage(v: unknown, maxLen = 2_500_000): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  if (!s) return ''
  if (!s.startsWith('data:image/')) return ''
  if (s.length >= maxLen) return ''
  return s
}

export function normalizeSiteName(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_SITE_NAME
  const s = v.trim().slice(0, 80)
  return s || DEFAULT_SITE_NAME
}

export function normalizeSiteTitle(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, 120)
}

export function normalizeSiteFooter(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, 500)
}

export function normalizeSiteBranding(raw: unknown): SiteBranding {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    siteName: normalizeSiteName(o.siteName),
    siteTitle: normalizeSiteTitle(o.siteTitle),
    siteLogo: normalizeDataImage(o.siteLogo),
    siteFavicon: normalizeDataImage(o.siteFavicon, 800_000),
    siteFooter: normalizeSiteFooter(o.siteFooter)
  }
}

/** Browser tab title: custom title, else site name */
export function resolveDocumentTitle(b: Pick<SiteBranding, 'siteName' | 'siteTitle'>): string {
  const t = String(b.siteTitle || '').trim()
  if (t) return t
  return String(b.siteName || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME
}
