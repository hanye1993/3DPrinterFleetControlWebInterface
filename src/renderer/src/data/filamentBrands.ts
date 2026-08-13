import type { FilamentBrand, MaterialCategory } from '../types/filament'

export const FILAMENT_BRANDS: FilamentBrand[] = [
  { id: 'bambu', name: '拓竹', nameEn: 'Bambu Lab', kind: 'fdm', popular: true },
  { id: 'esun', name: '易生', nameEn: 'eSUN', kind: 'both', popular: true },
  { id: 'polymaker', name: 'Polymaker', nameEn: 'Polymaker', kind: 'fdm', popular: true },
  { id: 'sunlu', name: '三绿', nameEn: 'SUNLU', kind: 'both', popular: true },
  { id: 'creality', name: '创想', nameEn: 'Creality', kind: 'both', popular: true },
  { id: 'anycubic', name: '纵维立方', nameEn: 'Anycubic', kind: 'both' },
  { id: 'elegoo', name: '爱乐酷', nameEn: 'ELEGOO', kind: 'both' },
  { id: 'prusa', name: 'Prusament', nameEn: 'Prusa', kind: 'fdm' },
  { id: 'hatchbox', name: 'Hatchbox', nameEn: 'Hatchbox', kind: 'fdm' },
  { id: 'overture', name: 'Overture', nameEn: 'Overture', kind: 'fdm' },
  { id: 'kingroon', name: 'Kingroon', nameEn: 'Kingroon', kind: 'fdm' },
  { id: 'jayo', name: 'JAYO', nameEn: 'JAYO', kind: 'fdm' },
  { id: 'flashforge', name: '闪铸', nameEn: 'Flashforge', kind: 'fdm' },
  { id: 'resione', name: 'Resione', nameEn: 'Resione', kind: 'resin', popular: true },
  { id: 'siraya', name: 'Siraya Tech', nameEn: 'Siraya Tech', kind: 'resin', popular: true },
  { id: 'phrozen', name: 'Phrozen', nameEn: 'Phrozen', kind: 'resin' },
  { id: 'other', name: '其他 / 自用', nameEn: 'Other', kind: 'both', popular: true }
]

const CUSTOM_PREFIX = 'custom:'

export function findBrand(id: string): FilamentBrand | undefined {
  return FILAMENT_BRANDS.find((b) => b.id === id)
}

export function brandsForTech(tech: MaterialCategory): FilamentBrand[] {
  return FILAMENT_BRANDS.filter((b) => b.kind === tech || b.kind === 'both')
}

export function isCustomBrandId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_PREFIX)
}

/** Build stable id for a free-text brand name */
export function customBrandId(name: string): string {
  const n = name.trim()
  if (!n) return 'other'
  return `${CUSTOM_PREFIX}${n}`
}

export function customBrandNameFromId(id: string): string {
  if (!isCustomBrandId(id)) return ''
  return id.slice(CUSTOM_PREFIX.length)
}

/** Resolve display label for a spool / quote brand field */
export function brandLabel(brandId: string, brandName?: string | null): string {
  const custom = (brandName || '').trim()
  if (custom) return custom
  if (isCustomBrandId(brandId)) {
    return customBrandNameFromId(brandId) || brandId
  }
  const b = findBrand(brandId)
  if (!b) return brandId || '—'
  return b.nameEn && b.nameEn !== b.name ? `${b.name} (${b.nameEn})` : b.name
}

/**
 * Normalize form selection into brandId + optional brandName.
 * Accepts catalog id, custom:* id, or raw typed name.
 */
export function resolveBrandFields(
  raw: string,
  tech: MaterialCategory
): { brandId: string; brandName?: string } {
  const v = String(raw || '').trim()
  if (!v) return { brandId: 'other', brandName: undefined }
  const known = findBrand(v)
  if (known) return { brandId: known.id, brandName: undefined }
  if (isCustomBrandId(v)) {
    const name = customBrandNameFromId(v)
    return { brandId: customBrandId(name || '未命名'), brandName: name || '未命名' }
  }
  // Typed free text — match catalog by display name first
  const byName = brandsForTech(tech).find(
    (b) =>
      b.name === v ||
      b.nameEn === v ||
      `${b.name} / ${b.nameEn}` === v ||
      `${b.name} (${b.nameEn})` === v
  )
  if (byName) return { brandId: byName.id, brandName: undefined }
  return { brandId: customBrandId(v), brandName: v }
}
