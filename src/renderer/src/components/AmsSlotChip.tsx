import { colorSwatchBorder, normalizeColor, relativeLuminance } from '../utils/color'

type AmsSlot = {
  id: number
  material: string
  color: string
  remain: number
}

/** Filament slot chip: color swatch + always-readable label on dark UI. */
export function AmsSlotChip({ slot }: { slot: AmsSlot }) {
  const bg = normalizeColor(slot.color)
  const border = colorSwatchBorder(bg)
  const isEmpty = !slot.material || slot.material === '空'
  const light = relativeLuminance(bg) > 0.72

  return (
    <span
      className="ams-slot-chip"
      title={`${slot.material} · ${slot.remain}% · ${bg}`}
      style={{
        borderColor: light ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.14)'
      }}
    >
      <span
        className="ams-slot-swatch"
        style={{
          background: isEmpty ? 'repeating-linear-gradient(45deg,#555 0 4px,#333 4px 8px)' : bg,
          borderColor: border,
          boxShadow: light ? 'inset 0 0 0 1px rgba(0,0,0,0.25)' : 'inset 0 0 0 1px rgba(255,255,255,0.12)'
        }}
      />
      <span className="ams-slot-label">
        <span className="ams-slot-material">{slot.material || '空'}</span>
        <span className="ams-slot-remain">{slot.remain}%</span>
      </span>
    </span>
  )
}
