/**
 * User groups (Discuz-like usergroups): named permission sets + plugin module allow-list.
 * Replaces permission-pack templates as the primary RBAC grouping model.
 * Legacy permission-packs.json is migrated on first load.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type ModuleRef = {
  pluginId: string
  module: string
}

export type UserGroup = {
  id: string
  name: string
  description?: string
  /** Permission codes granted to members (unioned into effective permissions) */
  permissions: string[]
  /**
   * Allow-list of plugin modules (page/admin/api).
   * Empty = no extra module gate from this group.
   * If the user has any non-empty moduleAccess across groups, page/admin modules
   * must appear in the union allow-list (admins bypass).
   */
  moduleAccess: ModuleRef[]
}

/** @deprecated alias — packs are now groups without moduleAccess */
export type PermissionPack = {
  id: string
  name: string
  description?: string
  permissions: string[]
}

type Store = { groups: UserGroup[] }

const DEFAULT_GROUPS: UserGroup[] = [
  {
    id: 'operator',
    name: '操作员',
    description: '设备监控与常用控制',
    permissions: [
      'nav.devices',
      'nav.filament',
      'nav.monitor',
      'nav.tools',
      'nav.quote',
      'device.view',
      'device.create',
      'device.edit',
      'device.discover',
      'device.batch',
      'device.action.pause',
      'device.action.resume',
      'device.action.cancel',
      'device.action.print',
      'device.action.camera.view',
      'filament.view'
    ],
    moduleAccess: []
  },
  {
    id: 'warehouse',
    name: '仓管',
    description: '耗材与报价工具',
    permissions: [
      'nav.devices',
      'nav.filament',
      'nav.tools',
      'nav.quote',
      'device.view',
      'filament.view',
      'filament.create',
      'filament.edit',
      'filament.bind',
      'filament.unbind'
    ],
    moduleAccess: []
  },
  {
    id: 'readonly',
    name: '只读',
    description: '仅查看设备与监控',
    permissions: [
      'nav.devices',
      'nav.monitor',
      'nav.filament',
      'device.view',
      'filament.view',
      'device.action.camera.view'
    ],
    moduleAccess: []
  }
]

function normalizeId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
}

function normalizeModuleAccess(raw: unknown): ModuleRef[] {
  if (!Array.isArray(raw)) return []
  const out: ModuleRef[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const pluginId = String(o.pluginId || o.identifier || '')
      .trim()
      .toLowerCase()
    const module = String(o.module || o.moduleName || o.name || '').trim()
    if (!pluginId || !module) continue
    const key = `${pluginId}:${module}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ pluginId, module })
  }
  return out
}

function normalizeGroup(raw: unknown): UserGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = normalizeId(String(o.id || ''))
  if (!id) return null
  return {
    id,
    name: String(o.name || id),
    description: o.description ? String(o.description) : undefined,
    permissions: Array.isArray(o.permissions)
      ? Array.from(new Set(o.permissions.map(String)))
      : [],
    moduleAccess: normalizeModuleAccess(o.moduleAccess ?? o.modules)
  }
}

export class UserGroupStore {
  private path: string
  private legacyPackPath: string
  private data: Store = { groups: DEFAULT_GROUPS.map((g) => ({ ...g, permissions: [...g.permissions] })) }

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'user-groups.json')
    this.legacyPackPath = join(dataRoot, 'permission-packs.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { groups?: unknown[] }
        const list = Array.isArray(raw.groups)
          ? raw.groups.map(normalizeGroup).filter((g): g is UserGroup => !!g)
          : []
        if (list.length) {
          this.data = { groups: list }
          return
        }
      }
      // Migrate legacy permission-packs.json
      if (existsSync(this.legacyPackPath)) {
        const raw = JSON.parse(readFileSync(this.legacyPackPath, 'utf8')) as { packs?: unknown[] }
        const list = Array.isArray(raw.packs)
          ? raw.packs.map(normalizeGroup).filter((g): g is UserGroup => !!g)
          : []
        if (list.length) {
          this.data = { groups: list }
          this.save()
          return
        }
      }
      this.save()
    } catch {
      this.data = {
        groups: DEFAULT_GROUPS.map((g) => ({
          ...g,
          permissions: [...g.permissions],
          moduleAccess: []
        }))
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8')
  }

  list(): UserGroup[] {
    return this.data.groups.map((g) => ({
      ...g,
      permissions: [...g.permissions],
      moduleAccess: g.moduleAccess.map((m) => ({ ...m }))
    }))
  }

  get(id: string): UserGroup | null {
    const hit = this.data.groups.find((g) => g.id === id)
    return hit
      ? {
          ...hit,
          permissions: [...hit.permissions],
          moduleAccess: hit.moduleAccess.map((m) => ({ ...m }))
        }
      : null
  }

  saveAll(groups: UserGroup[]): UserGroup[] {
    this.data.groups = groups
      .map((g) => normalizeGroup(g))
      .filter((g): g is UserGroup => !!g)
    this.save()
    return this.list()
  }

  /** Permissions union for the given group ids */
  permissionsFor(groupIds: string[] | undefined | null): string[] {
    if (!groupIds?.length) return []
    const set = new Set<string>()
    for (const id of groupIds) {
      const g = this.data.groups.find((x) => x.id === id)
      if (!g) continue
      for (const p of g.permissions) set.add(p)
    }
    return Array.from(set)
  }

  /** Module allow-list union. Empty array means “no group module policy”. */
  moduleAccessFor(groupIds: string[] | undefined | null): ModuleRef[] {
    if (!groupIds?.length) return []
    const out: ModuleRef[] = []
    const seen = new Set<string>()
    let anyPolicy = false
    for (const id of groupIds) {
      const g = this.data.groups.find((x) => x.id === id)
      if (!g || !g.moduleAccess.length) continue
      anyPolicy = true
      for (const m of g.moduleAccess) {
        const key = `${m.pluginId}:${m.module}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...m })
      }
    }
    return anyPolicy ? out : []
  }

  /** Legacy pack list shape for SoftSettings / old clients */
  listAsPacks(): PermissionPack[] {
    return this.list().map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      permissions: g.permissions
    }))
  }
}

/** @deprecated use UserGroupStore */
export class PermissionPackStore extends UserGroupStore {
  listPacks(): PermissionPack[] {
    return this.listAsPacks()
  }

  saveAllPacks(packs: PermissionPack[]): PermissionPack[] {
    return this.saveAll(
      packs.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        permissions: p.permissions,
        moduleAccess: []
      }))
    ).map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      permissions: g.permissions
    }))
  }
}
