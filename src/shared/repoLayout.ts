import { existsSync } from 'fs'
import { join, resolve } from 'path'

/** Repo-root layout after assets/ + ops/ consolidation. */
export const REPO = {
  assetsPlugins: 'assets/plugins',
  assetsThemes: 'assets/themes',
  assetsExamples: 'assets/examples',
  assetsYolo: 'assets/yolo',
  opsSql: 'ops/sql',
  opsDocs: 'ops/docs',
  opsScripts: 'ops/scripts',
  webApp: 'dist/web'
} as const

export function cwdJoin(...parts: string[]): string {
  return resolve(process.cwd(), ...parts)
}

/** First existing directory among cwd-relative candidates, else null. */
export function resolveRepoDir(...candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = cwdJoin(rel)
    if (existsSync(abs)) return abs
  }
  return null
}

export function bundledPluginsDir(fromDirname?: string): string | undefined {
  const fromCwd = resolveRepoDir(REPO.assetsPlugins, 'plugins')
  if (fromCwd) return fromCwd
  if (fromDirname) {
    const legacy = [
      join(fromDirname, '../../assets/plugins'),
      join(fromDirname, '../../plugins')
    ]
    for (const p of legacy) {
      if (existsSync(p)) return p
    }
  }
  return undefined
}

export function bundledThemesDir(fromDirname?: string): string | undefined {
  const fromCwd = resolveRepoDir(REPO.assetsThemes, 'themes')
  if (fromCwd) return fromCwd
  if (fromDirname) {
    const legacy = [
      join(fromDirname, '../../assets/themes'),
      join(fromDirname, '../../themes')
    ]
    for (const p of legacy) {
      if (existsSync(p)) return p
    }
  }
  return undefined
}

export function docsRootCandidates(fromDirname?: string): string[] {
  const list = [cwdJoin(REPO.opsDocs), cwdJoin('docs')]
  if (fromDirname) {
    list.push(
      join(fromDirname, '../../../ops/docs'),
      join(fromDirname, '../../../../ops/docs'),
      join(fromDirname, '../../../docs'),
      join(fromDirname, '../../../../docs')
    )
  }
  return list
}

export function sqlSchemaPath(): string {
  const dir = resolveRepoDir(REPO.opsSql, 'sql')
  return join(dir || cwdJoin(REPO.opsSql), 'schema.sql')
}

export function yoloScriptCandidates(fromDirname?: string): string[] {
  const list = [
    cwdJoin(REPO.assetsYolo, 'detect_spaghetti.py'),
    cwdJoin('yolo', 'detect_spaghetti.py')
  ]
  if (fromDirname) {
    list.push(
      join(fromDirname, '..', '..', '..', 'assets', 'yolo', 'detect_spaghetti.py'),
      join(fromDirname, '..', '..', 'assets', 'yolo', 'detect_spaghetti.py'),
      join(fromDirname, '..', '..', '..', 'yolo', 'detect_spaghetti.py'),
      join(fromDirname, '..', '..', 'yolo', 'detect_spaghetti.py')
    )
  }
  return list
}

export const DEFAULT_YOLO_WEIGHTS = 'assets/yolo/best.pt'
