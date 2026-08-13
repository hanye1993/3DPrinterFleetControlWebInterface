import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { TemplateEngine } from '../../../shared/pluginKernel'

type Registered = { pluginId: string; dir: string }

/**
 * Lightweight Discuz-like template engine for plugin HTML slots.
 * Supports: <!--{extends file}-->, <!--{block name}-->...<!--{/block}-->,
 * <!--{block name replace}-->, <!--{include file}-->, {$var}
 */
export class DefaultTemplateEngine implements TemplateEngine {
  private regs: Registered[] = []
  private fileCache = new Map<string, string>()
  /** Compiled HTML after extends/block/include (before {$var} interpolate) */
  private compileCache = new Map<string, string>()
  private renderCache = new Map<string, { html: string; at: number }>()
  /** Soft cache for identical data payloads (ms). 0 = off for data-keyed cache. */
  renderCacheTtlMs = 2_000

  register(pluginId: string, rootDir: string): void {
    this.unregister(pluginId)
    this.regs.push({ pluginId, dir: rootDir })
    this.clearCaches()
  }

  unregister(pluginId: string): void {
    this.regs = this.regs.filter((r) => r.pluginId !== pluginId)
    this.clearCaches()
  }

  /** Drop all registrations (used by ThemeManager parent-chain rebuild). */
  reset(): void {
    this.regs = []
    this.clearCaches()
  }

  clearCaches(): void {
    this.fileCache.clear()
    this.compileCache.clear()
    this.renderCache.clear()
  }

  /** List template names under templates/ + slots/ (recursive; path uses `/`). */
  listTemplateNames(): string[] {
    const names = new Set<string>()
    const walk = (dir: string, prefix: string) => {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return
      for (const f of readdirSync(dir)) {
        const full = join(dir, f)
        const rel = prefix ? `${prefix}/${f}` : f
        if (statSync(full).isDirectory()) {
          walk(full, rel)
          continue
        }
        if (!/\.(html?|htm)$/i.test(f)) continue
        names.add(rel.replace(/\.(html?|htm)$/i, ''))
      }
    }
    for (const reg of this.regs) {
      walk(join(reg.dir, 'templates'), '')
      walk(join(reg.dir, 'slots'), '')
    }
    return Array.from(names)
  }

  private candidates(name: string): string[] {
    const base = name.replace(/\\/g, '/').replace(/\.htm$/i, '')
    const files: string[] = []
    // later plugins override earlier — search reverse
    for (let i = this.regs.length - 1; i >= 0; i--) {
      const root = this.regs[i].dir
      files.push(join(root, 'templates', `${base}.htm`))
      files.push(join(root, 'templates', `${base}.html`))
      files.push(join(root, 'slots', `${base}.htm`))
      files.push(join(root, 'slots', `${base}.html`))
    }
    return files
  }

  resolveChain(name: string): string[] {
    return this.candidates(name).filter((p) => existsSync(p))
  }

  has(name: string): boolean {
    return this.resolveChain(name).length > 0
  }

  private readFile(path: string): string {
    const hit = this.fileCache.get(path)
    if (hit != null) return hit
    const raw = readFileSync(path, 'utf8')
    this.fileCache.set(path, raw)
    return raw
  }

  private interpolate(html: string, data: Record<string, unknown>): string {
    let out = html
    // <!--{if $var}-->...<!--{else}-->...<!--{/if}-->
    out = out.replace(
      /<!--\{if\s+\$([a-zA-Z0-9_.]+)\}-->([\s\S]*?)(?:<!--\{else\}-->([\s\S]*?))?<!--\{\/if\}-->/gi,
      (_, key: string, yes: string, no: string) => {
        const v = this.lookup(data, key)
        const truthy = Array.isArray(v) ? v.length > 0 : Boolean(v)
        return truthy ? yes : no || ''
      }
    )
    // <!--{loop $arr $k $v}-->...<!--{/loop}--> or <!--{loop $arr $v}-->
    out = out.replace(
      /<!--\{loop\s+\$([a-zA-Z0-9_.]+)\s+\$([a-zA-Z0-9_]+)(?:\s+\$([a-zA-Z0-9_]+))?\}-->([\s\S]*?)<!--\{\/loop\}-->/gi,
      (_, arrKey: string, a: string, b: string, inner: string) => {
        const arr = this.lookup(data, arrKey)
        if (!Array.isArray(arr)) return ''
        const keyName = b ? a : '_index'
        const valName = b || a
        return arr
          .map((item, idx) => {
            const scope = { ...data, [keyName]: b ? Object.keys(item as object)[0] ?? idx : idx, [valName]: item }
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              Object.assign(scope, item as object)
            }
            return this.interpolate(inner, scope)
          })
          .join('')
      }
    )
    return out.replace(/\{\$([a-zA-Z0-9_.]+)\}/g, (_, key: string) => {
      const cur = this.lookup(data, key)
      return cur == null ? '' : String(cur)
    })
  }

  private lookup(data: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.')
    let cur: unknown = data
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[p]
    }
    return cur
  }

  private extractBlocks(src: string): { body: string; blocks: Record<string, { html: string; replace: boolean }> } {
    const blocks: Record<string, { html: string; replace: boolean }> = {}
    let body = src
    const re =
      /<!--\{block\s+([a-zA-Z0-9_.-]+)(\s+replace)?\}-->([\s\S]*?)<!--\{\/block\}-->/gi
    body = body.replace(re, (_, name: string, replaceFlag: string, inner: string) => {
      blocks[name] = { html: inner, replace: !!replaceFlag }
      return `<!--{block:${name}}-->`
    })
    return { body, blocks }
  }

  private applyIncludes(src: string, stack: string[]): string {
    return src.replace(/<!--\{include\s+([a-zA-Z0-9_./-]+)\}-->/gi, (_, file: string) => {
      if (stack.includes(file)) return `<!-- circular include ${file} -->`
      const chain = this.resolveChain(file)
      if (!chain.length) return `<!-- missing include ${file} -->`
      const child = this.readFile(chain[0])
      return this.applyIncludes(child, [...stack, file])
    })
  }

  private compile(name: string): string {
    const hit = this.compileCache.get(name)
    if (hit != null) return hit
    const chain = this.resolveChain(name)
    if (!chain.length) {
      this.compileCache.set(name, '')
      return ''
    }
    // Use topmost override as child; if it extends, merge with parent in chain
    let src = this.readFile(chain[0])
    src = this.applyIncludes(src, [name])
    const ext = src.match(/<!--\{extends\s+([a-zA-Z0-9_./-]+)\}-->/i)
    let out = ''
    if (ext) {
      const parentName = ext[1]
      const parentChain = this.resolveChain(parentName)
      const parentSrc = parentChain.length
        ? this.applyIncludes(this.readFile(parentChain[0]), [parentName])
        : ''
      const child = this.extractBlocks(src.replace(ext[0], ''))
      const parent = this.extractBlocks(parentSrc)
      out = parent.body
      for (const [bn, block] of Object.entries(child.blocks)) {
        const token = `<!--{block:${bn}}-->`
        if (block.replace || !out.includes(token)) {
          if (out.includes(token)) {
            out = out.split(token).join(block.html)
          } else {
            out += block.html
          }
        } else {
          out = out.split(token).join(block.html)
        }
      }
      for (const [bn, block] of Object.entries(parent.blocks)) {
        out = out.split(`<!--{block:${bn}}-->`).join(block.html)
      }
    } else {
      const { body, blocks } = this.extractBlocks(src)
      out = body
      for (const [bn, block] of Object.entries(blocks)) {
        out = out.split(`<!--{block:${bn}}-->`).join(block.html)
      }
    }
    this.compileCache.set(name, out)
    return out
  }

  async render(name: string, data: Record<string, unknown> = {}): Promise<string> {
    const compiled = this.compile(name)
    if (!compiled) return ''
    if (this.renderCacheTtlMs > 0) {
      let dataKey = ''
      try {
        dataKey = JSON.stringify(data)
      } catch {
        dataKey = ''
      }
      const cacheKey = `${name}\0${dataKey}`
      const cached = this.renderCache.get(cacheKey)
      if (cached && Date.now() - cached.at < this.renderCacheTtlMs) {
        return cached.html
      }
      const html = this.interpolate(compiled, data)
      this.renderCache.set(cacheKey, { html, at: Date.now() })
      if (this.renderCache.size > 200) {
        const first = this.renderCache.keys().next().value
        if (first) this.renderCache.delete(first)
      }
      return html
    }
    return this.interpolate(compiled, data)
  }

  /** Render all slot/template files through the engine (extends/if/loop applied). */
  async collectSlotsRendered(data: Record<string, unknown> = {}): Promise<Record<string, string[]>> {
    const slots: Record<string, string[]> = {}
    for (const name of this.listTemplateNames()) {
      try {
        const html = await this.render(name, data)
        if (!html) continue
        if (!slots[name]) slots[name] = []
        slots[name].push(html)
        // Discuz-style path `common/header` also expose as `common.header` for SPA slots
        if (name.includes('/')) {
          const dotted = name.replace(/\//g, '.')
          if (!slots[dotted]) slots[dotted] = []
          slots[dotted].push(html)
        }
      } catch {
        /* skip */
      }
    }
    return slots
  }

  collectSlots(): Record<string, string[]> {
    // sync fallback — prefer collectSlotsRendered at host
    const slots: Record<string, string[]> = {}
    for (const name of this.listTemplateNames()) {
      try {
        const chain = this.resolveChain(name)
        if (!chain.length) continue
        const html = this.readFile(chain[0])
        if (!slots[name]) slots[name] = []
        slots[name].push(html)
        if (name.includes('/')) {
          const dotted = name.replace(/\//g, '.')
          if (!slots[dotted]) slots[dotted] = []
          slots[dotted].push(html)
        }
      } catch {
        /* skip */
      }
    }
    return slots
  }
}
