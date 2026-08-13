import {
  LEGACY_HOOK_TO_V2,
  resolveHookName,
  type FilterHookFn,
  type HookBus,
  type PluginManifestV2
} from '../../../shared/pluginKernel'

/** v1 hook: (api, value, ctx) => next */
export type LegacyHookFn = (
  api: unknown,
  value: unknown,
  ctx?: unknown
) => unknown | Promise<unknown>

/**
 * Register v1 exported hooks onto HookBus under formal (+ short) names.
 * `register` is NOT registered as a filter — caller should invoke it once at load.
 */
export function registerLegacyHooks(
  bus: HookBus,
  pluginId: string,
  hooks: Record<string, LegacyHookFn>,
  getApi: () => unknown,
  priority = 100
): void {
  for (const [shortName, fn] of Object.entries(hooks)) {
    if (shortName === 'register' || shortName === 'activate' || shortName === 'deactivate') continue
    if (typeof fn !== 'function') continue
    const formal = LEGACY_HOOK_TO_V2[shortName] || shortName
    const wrapper: FilterHookFn = async (value, rt) => {
      const api = getApi()
      const next = await fn(api, value, rt.hostCtx)
      return next === undefined ? value : next
    }
    bus.on(formal, wrapper, { priority, pluginId })
    if (formal !== shortName) {
      bus.on(shortName, wrapper, { priority, pluginId })
    }
  }
}

/** Map a host-facing hook name to the names that should be applied (deduped). */
export function hookApplyNames(name: string): string[] {
  const formal = resolveHookName(name)
  if (formal === name) return [name]
  return [formal, name]
}

export function isV2Module(mod: unknown): mod is {
  activate: (ctx: unknown) => unknown
  deactivate?: (ctx: unknown) => unknown
} {
  return !!(mod && typeof mod === 'object' && typeof (mod as { activate?: unknown }).activate === 'function')
}

export function detectApiVersion(manifest: PluginManifestV2, mod: unknown): '1' | '2' {
  if (manifest.apiVersion === '2') return '2'
  if (isV2Module(mod)) return '2'
  return '1'
}
