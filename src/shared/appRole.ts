/** App launch role: server hosts printers + admin UI; client logs in remotely */
export type AppRole = 'server' | 'client'

export function resolveAppRole(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): AppRole {
  const fromEnv = (env.HANYE_APP_ROLE || env.APP_ROLE || '').toLowerCase()
  if (fromEnv === 'client' || fromEnv === 'server') return fromEnv
  const idx = argv.findIndex((a) => a === '--role' || a.startsWith('--role='))
  if (idx >= 0) {
    const a = argv[idx]
    const v = a.includes('=') ? a.split('=')[1] : argv[idx + 1]
    if (v === 'client' || v === 'server') return v
  }
  try {
    // Optional stamp on package.json (e.g. HANYE_APP_ROLE / build metadata)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../package.json') as { hanyeAppRole?: string }
    if (pkg.hanyeAppRole === 'client' || pkg.hanyeAppRole === 'server') return pkg.hanyeAppRole
  } catch {
    /* ignore */
  }
  return 'server'
}
