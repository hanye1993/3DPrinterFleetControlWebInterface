export type PricingMode = 'markup' | 'margin'

export type QuoteCosts = {
  mat: number
  elec: number
  wear: number
  labor: number
  fixed: number
  base: number
  costWithFail: number
  kwh: number
  perUnit: number
  profit: number
  profitRate: number
  grand: number
  appliedFloor: boolean
}

export type QuoteCalcParams = {
  weightG: number
  wastePct: number
  pricePerKg: number
  watts: number
  printHours: number
  electricity: number
  wearPerHour: number
  laborMinutes: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: PricingMode
  markupPct: number
  marginPct: number
  minPrice: number
  qty: number
}

export const QUOTE_MATERIAL_PRESETS = [
  { id: 'pla', label: 'PLA', tech: 'fdm' as const, pricePerKg: 65, density: 1.24 },
  { id: 'petg', label: 'PETG', tech: 'fdm' as const, pricePerKg: 75, density: 1.27 },
  { id: 'abs', label: 'ABS', tech: 'fdm' as const, pricePerKg: 70, density: 1.04 },
  { id: 'asa', label: 'ASA', tech: 'fdm' as const, pricePerKg: 95, density: 1.07 },
  { id: 'tpu', label: 'TPU', tech: 'fdm' as const, pricePerKg: 120, density: 1.21 },
  { id: 'pa-cf', label: '尼龙 / 碳纤维', tech: 'fdm' as const, pricePerKg: 280, density: 1.15 },
  { id: 'resin-std', label: '标准树脂', tech: 'resin' as const, pricePerKg: 90, density: 1.1 },
  { id: 'resin-abs', label: '高韧树脂', tech: 'resin' as const, pricePerKg: 140, density: 1.12 },
  { id: 'resin-cast', label: '铸造树脂', tech: 'resin' as const, pricePerKg: 220, density: 1.13 }
]

export const QUOTE_PRINTER_PRESETS = [
  { id: 'a1mini', label: 'Bambu A1 mini', watts: 90 },
  { id: 'a1', label: 'Bambu A1', watts: 150 },
  { id: 'p1s', label: 'Bambu P1S', watts: 130 },
  { id: 'x1c', label: 'Bambu X1C', watts: 140 },
  { id: 'k2', label: '创想 K2 / 同类', watts: 350 },
  { id: 'klipper', label: 'Klipper 通用机', watts: 200 },
  { id: 'resin-elegoo', label: '光固化（中型）', watts: 120 },
  { id: 'custom', label: '自定义功率', watts: 200 }
]

export function calcQuoteCosts(params: QuoteCalcParams): QuoteCosts {
  const w = Math.max(0, Number(params.weightG) || 0)
  const waste = Math.max(0, Number(params.wastePct) || 0) / 100
  const mat = (w * (1 + waste) * (Number(params.pricePerKg) || 0)) / 1000
  const printHours = Math.max(0, Number(params.printHours) || 0)
  const kwh = ((Number(params.watts) || 0) / 1000) * printHours
  const elec = kwh * (Number(params.electricity) || 0)
  const wear = printHours * (Number(params.wearPerHour) || 0)
  const labor = ((Number(params.laborMinutes) || 0) / 60) * (Number(params.laborRate) || 0)
  const fixed = (Number(params.packaging) || 0) + (Number(params.shipping) || 0)
  const base = mat + elec + wear + labor + fixed
  const fail = Math.max(0, Number(params.failPct) || 0) / 100
  const costWithFail = base * (1 + fail)

  let quote = costWithFail
  if (params.pricingMode === 'margin') {
    const m = Math.min(99.9, Math.max(0, Number(params.marginPct) || 0)) / 100
    quote = m >= 0.999 ? costWithFail : costWithFail / (1 - m)
  } else {
    quote = costWithFail * (1 + Math.max(0, Number(params.markupPct) || 0) / 100)
  }
  const floor = Math.max(0, Number(params.minPrice) || 0)
  const perUnit = Math.max(quote, floor)
  const n = Math.max(1, Math.floor(Number(params.qty) || 1))
  const profit = perUnit - costWithFail
  return {
    mat,
    elec,
    wear,
    labor,
    fixed,
    base,
    costWithFail,
    kwh,
    perUnit,
    profit,
    profitRate: perUnit > 0 ? (profit / perUnit) * 100 : 0,
    grand: perUnit * n,
    appliedFloor: quote < floor
  }
}

export function parseGcodeMeta(text: string): { grams?: number; hours?: number; note?: string } {
  const out: { grams?: number; hours?: number; note?: string } = {}
  // Prefer last 2000 lines — Orca writes "; filament used [g]" at EOF
  const all = String(text || '').split(/\r?\n/)
  const lines = all.length > 2500 ? all.slice(-2000).concat(all.slice(0, 400)) : all

  const gramPatterns = [
    /;\s*total filament used \[g\]\s*=\s*([\d.]+)/i,
    /;\s*filament used \[g\]\s*=\s*([\d.]+)/i,
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*g/i,
    /;\s*filament_weight(?:_g)?\s*[:=]\s*([\d.]+)/i,
    /;\s*filament weight\s*[:=]\s*([\d.]+)/i,
    /;\s*material_weight\s*[:=]\s*([\d.]+)/i,
    /;\s*total filament weight \[g\]\s*[:=]\s*([\d.]+)/i
  ]
  const lengthPatterns = [
    /;\s*filament used \[mm\]\s*[:=]\s*([\d.]+)/i,
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*mm/i,
    /;\s*filament length\s*[:=]\s*([\d.]+)/i
  ]

  for (const line of lines) {
    if (out.grams == null) {
      for (const re of gramPatterns) {
        const m = line.match(re)
        if (m) {
          out.grams = Number(m[1])
          break
        }
      }
    }
    if (out.hours == null) {
      const cura = line.match(/^;\s*TIME\s*[:=]\s*(\d+)/i)
      if (cura) out.hours = Number(cura[1]) / 3600
      const bambu = line.match(
        /;\s*total estimated time\s*[:=]\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i
      )
      if (bambu) {
        out.hours =
          (Number(bambu[1] || 0) || 0) +
          (Number(bambu[2] || 0) || 0) / 60 +
          (Number(bambu[3] || 0) || 0) / 3600
      }
      const prusa = line.match(
        /;\s*estimated printing time[^:=]*[:=]\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i
      )
      if (prusa) {
        out.hours =
          (Number(prusa[1] || 0) || 0) * 24 +
          (Number(prusa[2] || 0) || 0) +
          (Number(prusa[3] || 0) || 0) / 60 +
          (Number(prusa[4] || 0) || 0) / 3600
      }
      const orca = line.match(
        /;\s*model printing time\s*[:=]\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i
      )
      if (orca) {
        out.hours =
          (Number(orca[1] || 0) || 0) +
          (Number(orca[2] || 0) || 0) / 60 +
          (Number(orca[3] || 0) || 0) / 3600
      }
    }
  }

  if (out.grams == null) {
    for (const line of lines) {
      for (const re of lengthPatterns) {
        const m = line.match(re)
        if (m) {
          const mm = Number(m[1])
          const r = 1.75 / 2
          const volCm3 = (Math.PI * r * r * mm) / 1000
          out.grams = volCm3 * 1.24
          out.note = '由线长估算重量（按 PLA 1.75mm / 1.24g·cm⁻³）'
          break
        }
      }
      if (out.grams != null) break
    }
  }

  if (out.grams != null && !Number.isFinite(out.grams)) delete out.grams
  if (out.hours != null && !Number.isFinite(out.hours)) delete out.hours
  return out
}

/** Spool purchase price ¥ → ¥/kg */
export function spoolPricePerKg(spool: {
  price?: number
  totalGrams?: number
}): number | undefined {
  const price = Number(spool.price)
  const grams = Number(spool.totalGrams)
  if (!Number.isFinite(price) || price < 0) return undefined
  if (!Number.isFinite(grams) || grams <= 0) return undefined
  return price / (grams / 1000)
}
