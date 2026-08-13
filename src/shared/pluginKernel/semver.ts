/**
 * Minimal semver compare / range check for plugin dependency resolution.
 * Supports: 1.2.3, =1.2.3, >=1.2.0, >1.0.0, <2.0.0, <=1.9.9, ^1.2.0, ~1.2.3
 */

export type Semver = { major: number; minor: number; patch: number; raw: string }

export function parseSemver(input: string): Semver | null {
  const m = String(input || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw: `${m[1]}.${m[2]}.${m[3]}`
  }
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

function satisfyOne(version: Semver, token: string): boolean {
  const t = token.trim()
  if (!t || t === '*' || t === 'x') return true
  const caret = t.match(/^\^(\d+\.\d+\.\d+)/)
  if (caret) {
    const base = parseSemver(caret[1])
    if (!base) return false
    if (compareSemver(version, base) < 0) return false
    if (base.major === 0) {
      if (base.minor === 0) return version.major === 0 && version.minor === 0 && version.patch === base.patch
      return version.major === 0 && version.minor === base.minor
    }
    return version.major === base.major
  }
  const tilde = t.match(/^~(\d+\.\d+\.\d+)/)
  if (tilde) {
    const base = parseSemver(tilde[1])
    if (!base) return false
    return (
      version.major === base.major &&
      version.minor === base.minor &&
      version.patch >= base.patch
    )
  }
  const op = t.match(/^(>=|<=|>|<|=)?\s*(v?\d+\.\d+\.\d+)/i)
  if (!op) {
    const exact = parseSemver(t)
    return exact ? compareSemver(version, exact) === 0 : false
  }
  const target = parseSemver(op[2])
  if (!target) return false
  const c = compareSemver(version, target)
  switch (op[1] || '=') {
    case '>=':
      return c >= 0
    case '<=':
      return c <= 0
    case '>':
      return c > 0
    case '<':
      return c < 0
    default:
      return c === 0
  }
}

/** Check version against range (space / || separated). */
export function satisfies(versionStr: string, range: string): boolean {
  const version = parseSemver(versionStr)
  if (!version) return false
  const r = String(range || '').trim()
  if (!r || r === '*' ) return true
  const alts = r.split(/\s*\|\|\s*/)
  return alts.some((alt) => {
    const parts = alt.trim().split(/\s+/)
    return parts.every((p) => satisfyOne(version, p))
  })
}
