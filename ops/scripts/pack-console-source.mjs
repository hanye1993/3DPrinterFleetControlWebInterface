#!/usr/bin/env node
/**
 * 把控制台源码打成仓库根目录 ZIP（不含 node_modules / 运行数据 / 密钥 / 应用市场）。
 *
 * 用法：npm run pack:source
 * 输出：./hanye-printer-monitor-<version>-src.zip
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.0.0').replace(/^v/i, '')
const folder = `hanye-printer-monitor-${version}`
const zipName = `${folder}-src.zip`
const zipPath = join(repoRoot, zipName)

const excludes = [
  '.git',
  'node_modules',
  '/dist/',
  '/data/',
  '应用市场',
  '.env',
  '.env.local',
  '.DS_Store',
  '.cursor',
  '.tools',
  '.transcript-extract',
  'dist-plugins',
  'dist-plugins-cn',
  'plugins-themes-packs',
  'plugins-themes-packs.zip',
  '*.zip',
  '*.tsbuildinfo',
  'close_extensions.mjs',
  'close_extensions.html'
]

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout || r.status}`)
  }
  return r
}

const stage = mkdtempSync(join(tmpdir(), 'hanye-src-'))
const dest = join(stage, folder)
mkdirSync(dest, { recursive: true })

try {
  const rsyncExcludes = excludes.flatMap((x) => ['--exclude', x])
  run('rsync', ['-a', ...rsyncExcludes, `${repoRoot}/`, `${dest}/`])

  mkdirSync(join(dest, 'data'), { recursive: true })
  const gitkeep = join(repoRoot, 'data/.gitkeep')
  if (existsSync(gitkeep)) {
    run('cp', [gitkeep, join(dest, 'data/.gitkeep')])
  }
  rmSync(join(dest, 'docker/.env'), { force: true })

  if (existsSync(zipPath)) rmSync(zipPath, { force: true })
  run('zip', ['-r', '-q', zipPath, folder], { cwd: stage })

  const st = run('ls', ['-lh', zipPath])
  console.log(`packed ${zipName}`)
  console.log(String(st.stdout || '').trim())
} finally {
  rmSync(stage, { recursive: true, force: true })
}
