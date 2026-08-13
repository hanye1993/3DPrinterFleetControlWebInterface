/**
 * Installable theme packs (Discuz-style .htm templates + layout engines + styles).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync
} from 'fs'
import { join, resolve, basename, dirname } from 'path'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { unzipSync } from 'fflate'
import {
  DEFAULT_THEME_ID,
  type ActiveThemeUiPayload,
  type ThemePackManifest,
  type ThemePackRuntime,
  type ThemesStateFile,
  defaultThemesState,
  normalizeThemesState,
  parseThemeJson,
  resolveThemeStyle
} from '../../shared/themePack'
import {
  createDisabledExtensionDbApi,
  type ExtensionDbApi
} from '../plugin/extensionDb'
import { DefaultTemplateEngine } from '../plugin/kernel/TemplateEngine'

export type ThemeServerApi = {
  identifier: string
  themeDir: string
  log: (...args: unknown[]) => void
  db: ExtensionDbApi
  getSettings: () => Record<string, unknown>
}

export type ThemeHostDeps = {
  dataRoot: string
  bundledThemesDir?: string
  /** Optional examples root (repo ./assets/examples) — scanned for theme-* */
  exampleThemesDir?: string
  /** When set (MySQL mode), themes-state.json is not used */
  statePersistence?: {
    load: () => unknown | null
    save: (data: unknown) => void
  }
  getDbApi?: (identifier: string) => ExtensionDbApi
  getSettings?: () => Record<string, unknown>
  getActivePackId: () => string
  setActivePackId: (id: string) => Promise<void>
  getActiveStyleId: () => string
  setActiveStyleId?: (id: string) => Promise<void>
}

function safeId(id: string): string {
  const s = String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
  if (!s || s.includes('..')) throw new Error('非法主题 identifier')
  return s
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true })
}

function copyDir(src: string, dest: string): void {
  ensureDir(dest)
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dest, name)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

export class ThemeManager {
  private readonly deps: ThemeHostDeps
  private state: ThemesStateFile = defaultThemesState()
  private readonly require = createRequire(__filename)
  /** Dedicated Discuz-like engine (not shared with PluginManager). */
  private readonly templates = new DefaultTemplateEngine()

  constructor(deps: ThemeHostDeps) {
    this.deps = deps
  }

  get themesRoot(): string {
    return join(this.deps.dataRoot, 'themes')
  }

  get statePath(): string {
    return join(this.deps.dataRoot, 'themes-state.json')
  }

  init(): void {
    ensureDir(this.themesRoot)
    this.loadState()
    this.ensureBuiltinSynced()
    for (const id of Object.keys(this.state.installed)) {
      void this.runServerHook(id, 'register')
    }
    const active = this.getActive()
    if (active) this.syncTemplateEngine(active.pack.identifier)
  }

  private buildServerApi(identifier: string): ThemeServerApi {
    const id = safeId(identifier)
    return {
      identifier: id,
      themeDir: this.themeDir(id),
      log: (...args) => console.log(`[theme:${id}]`, ...args),
      db:
        this.deps.getDbApi?.(id) || createDisabledExtensionDbApi('theme', id),
      getSettings: () => this.deps.getSettings?.() || {}
    }
  }

  /** Load theme package server.js hooks: register | install | enable | uninstall */
  private async runServerHook(
    identifier: string,
    hook: 'register' | 'install' | 'enable' | 'uninstall'
  ): Promise<void> {
    const id = safeId(identifier)
    const file = join(this.themeDir(id), 'server.js')
    if (!existsSync(file)) return
    try {
      delete this.require.cache[file]
      const mod = this.require(file) as Record<string, unknown>
      const fn = mod[hook]
      if (typeof fn !== 'function') return
      const api = this.buildServerApi(id)
      await (fn as (api: ThemeServerApi) => unknown)(api)
    } catch (e) {
      console.error(`[theme:${id}] server.js ${hook} failed`, e)
    }
  }

  private loadState(): void {
    try {
      if (this.deps.statePersistence) {
        const raw = this.deps.statePersistence.load()
        if (raw != null) {
          this.state = normalizeThemesState(raw)
          return
        }
        this.state = defaultThemesState()
        this.saveState()
        return
      }
      if (!existsSync(this.statePath)) {
        this.state = defaultThemesState()
        this.saveState()
        return
      }
      this.state = normalizeThemesState(JSON.parse(readFileSync(this.statePath, 'utf8')))
    } catch {
      this.state = defaultThemesState()
    }
  }

  private saveState(): void {
    if (this.deps.statePersistence) {
      this.deps.statePersistence.save(this.state)
      return
    }
    ensureDir(dirname(this.statePath))
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
  }

  private themeDir(identifier: string): string {
    return join(this.themesRoot, identifier)
  }

  private bundledDir(identifier: string): string | null {
    const id = String(identifier || '').trim()
    if (!id) return null
    const root = this.deps.bundledThemesDir
    if (root) {
      const p = join(root, id)
      if (existsSync(p)) return p
    }
    const examples = this.deps.exampleThemesDir
    if (examples && existsSync(examples)) {
      for (const name of readdirSync(examples)) {
        if (!name.startsWith('theme-')) continue
        const dir = join(examples, name)
        if (!statSync(dir).isDirectory()) continue
        try {
          const m = this.readManifest(dir, name)
          if (m.identifier === id) return dir
        } catch {
          /* skip */
        }
      }
    }
    return null
  }

  /** Parent → … → pack (parents first). */
  private parentChain(pack: ThemePackManifest): string[] {
    const chain: string[] = []
    const seen = new Set<string>()
    let cur: ThemePackManifest | null = pack
    while (cur?.parent) {
      let pid: string
      try {
        pid = safeId(cur.parent)
      } catch {
        break
      }
      if (seen.has(pid) || pid === pack.identifier) break
      seen.add(pid)
      const parent = this.state.installed[pid]
      if (!parent) break
      chain.unshift(pid)
      cur = parent
    }
    return chain
  }

  /** Register parent theme dirs then active (later overrides earlier in TemplateEngine). */
  private syncTemplateEngine(packId: string): void {
    this.templates.reset()
    const pack = this.state.installed[packId]
    if (!pack) return
    const chain = [...this.parentChain(pack), pack.identifier]
    for (const id of chain) {
      const dir = this.themeDir(id)
      if (existsSync(dir)) this.templates.register(`theme:${id}`, dir)
    }
  }

  private buildTemplateContext(
    pack: ThemePackManifest,
    style: ReturnType<typeof resolveThemeStyle>,
    styleId: string
  ): Record<string, unknown> {
    const settings = this.deps.getSettings?.() || {}
    const siteName =
      String(settings.siteName || settings.brandName || settings.appTitle || 'hanye').trim() ||
      'hanye'
    return {
      packId: pack.identifier,
      styleId,
      siteName,
      packName: pack.name,
      packVersion: pack.version,
      styleName: style.name,
      pack: {
        identifier: pack.identifier,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        layout: pack.layout,
        deviceView: pack.deviceView,
        loginLayout: pack.loginLayout,
        parent: pack.parent || ''
      },
      style: {
        id: style.id,
        name: style.name,
        desc: style.desc
      },
      settings: {
        siteName,
        uiTheme: styleId,
        uiThemePack: pack.identifier
      }
    }
  }

  readManifest(dir: string, fallbackId?: string): ThemePackManifest {
    const p = join(dir, 'theme.json')
    if (!existsSync(p)) throw new Error('未找到 theme.json')
    return parseThemeJson(JSON.parse(readFileSync(p, 'utf8')), fallbackId || basename(dir))
  }

  /** Copy / refresh builtin packs from repo themes/ into data/themes */
  ensureBuiltinSynced(): void {
    const bundled = this.deps.bundledThemesDir
    if (!bundled || !existsSync(bundled)) return
    for (const name of readdirSync(bundled)) {
      const src = join(bundled, name)
      if (!statSync(src).isDirectory()) continue
      try {
        const man = this.readManifest(src, name)
        const dest = this.themeDir(man.identifier)
        // Always refresh builtin files so upgrades apply
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
        copyDir(src, dest)
        const now = new Date().toISOString()
        const prev = this.state.installed[man.identifier]
        this.state.installed[man.identifier] = {
          ...man,
          builtin: true,
          installedAt: prev?.installedAt || now,
          updatedAt: now,
          directory: `${man.identifier}/`
        }
      } catch (e) {
        console.error('[theme] sync builtin', name, e)
      }
    }
    if (!this.state.active) this.state.active = DEFAULT_THEME_ID
    if (!this.state.installed[this.state.active] && this.state.installed[DEFAULT_THEME_ID]) {
      this.state.active = DEFAULT_THEME_ID
    }
    this.saveState()
  }

  list(): ThemePackRuntime[] {
    return Object.values(this.state.installed).sort((a, b) => {
      if (a.identifier === DEFAULT_THEME_ID) return -1
      if (b.identifier === DEFAULT_THEME_ID) return 1
      return a.identifier.localeCompare(b.identifier)
    })
  }

  listBundled(): Array<{ identifier: string; name: string; version: string }> {
    const out: Array<{ identifier: string; name: string; version: string }> = []
    const seen = new Set<string>()
    const pushDir = (dir: string, fallbackId: string) => {
      try {
        const m = this.readManifest(dir, fallbackId)
        if (seen.has(m.identifier)) return
        seen.add(m.identifier)
        out.push({ identifier: m.identifier, name: m.name, version: m.version })
      } catch {
        /* skip */
      }
    }
    const bundled = this.deps.bundledThemesDir
    if (bundled && existsSync(bundled)) {
      for (const name of readdirSync(bundled)) {
        const dir = join(bundled, name)
        if (!statSync(dir).isDirectory()) continue
        pushDir(dir, name)
      }
    }
    const examples = this.deps.exampleThemesDir
    if (examples && existsSync(examples)) {
      for (const name of readdirSync(examples)) {
        if (!name.startsWith('theme-')) continue
        const dir = join(examples, name)
        if (!statSync(dir).isDirectory()) continue
        pushDir(dir, name)
      }
    }
    return out
  }

  get(identifier: string): ThemePackRuntime | null {
    return this.state.installed[identifier] || null
  }

  getActive(): { pack: ThemePackRuntime; styleId: string } | null {
    const activeId = this.deps.getActivePackId() || this.state.active || DEFAULT_THEME_ID
    const pack = this.state.installed[activeId] || this.state.installed[DEFAULT_THEME_ID]
    if (!pack) return null
    const styleId = this.deps.getActiveStyleId() || pack.defaultStyle
    return { pack, styleId }
  }

  /** Public payload for SPA ThemeLoader (server-compiled .htm → templateHtml). */
  async getActiveUiPayload(): Promise<ActiveThemeUiPayload | null> {
    const active = this.getActive()
    if (!active) return null
    const { pack, styleId } = active
    const style = resolveThemeStyle(pack, styleId)
    const asset = (f: string) =>
      `/api/v1/themes/${encodeURIComponent(pack.identifier)}/asset/${f.replace(/^\/+/, '')}`
    const css = (pack.cssFiles || []).map(asset)
    const loginCss = (pack.loginCssFiles || []).map(asset)
    const layoutJs = (pack.layoutJs || []).map(asset)

    // Legacy asset URL map (optional clients / debugging)
    const templates: Record<string, string> = {}
    for (const [name, rel] of Object.entries(pack.templates || {})) {
      templates[name] = asset(rel)
    }

    this.syncTemplateEngine(pack.identifier)
    const ctx = this.buildTemplateContext(pack, style, style.id)
    const collected = await this.templates.collectSlotsRendered(ctx)
    const templateHtml: Record<string, string> = {}
    for (const [name, arr] of Object.entries(collected)) {
      const html = arr[arr.length - 1]
      if (html) templateHtml[name] = html
    }
    // Ensure explicit theme.json template keys are rendered even if discovery missed aliases
    for (const name of Object.keys(pack.templates || {})) {
      if (templateHtml[name]) continue
      try {
        if (this.templates.has(name)) {
          templateHtml[name] = await this.templates.render(name, ctx)
        }
      } catch {
        /* ignore */
      }
    }

    // Resolve siteMode: full requires app.shell.replace; otherwise fall back to skin
    let siteMode: import('../../shared/themePack').ThemeSiteMode = pack.siteMode || 'skin'
    if (siteMode === 'full' && !templateHtml['app.shell.replace']) {
      console.warn(
        `[theme:${pack.identifier}] siteMode=full but missing app.shell.replace.htm — fallback to skin`
      )
      siteMode = 'skin'
    }

    return {
      packId: pack.identifier,
      styleId: style.id,
      pack: { ...pack, siteMode },
      style,
      layout: pack.layout || 'classic',
      deviceView: pack.deviceView || 'grid',
      loginLayout: pack.loginLayout || 'classic',
      siteMode,
      css,
      loginCss,
      layoutJs,
      templates,
      templateHtml,
      templateEngine: Object.keys(templateHtml).length > 0
    }
  }

  async setActive(identifier: string): Promise<ThemePackRuntime> {
    const id = safeId(identifier)
    const st = this.state.installed[id]
    if (!st) throw new Error('主题未安装')
    this.state.active = id
    this.saveState()
    await this.deps.setActivePackId(id)
    const styleId = this.deps.getActiveStyleId()
    if (!st.styles.some((s) => s.id === styleId)) {
      const next = st.defaultStyle || st.styles[0]?.id
      if (next && this.deps.setActiveStyleId) await this.deps.setActiveStyleId(next)
    }
    this.syncTemplateEngine(id)
    await this.runServerHook(id, 'enable')
    return st
  }

  resolveAsset(identifier: string, relPath: string): string | null {
    const id = safeId(identifier)
    const base = this.themeDir(id)
    const full = resolve(base, relPath)
    if (!full.startsWith(resolve(base))) return null
    if (!existsSync(full) || !statSync(full).isFile()) return null
    return full
  }

  async installFromDirectory(srcDir: string): Promise<ThemePackRuntime> {
    const manifest = this.readManifest(srcDir)
    const id = safeId(manifest.identifier)
    if (id === DEFAULT_THEME_ID && manifest.builtin) {
      // allow overwrite of default from bundled only via sync
    }
    const dest = this.themeDir(id)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    copyDir(srcDir, dest)
    const now = new Date().toISOString()
    const prev = this.state.installed[id]
    const st: ThemePackRuntime = {
      ...manifest,
      builtin: manifest.builtin || id === DEFAULT_THEME_ID,
      installedAt: prev?.installedAt || now,
      updatedAt: now,
      directory: `${id}/`
    }
    this.state.installed[id] = st
    this.saveState()
    await this.runServerHook(id, 'install')
    await this.runServerHook(id, 'register')
    return st
  }

  async installFromZip(buffer: Buffer): Promise<ThemePackRuntime> {
    const tmp = join(this.deps.dataRoot, '.theme-upload-tmp')
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    ensureDir(tmp)
    const files = unzipSync(new Uint8Array(buffer))
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const norm = name.replace(/^[/\\]+/, '').replace(/\\/g, '/')
      if (norm.includes('..')) continue
      const out = join(tmp, ...norm.split('/'))
      ensureDir(dirname(out))
      writeFileSync(out, data)
    }
    const top = readdirSync(tmp)
    let root = tmp
    if (top.length === 1 && statSync(join(tmp, top[0])).isDirectory()) {
      root = join(tmp, top[0])
    }
    try {
      return await this.installFromDirectory(root)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** Install theme ZIP from remote http(s) URL (admin marketplace / trusted sources). */
  async installFromUrl(url: string, sha256?: string): Promise<ThemePackRuntime> {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) throw new Error('仅支持 http(s) 主题包 URL')
    const res = await fetch(u)
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256 && sha256.trim()) {
      const dig = createHash('sha256').update(buf).digest('hex')
      if (dig.toLowerCase() !== sha256.trim().toLowerCase()) {
        throw new Error(`sha256 校验失败（期望 ${sha256.trim()}，实际 ${dig}）`)
      }
    }
    return this.installFromZip(buf)
  }

  async installBundled(identifier: string): Promise<ThemePackRuntime> {
    const src = this.bundledDir(identifier)
    if (!src) throw new Error(`内置/示例主题不存在: ${identifier}`)
    return this.installFromDirectory(src)
  }

  async uninstall(identifier: string): Promise<void> {
    const id = safeId(identifier)
    if (id === DEFAULT_THEME_ID) throw new Error('默认主题不可卸载')
    const st = this.state.installed[id]
    if (!st) throw new Error('主题未安装')
    if (st.builtin) throw new Error('内置主题不可卸载')
    await this.runServerHook(id, 'uninstall')
    delete this.state.installed[id]
    if (this.state.active === id) {
      this.state.active = DEFAULT_THEME_ID
      await this.deps.setActivePackId(DEFAULT_THEME_ID)
      this.syncTemplateEngine(DEFAULT_THEME_ID)
    }
    this.saveState()
    const dir = this.themeDir(id)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
}

export function decodeThemeZipPayload(body: Record<string, unknown>): Buffer {
  const b64 = typeof body.zipBase64 === 'string' ? body.zipBase64 : ''
  if (!b64) throw new Error('请提供 zipBase64')
  const clean = b64.replace(/^data:.*?;base64,/, '')
  return Buffer.from(clean, 'base64')
}
