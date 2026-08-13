/**
 * Plugin SQL lifecycle: install.sql / uninstall.sql / migrations/vN.sql
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export type SqlRunner = {
  available: boolean
  execute?: (sql: string, params?: unknown[]) => Promise<unknown> | unknown
  query?: (sql: string, params?: unknown[]) => Promise<unknown> | unknown
}

function listMigrationFiles(dir: string): Array<{ version: number; path: string }> {
  if (!existsSync(dir)) return []
  const out: Array<{ version: number; path: string }> = []
  for (const name of readdirSync(dir)) {
    const m = name.match(/^(?:v)?(\d+)\.sql$/i)
    if (!m) continue
    out.push({ version: parseInt(m[1], 10), path: join(dir, name) })
  }
  return out.sort((a, b) => a.version - b.version)
}

export function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n|;\s*$/m)
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
    )
    .filter(Boolean)
}

async function runSqlFile(db: SqlRunner, filePath: string): Promise<void> {
  if (!existsSync(filePath)) return
  const exec = db.execute || db.query
  if (!exec) return
  const raw = readFileSync(filePath, 'utf8')
  for (const stmt of splitSql(raw)) {
    await Promise.resolve(exec.call(db, stmt, []))
  }
}

export async function runPluginSqlFile(db: SqlRunner, pluginDir: string, fileName: string): Promise<boolean> {
  if (!db.available) return false
  const p = join(pluginDir, fileName)
  if (!existsSync(p)) return false
  await runSqlFile(db, p)
  return true
}

export async function applyPluginSqlMigrations(opts: {
  pluginDir: string
  currentVersion: number
  targetVersion: number
  db: SqlRunner
}): Promise<number> {
  const { pluginDir, currentVersion, targetVersion, db } = opts
  if (!db.available || targetVersion <= currentVersion) return currentVersion
  const files = listMigrationFiles(join(pluginDir, 'migrations')).filter(
    (f) => f.version > currentVersion && f.version <= targetVersion
  )
  let applied = currentVersion
  const exec = db.execute || db.query
  if (!exec) return currentVersion
  for (const f of files) {
    await runSqlFile(db, f.path)
    applied = f.version
  }
  return applied
}

/** Fresh install: install.sql then migrations up to target */
export async function applyPluginInstallSql(opts: {
  pluginDir: string
  targetVersion: number
  db: SqlRunner
}): Promise<number> {
  const { pluginDir, targetVersion, db } = opts
  if (!db.available) return 0
  await runPluginSqlFile(db, pluginDir, 'install.sql')
  if (targetVersion > 0) {
    return applyPluginSqlMigrations({
      pluginDir,
      currentVersion: 0,
      targetVersion,
      db
    })
  }
  return existsSync(join(pluginDir, 'install.sql')) ? Math.max(1, targetVersion) : 0
}

export async function applyPluginUninstallSql(opts: {
  pluginDir: string
  db: SqlRunner
}): Promise<void> {
  if (!opts.db.available) return
  await runPluginSqlFile(opts.db, opts.pluginDir, 'uninstall.sql')
}
