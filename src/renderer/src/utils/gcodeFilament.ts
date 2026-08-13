/**
 * Parse filament grams from Orca / Prusa / Bambu / Cura style G-code comments.
 * Orca writes summary tags near the **end** of the file:
 *   ; filament used [g] = 42.94
 *   ; total filament used [g] = 42.94
 */

export function parseGcodeFilamentGrams(text: string): number | null {
  if (!text) return null
  const lines = String(text).split(/\r?\n/)

  // Prefer "total filament used [g]" (Orca multi-tool total)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const total = line.match(/;\s*total filament used \[g\]\s*=\s*([\d.]+)/i)
    if (total) {
      const n = Number(total[1])
      if (Number.isFinite(n) && n > 0) return roundG(n)
    }
  }

  // "; filament used [g] = 12.3" or multi "; filament used [g] = 1.2, 3.4"
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const multi = line.match(/;\s*filament used \[g\]\s*=\s*([\d.,\s]+)/i)
    if (multi) {
      let sum = 0
      let any = false
      for (const part of multi[1].split(/[,\s]+/)) {
        if (!part) continue
        const n = Number(part)
        if (Number.isFinite(n) && n > 0) {
          sum += n
          any = true
        }
      }
      if (any) return roundG(sum)
    }
  }

  const patterns = [
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*g\b/i,
    /;\s*filament_weight(?:_g)?\s*[:=]\s*([\d.]+)/i,
    /;\s*filament weight\s*[:=]\s*([\d.]+)/i,
    /;\s*total filament weight \[g\]\s*[:=]\s*([\d.]+)/i,
    /;\s*material_weight\s*[:=]\s*([\d.]+)/i
  ]
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    for (const re of patterns) {
      const m = line.match(re)
      if (!m) continue
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return roundG(n)
    }
  }

  // Fallback: length → PLA estimate
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const mm = line.match(/;\s*filament used \[mm\]\s*=\s*([\d.]+)/i)
    if (mm) {
      const lengthMm = Number(mm[1])
      if (Number.isFinite(lengthMm) && lengthMm > 0) {
        const r = 1.75 / 2
        const volCm3 = (Math.PI * r * r * lengthMm) / 1000
        return roundG(volCm3 * 1.24)
      }
    }
    const meters = line.match(/;\s*Filament used\s*[:=]\s*([\d.]+)\s*m\b/i)
    if (meters) {
      const m = Number(meters[1])
      if (Number.isFinite(m) && m > 0) {
        const lengthMm = m * 1000
        const r = 1.75 / 2
        const volCm3 = (Math.PI * r * r * lengthMm) / 1000
        return roundG(volCm3 * 1.24)
      }
    }
  }

  return null
}

function roundG(n: number): number {
  return Math.round(n * 100) / 100
}
