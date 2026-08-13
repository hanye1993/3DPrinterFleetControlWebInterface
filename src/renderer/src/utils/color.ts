/** Relative luminance 0–1 (sRGB). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function parseHex(input: string): [number, number, number] | null {
  let h = (input || '').trim().replace(/^#/, '')
  if (h.length === 8) h = h.slice(0, 6) // strip alpha from Bambu RRGGBBAA
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function normalizeColor(color?: string): string {
  if (!color) return '#888888'
  const rgb = parseHex(color)
  if (!rgb) return color.startsWith('#') ? color : `#${color}`
  const [r, g, b] = rgb
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** Pick black/white text for readable contrast on a solid background. */
export function contrastingText(bgHex: string): '#111111' | '#f5f5f5' {
  return relativeLuminance(normalizeColor(bgHex)) > 0.55 ? '#111111' : '#f5f5f5'
}

/** Border so very light colors stay visible on dark UI. */
export function colorSwatchBorder(bgHex: string): string {
  const L = relativeLuminance(normalizeColor(bgHex))
  if (L > 0.85) return 'rgba(0,0,0,0.35)'
  if (L < 0.12) return 'rgba(255,255,255,0.35)'
  return 'rgba(255,255,255,0.18)'
}
