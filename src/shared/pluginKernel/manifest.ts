import type { PluginManifest } from '../plugin'
import { parsePluginJson } from '../plugin'
import {
  type PluginApiVersion,
  type PluginManifestV2,
  parseCapabilities
} from './types'

export function parsePluginJsonV2Fields(raw: unknown): Pick<
  PluginManifestV2,
  'apiVersion' | 'requires' | 'conflicts' | 'capabilities' | 'templates' | 'dbSchemaVersion'
> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const apiVersion: PluginApiVersion = o.apiVersion === '2' || o.apiVersion === 2 ? '2' : '1'
  const req = o.requires && typeof o.requires === 'object' ? (o.requires as Record<string, unknown>) : {}
  const pluginsReq =
    req.plugins && typeof req.plugins === 'object'
      ? Object.fromEntries(
          Object.entries(req.plugins as Record<string, unknown>).map(([k, v]) => [k, String(v)])
        )
      : undefined
  const templates =
    o.templates && typeof o.templates === 'object'
      ? {
          overrides: Array.isArray((o.templates as { overrides?: unknown }).overrides)
            ? ((o.templates as { overrides: unknown[] }).overrides.map(String) as string[])
            : undefined,
          provides: Array.isArray((o.templates as { provides?: unknown }).provides)
            ? ((o.templates as { provides: unknown[] }).provides.map(String) as string[])
            : undefined
        }
      : undefined
  const dbSchemaVersion =
    typeof o.dbSchemaVersion === 'number' && Number.isFinite(o.dbSchemaVersion)
      ? Math.max(0, Math.floor(o.dbSchemaVersion))
      : undefined
  return {
    apiVersion,
    requires: {
      kernel: req.kernel != null ? String(req.kernel) : undefined,
      plugins: pluginsReq
    },
    conflicts: Array.isArray(o.conflicts) ? o.conflicts.map(String) : [],
    capabilities: parseCapabilities(o.capabilities, apiVersion),
    templates,
    dbSchemaVersion
  }
}

/** Build PluginManifestV2 from disk JSON + legacy PluginManifest. */
export function toManifestV2(raw: unknown, fallbackId?: string): PluginManifestV2 {
  const legacy: PluginManifest = parsePluginJson(raw, fallbackId)
  const v2 = parsePluginJsonV2Fields(raw)
  return {
    identifier: legacy.identifier,
    name: legacy.name,
    version: legacy.version,
    apiVersion: v2.apiVersion,
    description: legacy.description,
    copyright: legacy.copyright,
    available: legacy.availableDefault,
    requires: v2.requires,
    conflicts: v2.conflicts,
    capabilities: v2.capabilities,
    hooks: legacy.hooks,
    templates: v2.templates,
    mainFile: legacy.mainFile,
    clientJs: legacy.clientJs,
    publicClientJs: legacy.publicClientJs,
    themeCss: legacy.themeCss,
    modules: legacy.modules,
    vars: legacy.vars,
    installFile: legacy.installFile,
    uninstallFile: legacy.uninstallFile,
    upgradeFile: legacy.upgradeFile,
    dbSchemaVersion: v2.dbSchemaVersion
  }
}
