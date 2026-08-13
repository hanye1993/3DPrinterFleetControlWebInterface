import type { MaterialCategory, MaterialType } from '../types/filament'

export const FILAMENT_MATERIALS: MaterialType[] = [
  { id: 'pla', label: 'PLA', category: 'fdm' },
  { id: 'pla-plus', label: 'PLA+', category: 'fdm' },
  { id: 'petg', label: 'PETG', category: 'fdm' },
  { id: 'abs', label: 'ABS', category: 'fdm' },
  { id: 'asa', label: 'ASA', category: 'fdm' },
  { id: 'tpu', label: 'TPU', category: 'fdm' },
  { id: 'pa', label: '尼龙 PA', category: 'fdm' },
  { id: 'pa-cf', label: '尼龙 / 碳纤维', category: 'fdm' },
  { id: 'pc', label: 'PC', category: 'fdm' },
  { id: 'pva', label: 'PVA', category: 'fdm' },
  { id: 'hips', label: 'HIPS', category: 'fdm' },
  { id: 'other-fdm', label: '其他线材', category: 'fdm' },
  { id: 'resin-std', label: '标准树脂', category: 'resin' },
  { id: 'resin-abs', label: '高韧树脂', category: 'resin' },
  { id: 'resin-cast', label: '铸造树脂', category: 'resin' },
  { id: 'resin-water', label: '水洗树脂', category: 'resin' },
  { id: 'resin-flex', label: '柔性树脂', category: 'resin' },
  { id: 'other-resin', label: '其他树脂', category: 'resin' }
]

export function materialsForTech(tech: MaterialCategory): MaterialType[] {
  return FILAMENT_MATERIALS.filter((m) => m.category === tech)
}

export function materialLabel(id: string): string {
  return FILAMENT_MATERIALS.find((m) => m.id === id)?.label || id
}
