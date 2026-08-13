import {
  KERNEL_VERSION,
  type LoadedPluginRecord,
  type DependencyResolver as IDependencyResolver,
  satisfies
} from '../../../shared/pluginKernel'

export type DepCheckResult = { ok: true } | { ok: false; errors: string[] }

export class DependencyResolver implements IDependencyResolver {
  checkEnable(id: string, world: LoadedPluginRecord[]): DepCheckResult {
    const target = world.find((p) => p.id === id)
    if (!target) return { ok: false, errors: [`插件不存在: ${id}`] }
    const errors: string[] = []
    const man = target.manifest
    const ker = man.requires?.kernel
    if (ker && !satisfies(KERNEL_VERSION, ker)) {
      errors.push(`需要 kernel ${ker}（当前 ${KERNEL_VERSION}）`)
    }
    for (const [dep, range] of Object.entries(man.requires?.plugins || {})) {
      const peer = world.find((p) => p.id === dep && p.state === 'enabled')
      if (!peer) {
        errors.push(`缺少依赖插件: ${dep} ${range}`)
        continue
      }
      if (!satisfies(peer.manifest.version, range)) {
        errors.push(`依赖 ${dep} 版本不满足 ${range}（当前 ${peer.manifest.version}）`)
      }
    }
    for (const c of man.conflicts || []) {
      const other = world.find((p) => p.id === c && p.state === 'enabled')
      if (other && other.id !== id) {
        errors.push(`与已启用插件冲突: ${c}`)
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true }
  }

  sortForLoad(enabled: LoadedPluginRecord[]): LoadedPluginRecord[] {
    const byId = new Map(enabled.map((p) => [p.id, p]))
    const visiting = new Set<string>()
    const done = new Set<string>()
    const out: LoadedPluginRecord[] = []

    const visit = (id: string) => {
      if (done.has(id)) return
      if (visiting.has(id)) return
      visiting.add(id)
      const p = byId.get(id)
      if (!p) {
        visiting.delete(id)
        return
      }
      for (const dep of Object.keys(p.manifest.requires?.plugins || {})) {
        if (byId.has(dep)) visit(dep)
      }
      visiting.delete(id)
      done.add(id)
      out.push(p)
    }

    for (const p of enabled) visit(p.id)
    return out
  }
}
