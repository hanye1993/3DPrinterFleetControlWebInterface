/** Fine-grained permission codes for server RBAC */

export type UserLevel = 'admin' | 'operator' | 'viewer' | 'restricted'

/** Navigation / feature sections */
export const NAV_PERMS = [
  'nav.devices',
  'nav.filament',
  'nav.monitor',
  'nav.quote',
  'nav.tools',
  'nav.users',
  'nav.printApprove',
  'nav.settings'
] as const

/** Global device lifecycle */
export const DEVICE_GLOBAL_PERMS = [
  'device.view',
  'device.create',
  'device.edit',
  'device.delete',
  'device.discover',
  'device.batch'
] as const

/** Per-device (or global wildcard) control actions */
export const DEVICE_ACTION_PERMS = [
  'pause',
  'resume',
  'cancel',
  'print',
  'print.request',
  'set_temp',
  'set_fan',
  'set_speed',
  'set_flow',
  'set_z_offset',
  'set_chamber_temp',
  'extrude',
  'retract',
  'restart',
  'firmware_restart',
  'home',
  'jog',
  'emergency_stop',
  'filament_load',
  'filament_unload',
  'files.read',
  'files.upload',
  'camera.view',
  'moonraker',
  'gcode'
] as const

export const FILAMENT_PERMS = [
  'filament.view',
  'filament.create',
  'filament.edit',
  'filament.delete',
  'filament.archive',
  'filament.bind',
  'filament.unbind'
] as const

export const PRINT_APPROVE_PERMS = ['print.approve', 'print.reject'] as const

export type NavPerm = (typeof NAV_PERMS)[number]
export type DeviceGlobalPerm = (typeof DEVICE_GLOBAL_PERMS)[number]
export type DeviceActionPerm = (typeof DEVICE_ACTION_PERMS)[number]
export type FilamentPerm = (typeof FILAMENT_PERMS)[number]
export type PrintApprovePerm = (typeof PRINT_APPROVE_PERMS)[number]

export type PermCode =
  | NavPerm
  | DeviceGlobalPerm
  | FilamentPerm
  | PrintApprovePerm
  | `device.action.${DeviceActionPerm}`

/** deviceAcl[deviceId] = list of DeviceActionPerm + 'view' */
export type DeviceAcl = Record<string, string[]>

export type AuthUserPublic = {
  id: string
  username: string
  displayName: string
  level: UserLevel
  /** false = 已封号，无法登录 */
  enabled: boolean
  /** 封号时间（ISO）；解封后清空 */
  bannedAt?: string
  /** 封号原因（可选） */
  banReason?: string
  permissions: string[]
  /**
   * User group ids (Discuz-like usergroups).
   * Group permissions are unioned into effectivePermissions; moduleAccess may gate plugin modules.
   */
  groupIds?: string[]
  deviceAcl: DeviceAcl
  /** Bound enterprise IdP; none = local password only */
  ssoProvider: 'none' | 'wecom' | 'dingtalk' | 'ad'
  /** External userid / sAMAccountName / unionId */
  ssoExternalId: string
  /** Free-form plugin payload (dept, employee no, …) */
  pluginData?: Record<string, unknown>
  /** 须先改密（默认管理员密码等） */
  mustChangePassword?: boolean
  createdAt: string
  updatedAt: string
}

export type AuthUserRecord = AuthUserPublic & {
  passwordHash: string
  passwordSalt: string
}

export function deviceActionPerm(action: DeviceActionPerm): string {
  return `device.action.${action}`
}

export function defaultPermissions(level: UserLevel): string[] {
  switch (level) {
    case 'admin':
      return [
        ...NAV_PERMS,
        ...DEVICE_GLOBAL_PERMS,
        ...DEVICE_ACTION_PERMS.map(deviceActionPerm),
        ...FILAMENT_PERMS,
        ...PRINT_APPROVE_PERMS
      ]
    case 'operator':
      return [
        'nav.devices',
        'nav.filament',
        'nav.monitor',
        'nav.quote',
        'nav.tools',
        'device.view',
        'device.create',
        'device.edit',
        'device.discover',
        'device.batch',
        deviceActionPerm('pause'),
        deviceActionPerm('resume'),
        deviceActionPerm('cancel'),
        deviceActionPerm('print'),
        deviceActionPerm('set_temp'),
        deviceActionPerm('set_fan'),
        deviceActionPerm('set_speed'),
        deviceActionPerm('set_flow'),
        deviceActionPerm('set_z_offset'),
        deviceActionPerm('set_chamber_temp'),
        deviceActionPerm('extrude'),
        deviceActionPerm('retract'),
        deviceActionPerm('home'),
        deviceActionPerm('jog'),
        deviceActionPerm('emergency_stop'),
        deviceActionPerm('restart'),
        deviceActionPerm('firmware_restart'),
        deviceActionPerm('filament_load'),
        deviceActionPerm('filament_unload'),
        deviceActionPerm('files.read'),
        deviceActionPerm('files.upload'),
        deviceActionPerm('camera.view'),
        deviceActionPerm('gcode'),
        deviceActionPerm('moonraker'),
        ...FILAMENT_PERMS,
        ...PRINT_APPROVE_PERMS,
        'nav.printApprove'
      ]
    case 'viewer':
      return [
        'nav.devices',
        'nav.filament',
        'nav.monitor',
        'nav.quote',
        'device.view',
        'filament.view',
        deviceActionPerm('camera.view'),
        deviceActionPerm('files.read')
      ]
    case 'restricted':
      return [
        'nav.devices',
        'nav.filament',
        'nav.monitor',
        'device.view',
        'filament.view',
        deviceActionPerm('print.request'),
        deviceActionPerm('camera.view')
      ]
    default:
      return []
  }
}

export function effectivePermissions(
  user: {
    level: UserLevel
    permissions: string[]
    groupIds?: string[]
  },
  /** Extra permissions from user groups (already resolved by host) */
  groupPermissions?: string[]
): Set<string> {
  if (user.level === 'admin') {
    return new Set(defaultPermissions('admin'))
  }
  // Direct grants + optional group union
  const set = new Set(user.permissions || [])
  if (groupPermissions?.length) {
    for (const p of groupPermissions) set.add(p)
  }
  return set
}

/** Whether group module allow-list permits this plugin module (empty policy = allow). */
export function groupAllowsModule(
  moduleAccess: Array<{ pluginId: string; module: string }> | undefined | null,
  pluginId: string,
  moduleName: string
): boolean {
  if (!moduleAccess || moduleAccess.length === 0) return true
  const pid = String(pluginId || '').toLowerCase()
  const mod = String(moduleName || '')
  return moduleAccess.some(
    (m) => String(m.pluginId || '').toLowerCase() === pid && String(m.module || '') === mod
  )
}

export function hasPerm(perms: Set<string> | string[], code: string): boolean {
  const set = perms instanceof Set ? perms : new Set(perms)
  if (set.has('*') || set.has('admin')) return true
  return set.has(code)
}

/** Can user see / act on a device? */
export function canDeviceAction(
  user: { level: UserLevel; permissions: string[]; deviceAcl?: DeviceAcl },
  deviceId: string,
  action: 'view' | DeviceActionPerm
): boolean {
  const aclMap = user.deviceAcl || {}
  const acl = aclMap[deviceId]
  // Any entry in deviceAcl = restrictive mode: only listed devices are allowed
  const restricted = Object.keys(aclMap).length > 0

  // Admin with no per-device ACL = full access. If ACL is set, respect it.
  if (user.level === 'admin' && !restricted) return true

  const perms = effectivePermissions(user)

  if (action === 'view') {
    if (restricted) {
      if (!acl || acl.length === 0) return false
      return acl.includes('view') || acl.includes('*')
    }
    return hasPerm(perms, 'device.view')
  }

  // Control actions
  if (!restricted) {
    // No per-device ACL: honor global device.action.* (+ device.view)
    if (!hasPerm(perms, 'device.view')) return false
    return hasPerm(perms, deviceActionPerm(action))
  }
  if (!acl || acl.length === 0) return false
  if (!acl.includes('view') && !acl.includes('*')) return false
  return acl.includes(action) || acl.includes('*')
}

/** 能否打开设备控制面板：仅「查看」不可进入，需勾选至少一项操作权限 */
export function canAccessDeviceControl(
  user: {
    level: UserLevel
    permissions: string[]
    deviceAcl?: DeviceAcl
  },
  deviceId: string
): boolean {
  const aclMap = user.deviceAcl || {}
  const restricted = Object.keys(aclMap).length > 0
  if (user.level === 'admin' && !restricted) return true
  if (!canDeviceAction(user, deviceId, 'view')) return false
  return DEVICE_ACTION_PERMS.some((a) => canDeviceAction(user, deviceId, a))
}

export function canDirectPrint(user: {
  level: UserLevel
  permissions: string[]
  deviceAcl?: DeviceAcl
}, deviceId: string): boolean {
  return canDeviceAction(user, deviceId, 'print')
}

export function canRequestPrint(user: {
  level: UserLevel
  permissions: string[]
  deviceAcl?: DeviceAcl
}, deviceId: string): boolean {
  if (canDirectPrint(user, deviceId)) return true
  if (!canDeviceAction(user, deviceId, 'view')) return false
  const perms = effectivePermissions(user)
  const acl = user.deviceAcl?.[deviceId]
  if (acl && acl.length > 0) return acl.includes('print.request')
  return hasPerm(perms, deviceActionPerm('print.request'))
}

export const LEVEL_LABELS: Record<UserLevel, string> = {
  admin: '管理员',
  operator: '操作员',
  viewer: '只读',
  restricted: '低等级（打印需审核）'
}

export const PERM_LABELS: Record<string, string> = {
  'nav.devices': '设备版块',
  'nav.filament': '耗材版块',
  'nav.monitor': '监控版块',
  'nav.quote': '报价',
  'nav.tools': '工具',
  'nav.users': '用户管理',
  'nav.printApprove': '打印审核/队列',
  'nav.settings': '软件设置',
  'device.view': '查看设备',
  'device.create': '增加设备',
  'device.edit': '编辑设备',
  'device.delete': '删除设备',
  'device.discover': '局域网发现',
  'device.batch': '批量操作',
  'device.action.pause': '暂停',
  'device.action.resume': '恢复',
  'device.action.cancel': '取消打印',
  'device.action.print': '直接打印',
  'device.action.print.request': '申请打印',
  'device.action.set_temp': '设置温度',
  'device.action.set_fan': '设置风扇',
  'device.action.set_speed': '设置速度',
  'device.action.set_flow': '设置流量',
  'device.action.set_z_offset': 'Z 偏移',
  'device.action.set_chamber_temp': '仓温设定',
  'device.action.extrude': '挤出',
  'device.action.retract': '回抽',
  'device.action.restart': '重启主机',
  'device.action.firmware_restart': '固件重启',
  'device.action.home': '归零',
  'device.action.jog': '轴点动',
  'device.action.emergency_stop': '急停',
  'device.action.filament_load': '进料',
  'device.action.filament_unload': '退料',
  'device.action.files.read': '查看机内文件',
  'device.action.files.upload': '上传文件',
  'device.action.camera.view': '摄像头',
  'device.action.moonraker': 'Moonraker 透传',
  'device.action.gcode': '任意 G-code',
  'filament.view': '查看耗材',
  'filament.create': '增加耗材',
  'filament.edit': '修改耗材',
  'filament.delete': '删除耗材',
  'filament.archive': '归档耗材',
  'filament.bind': '绑定槽位',
  'filament.unbind': '解绑槽位',
  'print.approve': '通过打印申请',
  'print.reject': '拒绝打印申请'
}
