import type { IncomingMessage, ServerResponse } from 'http'
import {
  canDeviceAction,
  canDirectPrint,
  canRequestPrint,
  defaultPermissions,
  DEVICE_ACTION_PERMS,
  DEVICE_GLOBAL_PERMS,
  effectivePermissions,
  FILAMENT_PERMS,
  hasPerm,
  LEVEL_LABELS,
  NAV_PERMS,
  PERM_LABELS,
  PRINT_APPROVE_PERMS,
  type AuthUserPublic,
  type AuthUserRecord,
  type UserLevel
} from '../../shared/permissions'
import { signJwt, type JwtPayload } from './jwt'
import type { UserStore } from './users'
import type { PrintRequestStore, PrintRequestStatus } from './printRequests'
import type { PresenceStore } from './presence'
import {
  listEnabledSsoProviders,
  userHasSsoBinding,
  type SsoProviderId,
  type SsoSettingsBundle
} from '../../shared/sso'
import { authenticateAd } from './ssoProviders'
import {
  buildDingtalkAuthorizeUrl,
  buildWecomAuthorizeUrl,
  resolveApiPublicBase,
  resolveSsoRedirect
} from './ssoProviders'
import {
  createSsoQrSession,
  getSsoQrSession,
  publicQrSession
} from './ssoSessions'

export type AuthContext =
  | { kind: 'apiKey' }
  | { kind: 'local' }
  | { kind: 'user'; user: AuthUserRecord; payload: JwtPayload }

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export type AuthApiDeps = {
  users: UserStore
  printRequests: PrintRequestStore
  presence?: PresenceStore
  getDevices: () => Array<{ id: string; name: string }>
  /** Dispatch a queued job to the printer (upload + print_file) */
  onStartPrintJob?: (req: {
    deviceId: string
    filename: string
    contentBase64?: string
  }) => Promise<{ ok: boolean; message?: string }>
  /** @deprecated alias of onStartPrintJob */
  onApprovedPrint?: (req: {
    deviceId: string
    filename: string
    contentBase64?: string
  }) => Promise<{ ok: boolean; message?: string }>
  getSso?: () => SsoSettingsBundle
  getApiBaseSettings?: () => { publicIp?: string; publicIpv6?: string; domain?: string; apiPort?: number }
  getPluginManager?: () => import('../plugin/manager').PluginManager | null
}

function canManagePrintQueue(
  auth: AuthContext,
  groupPermissions?: string[]
): boolean {
  if (auth.kind === 'local' || auth.kind === 'apiKey') return true
  if (auth.kind !== 'user') return false
  const perms = effectivePermissions(auth.user, groupPermissions)
  return (
    auth.user.level === 'admin' ||
    hasPerm(perms, 'print.approve') ||
    hasPerm(perms, 'nav.printApprove')
  )
}

async function parseJson(
  req: IncomingMessage,
  readBody: ReadBody
): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('Invalid JSON')
  }
}

function pickUserExtras(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (
    source.pluginData != null &&
    typeof source.pluginData === 'object' &&
    !Array.isArray(source.pluginData)
  ) {
    out.pluginData = source.pluginData
  }
  for (const [k, v] of Object.entries(source)) {
    if (!(k.startsWith('x_') || k.startsWith('plugin_'))) continue
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

function pickPrintExtras(source: Record<string, unknown>): Record<string, unknown> {
  return pickUserExtras(source)
}

function requireUser(auth: AuthContext, res: ServerResponse, sendJson: SendJson): AuthUserRecord | null {
  if (auth.kind === 'user') return auth.user
  if (auth.kind === 'apiKey' || auth.kind === 'local') {
    // machine / local admin: treat as full admin for mutating user APIs only when local
    return null
  }
  sendJson(res, 401, { ok: false, message: '需要用户登录' })
  return null
}

function requireAdminish(
  auth: AuthContext,
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (auth.kind === 'local' || auth.kind === 'apiKey') return true
  if (auth.kind === 'user' && (auth.user.level === 'admin' || hasPerm(effectivePermissions(auth.user), 'nav.users'))) {
    return true
  }
  sendJson(res, 403, { ok: false, message: '需要用户管理权限' })
  return false
}

export function mePayload(
  user: AuthUserPublic | AuthUserRecord,
  groupPermissions?: string[]
): {
  ok: true
  user: AuthUserPublic
  permissions: string[]
  deviceAcl: Record<string, string[]>
} {
  const { passwordHash: _h, passwordSalt: _s, ...pub } = user as AuthUserRecord
  const publicUser = ('passwordHash' in user
    ? pub
    : user) as AuthUserPublic
  return {
    ok: true,
    user: publicUser,
    permissions: Array.from(effectivePermissions(publicUser, groupPermissions)),
    deviceAcl: publicUser.deviceAcl || {}
  }
}

export async function mePayloadWithPlugins(
  user: AuthUserPublic | AuthUserRecord,
  getPluginManager?: () => import('../plugin/manager').PluginManager | null
): Promise<{
  ok: true
  user: AuthUserPublic
  permissions: string[]
  deviceAcl: Record<string, string[]>
  [key: string]: unknown
}> {
  const pm = getPluginManager?.()
  const asPub = (
    'passwordHash' in (user as AuthUserRecord)
      ? mePayload(user).user
      : (user as AuthUserPublic)
  ) as AuthUserPublic
  const groupPerms = pm?.groupPermissionsFor(asPub.groupIds) || []
  const base = mePayload(user, groupPerms)
  if (!pm) return base
  try {
    const permissions = await pm.applyPermissionsHook(base.permissions, base.user)
    let payload: {
      ok: true
      user: AuthUserPublic
      permissions: string[]
      deviceAcl: Record<string, string[]>
      [key: string]: unknown
    } = { ...base, permissions }
    payload = await pm.runHook('auth_me', payload, {
      method: 'GET',
      path: '/api/v1/me',
      url: new URL('http://local/api/v1/me'),
      query: {},
      headers: {},
      auth: { kind: 'user', user: base.user }
    })
    return payload
  } catch {
    return base
  }
}

export async function handleAuthApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  auth: AuthContext
  deps: AuthApiDeps
  sendJson: SendJson
  readBody: ReadBody
}): Promise<boolean> {
  const { method, path, req, res, auth, deps, sendJson, readBody } = opts

  if (method === 'GET' && path === '/api/v1/auth/meta') {
    const sso = deps.getSso?.()
    const pm = deps.getPluginManager?.()
    let pluginPerms: Array<{ code: string; label: string; plugin?: string; description?: string }> =
      []
    try {
      if (pm) pluginPerms = await pm.collectPermissionsCatalog()
    } catch {
      pluginPerms = []
    }
    const permLabels: Record<string, string> = { ...PERM_LABELS }
    for (const p of pluginPerms) {
      if (p.code && p.label) permLabels[p.code] = p.label
    }
    sendJson(res, 200, {
      ok: true,
      levels: LEVEL_LABELS,
      permLabels,
      pluginPerms,
      navPerms: NAV_PERMS,
      deviceGlobalPerms: DEVICE_GLOBAL_PERMS,
      deviceActionPerms: DEVICE_ACTION_PERMS,
      filamentPerms: FILAMENT_PERMS,
      printApprovePerms: PRINT_APPROVE_PERMS,
      defaultPermissions: {
        admin: defaultPermissions('admin'),
        operator: defaultPermissions('operator'),
        viewer: defaultPermissions('viewer'),
        restricted: defaultPermissions('restricted')
      },
      ssoProviders: sso ? listEnabledSsoProviders(sso) : [],
      ssoAllowDevConfirm: Boolean(sso?.allowDevConfirm),
      ssoRequireBinding: Boolean(sso?.requireBinding),
      ssoRequireSsoLogin: Boolean(sso?.requireSsoLogin),
      ssoFeatureAvailable: Boolean(
        sso && (sso.wecom.enabled || sso.dingtalk.enabled || sso.ad.enabled)
      )
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/plugin-login/exchange') {
    try {
      const body = await parseJson(req, readBody)
      let grantToken = String(body.grantToken || body.token || '').trim()
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'login_grant_exchange',
          { proceed: true, grantToken, raw: body },
          { method, path, auth: { kind: 'apiKey' } }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          grantToken?: string
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.grantToken) grantToken = String(before.grantToken)
      }
      if (!grantToken) {
        sendJson(res, 400, { ok: false, message: '缺少 grantToken' })
        return true
      }
      if (!pm) {
        sendJson(res, 503, { ok: false, message: '插件系统未启动' })
        return true
      }
      const grant = pm.consumeLoginGrant(grantToken)
      if (!grant) {
        sendJson(res, 401, { ok: false, message: '登录授权不存在或已过期' })
        return true
      }
      const user = deps.users.getById(grant.userId)
      if (!user) {
        sendJson(res, 404, { ok: false, message: '授权用户不存在' })
        return true
      }
      if (!user.enabled) {
        sendJson(res, 403, {
          ok: false,
          message: user.banReason
            ? `账号已被封禁：${user.banReason}`
            : '账号已被封禁，请联系管理员解封'
        })
        return true
      }
      const sso = deps.getSso?.()
      const requireBinding = Boolean(sso?.requireBinding)
      const token = signJwt(
        { sub: user.id, username: user.username, level: user.level },
        deps.users.getJwtSecret()
      )
      deps.presence?.touch(user)
      void pm.emitDomainEvent('action:auth.session.created', {
        userId: user.id,
        via: 'plugin-grant',
        pluginId: grant.pluginId
      })
      const me = await mePayloadWithPlugins(user, deps.getPluginManager)
      sendJson(res, 200, {
        ...me,
        token,
        requireBinding,
        needsSsoBind: requireBinding && !userHasSsoBinding(user),
        loginByPlugin: grant.pluginId
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '插件登录失败' })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/login') {
    try {
      const body = await parseJson(req, readBody)
      let username = String(body.username || '').trim()
      let password = String(body.password || '')
      const pmLogin = deps.getPluginManager?.()
      if (pmLogin) {
        const before = (await pmLogin.runHook(
          'login_before',
          { proceed: true, username, password, raw: body },
          {
            method,
            path,
            url: new URL('http://local' + path),
            query: {},
            headers: {},
            auth: { kind: 'apiKey' }
          }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          username?: string
          password?: string
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (typeof before?.username === 'string') username = before.username.trim()
        if (typeof before?.password === 'string') password = before.password
      }
      if (!username) {
        sendJson(res, 400, { ok: false, message: '请输入账号' })
        return true
      }
      if (!password) {
        sendJson(res, 400, { ok: false, message: '请输入密码' })
        return true
      }
      const sso = deps.getSso?.()
      const requireSsoLogin = Boolean(sso?.requireSsoLogin)
      const requireBinding = Boolean(sso?.requireBinding)

      let user = null as ReturnType<typeof deps.users.authenticate>

      if (requireSsoLogin) {
        // 强制对接登录：禁止本地密码，仅允许 AD 域校验（若已启用 AD）
        if (sso?.ad.enabled) {
          const ad = await authenticateAd(sso.ad, username, password)
          if (ad.ok && ad.externalId) {
            user = deps.users.getBySso('ad', ad.externalId) || null
          } else if (!ad.ok) {
            sendJson(res, 401, {
              ok: false,
              message: ad.message || 'AD 账号或密码错误'
            })
            return true
          }
        }
        if (!user) {
          sendJson(res, 401, {
            ok: false,
            message: sso?.ad.enabled
              ? '已开启强制对接登录，请使用 AD 域账号或企微/钉钉扫码'
              : '已开启强制对接登录，请使用企微/钉钉扫码登录'
          })
          return true
        }
      } else {
        user = deps.users.authenticate(username, password)
        if (!user && sso?.ad.enabled) {
          const ad = await authenticateAd(sso.ad, username, password)
          if (ad.ok && ad.externalId) {
            user = deps.users.getBySso('ad', ad.externalId) || null
          }
        }
        if (!user) {
          const candidate = deps.users.findLoginCandidate(username)
          if (!candidate) {
            sendJson(res, 401, { ok: false, message: '账号不存在' })
            return true
          }
          if (!candidate.enabled) {
            sendJson(res, 403, {
              ok: false,
              message: candidate.banReason
                ? `账号已被封禁：${candidate.banReason}`
                : '账号已被封禁，请联系管理员解封'
            })
            return true
          }
          sendJson(res, 401, { ok: false, message: '密码错误' })
          return true
        }
      }

      if (!user) {
        sendJson(res, 401, { ok: false, message: '账号或密码错误' })
        return true
      }
      if (!user.enabled) {
        sendJson(res, 403, {
          ok: false,
          message: user.banReason
            ? `账号已被封禁：${user.banReason}`
            : '账号已被封禁，请联系管理员解封'
        })
        return true
      }
      // 强制绑定：允许先登录，由客户端弹出绑定页后再进主界面（此处不拦截）
      const token = signJwt(
        { sub: user.id, username: user.username, level: user.level },
        deps.users.getJwtSecret()
      )
      deps.presence?.touch(user)
      // 仍使用默认密码时强制改密
      if (password === 'admin123') {
        try {
          deps.users.update(user.id, { mustChangePassword: true } as never)
          user = deps.users.getById(user.id) || user
        } catch {
          user.mustChangePassword = true
        }
      }
      let me = await mePayloadWithPlugins(user, deps.getPluginManager)
      if (pmLogin) {
        me = await pmLogin.runHook('login_after', { ...me, token }, {
          method,
          path,
          url: new URL('http://local' + path),
          query: {},
          headers: {},
          auth: { kind: 'user', user }
        })
        void pmLogin.emitDomainEvent('action:auth.session.created', {
          userId: user.id,
          via: 'password'
        })
      }
      sendJson(res, 200, {
        ...me,
        token: (me as { token?: string }).token || token,
        requireBinding: requireBinding,
        needsSsoBind: requireBinding && !userHasSsoBinding(user)
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '登录失败' })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/change-password') {
    if (auth.kind !== 'user') {
      sendJson(res, 401, { ok: false, message: '未登录' })
      return true
    }
    try {
      const body = await parseJson(req, readBody)
      const currentPassword = String(body.currentPassword || body.oldPassword || '')
      const newPassword = String(body.newPassword || body.password || '')
      if (!currentPassword || !newPassword) {
        sendJson(res, 400, { ok: false, message: '请填写当前密码与新密码' })
        return true
      }
      if (newPassword.length < 6) {
        sendJson(res, 400, { ok: false, message: '新密码至少 6 位' })
        return true
      }
      if (newPassword === 'admin123') {
        sendJson(res, 400, { ok: false, message: '请勿使用默认密码 admin123' })
        return true
      }
      const okUser = deps.users.authenticate(auth.user.username, currentPassword)
      if (!okUser || okUser.id !== auth.user.id) {
        sendJson(res, 401, { ok: false, message: '当前密码不正确' })
        return true
      }
      const updated = deps.users.update(auth.user.id, { password: newPassword, mustChangePassword: false })
      const me = await mePayloadWithPlugins(updated, deps.getPluginManager)
      sendJson(res, 200, { ...me, ok: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '改密失败' })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/logout') {
    const pmOut = deps.getPluginManager?.()
    if (auth.kind === 'user') {
      deps.presence?.markOffline(auth.user.id)
      if (pmOut) {
        void pmOut.runHook('logout', { userId: auth.user.id }, { method, path, auth })
        void pmOut.emitDomainEvent('action:auth.session.revoked', {
          userId: auth.user.id,
          via: 'logout'
        })
      }
    }
    sendJson(res, 200, { ok: true })
    return true
  }

  if (method === 'GET' && path === '/api/v1/me') {
    if (auth.kind === 'user') {
      deps.presence?.touch(auth.user)
      const sso = deps.getSso?.()
      const me = await mePayloadWithPlugins(auth.user, deps.getPluginManager)
      sendJson(res, 200, {
        ...me,
        requireBinding: Boolean(sso?.requireBinding),
        requireSsoLogin: Boolean(sso?.requireSsoLogin),
        needsSsoBind: Boolean(sso?.requireBinding) && !userHasSsoBinding(auth.user)
      })
      return true
    }
    if (auth.kind === 'local' || auth.kind === 'apiKey') {
      sendJson(res, 200, {
        ok: true,
        user: {
          id: 'local-admin',
          username: 'local',
          displayName: '本机管理',
          level: 'admin',
          enabled: true,
          permissions: defaultPermissions('admin'),
          deviceAcl: {},
          ssoProvider: 'none',
          ssoExternalId: '',
          createdAt: '',
          updatedAt: ''
        },
        permissions: defaultPermissions('admin'),
        deviceAcl: {},
        authKind: auth.kind,
        needsSsoBind: false
      })
      return true
    }
    sendJson(res, 401, { ok: false, message: '未登录' })
    return true
  }

  if (method === 'POST' && path === '/api/v1/me/sso-bind') {
    if (auth.kind !== 'user') {
      sendJson(res, 401, { ok: false, message: '需要用户登录' })
      return true
    }
    try {
      const body = await parseJson(req, readBody)
      const provider = body.provider
      if (provider !== 'wecom' && provider !== 'dingtalk' && provider !== 'ad') {
        sendJson(res, 400, { ok: false, message: 'provider 须为 wecom / dingtalk / ad' })
        return true
      }
      const sso = deps.getSso?.()
      if (!sso) {
        sendJson(res, 501, { ok: false, message: '对接未配置' })
        return true
      }
      const enabled =
        (provider === 'wecom' && sso.wecom.enabled) ||
        (provider === 'dingtalk' && sso.dingtalk.enabled) ||
        (provider === 'ad' && sso.ad.enabled)
      if (!enabled) {
        sendJson(res, 400, { ok: false, message: '该对接未启用' })
        return true
      }

      let externalId = typeof body.externalId === 'string' ? body.externalId.trim() : ''

      // AD：可用域密码现场校验并取账号
      if (provider === 'ad' && body.password) {
        const ad = await authenticateAd(sso.ad, String(body.username || externalId || ''), String(body.password))
        if (!ad.ok || !ad.externalId) {
          sendJson(res, 401, { ok: false, message: ad.message || 'AD 校验失败' })
          return true
        }
        externalId = ad.externalId
      }

      if (!externalId) {
        sendJson(res, 400, { ok: false, message: '请填写对接账号 / 外部 ID' })
        return true
      }

      const clash = deps.users.getBySso(provider, externalId)
      if (clash && clash.id !== auth.user.id) {
        sendJson(res, 400, { ok: false, message: '该对接账号已被其他用户绑定' })
        return true
      }

      const user = deps.users.update(auth.user.id, {
        ssoProvider: provider,
        ssoExternalId: externalId
      })
      sendJson(res, 200, {
        ...mePayload(user),
        needsSsoBind: false,
        message: '绑定成功'
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '绑定失败' })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/me/sso-bind/qr/start') {
    if (auth.kind !== 'user') {
      sendJson(res, 401, { ok: false, message: '需要用户登录' })
      return true
    }
    try {
      const body = await parseJson(req, readBody)
      const provider = body.provider === 'dingtalk' ? 'dingtalk' : body.provider === 'wecom' ? 'wecom' : null
      if (!provider) {
        sendJson(res, 400, { ok: false, message: 'provider 须为 wecom 或 dingtalk' })
        return true
      }
      const sso = deps.getSso?.()
      if (!sso) {
        sendJson(res, 501, { ok: false, message: '对接未配置' })
        return true
      }
      const opt = listEnabledSsoProviders(sso).find((p) => p.id === provider)
      if (!opt?.enabled) {
        sendJson(res, 400, { ok: false, message: `${provider} 未启用` })
        return true
      }
      if (!opt.configured && !sso.allowDevConfirm) {
        sendJson(res, 400, { ok: false, message: `${provider} 未配置完成` })
        return true
      }
      const apiBase = resolveApiPublicBase(deps.getApiBaseSettings?.() || {})
      const redirectUri = resolveSsoRedirect(provider, sso, apiBase)
      const draft = createSsoQrSession({
        provider,
        authorizeUrl: '',
        mode: 'bind',
        userId: auth.user.id
      })
      draft.authorizeUrl =
        provider === 'wecom'
          ? buildWecomAuthorizeUrl({ cfg: sso.wecom, redirectUri, state: draft.id })
          : buildDingtalkAuthorizeUrl({ cfg: sso.dingtalk, redirectUri, state: draft.id })
      if (!opt.configured && sso.allowDevConfirm) {
        draft.authorizeUrl = `${apiBase}/api/v1/auth/sso/qr/${draft.id}/dev-hint`
      }
      sendJson(res, 200, { ok: true, session: publicQrSession(draft) })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '创建绑定扫码失败' })
    }
    return true
  }

  const bindQrStatus = path.match(/^\/api\/v1\/me\/sso-bind\/qr\/([^/]+)\/status$/)
  if (method === 'GET' && bindQrStatus) {
    if (auth.kind !== 'user') {
      sendJson(res, 401, { ok: false, message: '需要用户登录' })
      return true
    }
    const id = decodeURIComponent(bindQrStatus[1])
    const session = getSsoQrSession(id)
    if (!session || session.mode !== 'bind' || session.userId !== auth.user.id) {
      sendJson(res, 404, { ok: false, message: '绑定会话无效' })
      return true
    }
    const pub = publicQrSession(session)
    if (session.status === 'ok') {
      const user = deps.users.getById(auth.user.id)
      if (user) {
        sendJson(res, 200, {
          ...mePayload(user),
          session: pub,
          needsSsoBind: false
        })
        return true
      }
    }
    sendJson(res, 200, { ok: true, session: pub })
    return true
  }

  if (method === 'GET' && path === '/api/v1/users') {
    if (!requireAdminish(auth, res, sendJson)) return true
    let users = deps.users.list().map((u) => {
      const online = Boolean(deps.presence?.isOnline(u.id))
      const p = deps.presence?.get(u.id)
      return {
        ...u,
        online,
        lastSeenAt: p?.lastSeenAt,
        connectedAt: p?.connectedAt
      }
    })
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        users = await pm.runHook('users_list', users, {
          method,
          path,
          url: new URL('http://local' + path),
          query: {},
          headers: {},
          auth
        })
      }
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true, users })
    return true
  }

  if (method === 'POST' && path === '/api/v1/users') {
    if (!requireAdminish(auth, res, sendJson)) return true
    try {
      let body = await parseJson(req, readBody)
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'user_create',
            { proceed: true, body },
            {
              method,
              path,
              url: new URL('http://local' + path),
              query: {},
              headers: {},
              auth
            }
          )) as {
            proceed?: boolean
            status?: number
            body?: Record<string, unknown>
            message?: string
          }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, {
              ok: false,
              message: before.message || 'blocked'
            })
            return true
          }
          if (before?.body && typeof before.body === 'object') body = before.body
        }
      } catch {
        /* ignore */
      }
      const level = (body.level as UserLevel) || 'viewer'
      const extras = pickUserExtras(body)
      const user = deps.users.create({
        username: String(body.username || ''),
        password: String(body.password || ''),
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
        level,
        permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : undefined,
        groupIds: Array.isArray(body.groupIds) ? (body.groupIds as string[]) : undefined,
        deviceAcl:
          body.deviceAcl && typeof body.deviceAcl === 'object'
            ? (body.deviceAcl as Record<string, string[]>)
            : undefined,
        ssoProvider: body.ssoProvider as SsoProviderId | 'none' | undefined,
        ssoExternalId: typeof body.ssoExternalId === 'string' ? body.ssoExternalId : undefined,
        ...extras
      })
      sendJson(res, 200, { ok: true, user })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '创建失败' })
    }
    return true
  }

  const userMatch = path.match(/^\/api\/v1\/users\/([^/]+)$/)
  if (userMatch) {
    const id = decodeURIComponent(userMatch[1])
    if (method === 'PATCH' || method === 'PUT') {
      if (!requireAdminish(auth, res, sendJson)) return true
      try {
        let body = await parseJson(req, readBody)
        try {
          const pm = deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'user_update',
              { proceed: true, id, body },
              {
                method,
                path,
                url: new URL('http://local' + path),
                query: {},
                headers: {},
                auth
              }
            )) as {
              proceed?: boolean
              status?: number
              body?: Record<string, unknown>
              message?: string
            }
            if (before && before.proceed === false) {
              sendJson(res, before.status || 403, {
                ok: false,
                message: before.message || 'blocked'
              })
              return true
            }
            if (before?.body && typeof before.body === 'object') body = before.body
          }
        } catch {
          /* ignore */
        }
        const prev = deps.users.getById(id)
        const extras = pickUserExtras(body)
        const user = deps.users.update(id, {
          displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
          level: body.level as UserLevel | undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : undefined,
          groupIds: Array.isArray(body.groupIds) ? (body.groupIds as string[]) : undefined,
          deviceAcl:
            body.deviceAcl && typeof body.deviceAcl === 'object'
              ? (body.deviceAcl as Record<string, string[]>)
              : undefined,
          password: typeof body.password === 'string' ? body.password : undefined,
          ssoProvider: body.ssoProvider as SsoProviderId | 'none' | undefined,
          ssoExternalId: typeof body.ssoExternalId === 'string' ? body.ssoExternalId : undefined,
          ...extras
        })
        if (prev?.enabled && user.enabled === false) {
          deps.presence?.kick(id)
        }
        sendJson(res, 200, { ok: true, user })
      } catch (e) {
        sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '更新失败' })
      }
      return true
    }
    if (method === 'DELETE') {
      if (!requireAdminish(auth, res, sendJson)) return true
      try {
        try {
          const pm = deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'user_delete',
              { proceed: true, id },
              {
                method,
                path,
                url: new URL('http://local' + path),
                query: {},
                headers: {},
                auth
              }
            )) as { proceed?: boolean; status?: number; message?: string }
            if (before && before.proceed === false) {
              sendJson(res, before.status || 403, {
                ok: false,
                message: before.message || 'blocked'
              })
              return true
            }
          }
        } catch {
          /* ignore */
        }
        deps.presence?.kick(id)
        deps.users.remove(id)
        sendJson(res, 200, { ok: true })
      } catch (e) {
        sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '删除失败' })
      }
      return true
    }
  }

  const kickMatch = path.match(/^\/api\/v1\/users\/([^/]+)\/kick$/)
  if (method === 'POST' && kickMatch) {
    if (!requireAdminish(auth, res, sendJson)) return true
    const id = decodeURIComponent(kickMatch[1])
    const user = deps.users.getById(id)
    if (!user) {
      sendJson(res, 404, { ok: false, message: '用户不存在' })
      return true
    }
    if (auth.kind === 'user' && auth.user.id === id) {
      sendJson(res, 400, { ok: false, message: '不能踢自己下线' })
      return true
    }
    const result = deps.presence?.kick(id) || { ok: true as const, wasOnline: false }
    sendJson(res, 200, {
      ok: true,
      wasOnline: result.wasOnline,
      message: result.wasOnline ? '已踢下线' : '用户当前不在线（已吊销其登录令牌）'
    })
    return true
  }

  const banMatch = path.match(/^\/api\/v1\/users\/([^/]+)\/ban$/)
  if (method === 'POST' && banMatch) {
    if (!requireAdminish(auth, res, sendJson)) return true
    const id = decodeURIComponent(banMatch[1])
    if (auth.kind === 'user' && auth.user.id === id) {
      sendJson(res, 400, { ok: false, message: '不能封禁自己' })
      return true
    }
    try {
      const body = await parseJson(req, readBody).catch(() => ({} as Record<string, unknown>))
      const reason = typeof body.reason === 'string' ? body.reason : undefined
      const user = deps.users.ban(id, reason)
      deps.presence?.kick(id)
      sendJson(res, 200, { ok: true, user, message: '已封号并踢下线' })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '封号失败' })
    }
    return true
  }

  const unbanMatch = path.match(/^\/api\/v1\/users\/([^/]+)\/unban$/)
  if (method === 'POST' && unbanMatch) {
    if (!requireAdminish(auth, res, sendJson)) return true
    const id = decodeURIComponent(unbanMatch[1])
    try {
      const user = deps.users.unban(id)
      sendJson(res, 200, { ok: true, user, message: '已解封' })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '解封失败' })
    }
    return true
  }

  if (method === 'GET' && path === '/api/v1/print-requests') {
    const url = new URL(req.url || '', 'http://localhost')
    const deviceId = url.searchParams.get('deviceId') || undefined
    const statusParam = url.searchParams.get('status') || undefined
    const statusFilter = statusParam
      ? (statusParam.split(',').map((s) => s.trim()) as PrintRequestStatus[])
      : undefined

    let requests =
      canManagePrintQueue(auth)
        ? deps.printRequests.list({
            deviceId,
            status: statusFilter
          })
        : auth.kind === 'user'
          ? deps.printRequests.list({
              requesterId: auth.user.id,
              deviceId,
              status: statusFilter
            })
          : null
    if (requests == null) {
      sendJson(res, 401, { ok: false, message: '需要登录' })
      return true
    }
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        requests = (await pm.runHook(
          'print_request_list',
          requests,
          {
            method,
            path,
            url,
            query: Object.fromEntries(url.searchParams),
            headers: {},
            auth
          }
        )) as typeof requests
      }
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true, requests })
    return true
  }

  if (method === 'POST' && path === '/api/v1/print-requests') {
    const user = auth.kind === 'user' ? auth.user : null
    if (!user) {
      sendJson(res, 401, { ok: false, message: '需要用户登录后提交打印' })
      return true
    }
    try {
      let body = await parseJson(req, readBody)
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'print_request_create',
            { proceed: true, body },
            {
              method,
              path,
              url: new URL('http://local' + path),
              query: {},
              headers: {},
              auth
            }
          )) as {
            proceed?: boolean
            status?: number
            body?: Record<string, unknown>
            message?: string
          }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, {
              ok: false,
              message: before.message || 'blocked'
            })
            return true
          }
          if (before?.body && typeof before.body === 'object') body = before.body
        }
      } catch {
        /* ignore */
      }
      const deviceId = String(body.deviceId || '')
      const filename = String(body.filename || '').trim()
      const contentBase64 =
        typeof body.contentBase64 === 'string' ? body.contentBase64 : undefined
      if (!deviceId || !filename) {
        sendJson(res, 400, { ok: false, message: '需要 deviceId 与 filename' })
        return true
      }
      if (!/\.gcode$/i.test(filename)) {
        sendJson(res, 400, { ok: false, message: '仅支持 .gcode 文件' })
        return true
      }
      if (!contentBase64) {
        sendJson(res, 400, { ok: false, message: '需要上传 G 文件内容 (contentBase64)' })
        return true
      }
      if (!canRequestPrint(user, deviceId) && !canDirectPrint(user, deviceId)) {
        sendJson(res, 403, { ok: false, message: '无申请打印或打印权限' })
        return true
      }
      const devices = deps.getDevices()
      const dev = devices.find((d) => d.id === deviceId)
      const direct = canDirectPrint(user, deviceId)
      const extras = pickPrintExtras(body)
      const row = deps.printRequests.create({
        requesterId: user.id,
        requesterName: user.displayName || user.username,
        deviceId,
        deviceName: (typeof body.deviceName === 'string' && body.deviceName) || dev?.name || deviceId,
        filename,
        contentBase64,
        note: typeof body.note === 'string' ? body.note : undefined,
        status: direct ? 'queued' : 'pending',
        ...extras
      })
      sendJson(res, 200, {
        ok: true,
        request: row,
        queued: direct,
        queuePosition: row.queuePosition
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '提交失败' })
    }
    return true
  }

  const prMatch = path.match(/^\/api\/v1\/print-requests\/([^/]+)\/(approve|reject|start|cancel)$/)
  if (prMatch && method === 'POST') {
    const id = decodeURIComponent(prMatch[1])
    const action = prMatch[2] as 'approve' | 'reject' | 'start' | 'cancel'
    const hookCtx = {
      method,
      path,
      url: new URL('http://local' + path),
      query: {},
      headers: {},
      auth
    }

    if (action === 'cancel') {
      if (auth.kind !== 'user' && auth.kind !== 'local' && auth.kind !== 'apiKey') {
        sendJson(res, 401, { ok: false, message: '需要登录' })
        return true
      }
      try {
        try {
          const pm = deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'print_cancel',
              { proceed: true, id },
              hookCtx
            )) as { proceed?: boolean; status?: number; message?: string }
            if (before && before.proceed === false) {
              sendJson(res, before.status || 403, {
                ok: false,
                message: before.message || 'blocked'
              })
              return true
            }
          }
        } catch {
          /* ignore */
        }
        const asAdmin = canManagePrintQueue(auth)
        const actorId = auth.kind === 'user' ? auth.user.id : 'local'
        const row = deps.printRequests.cancel(id, actorId, asAdmin)
        sendJson(res, 200, { ok: true, request: row })
      } catch (e) {
        sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '取消失败' })
      }
      return true
    }

    if (action === 'approve' || action === 'reject') {
      const allowed =
        auth.kind === 'local' ||
        auth.kind === 'apiKey' ||
        (auth.kind === 'user' &&
          hasPerm(
            effectivePermissions(auth.user),
            action === 'approve' ? 'print.approve' : 'print.reject'
          ))
      if (!allowed) {
        sendJson(res, 403, { ok: false, message: '无审核权限' })
        return true
      }
      try {
        let body = await parseJson(req, readBody).catch(() => ({} as Record<string, unknown>))
        try {
          const pm = deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              action === 'approve' ? 'print_approve' : 'print_reject',
              { proceed: true, id, body },
              hookCtx
            )) as {
              proceed?: boolean
              status?: number
              body?: Record<string, unknown>
              message?: string
            }
            if (before && before.proceed === false) {
              sendJson(res, before.status || 403, {
                ok: false,
                message: before.message || 'blocked'
              })
              return true
            }
            if (before?.body && typeof before.body === 'object') body = before.body
          }
        } catch {
          /* ignore */
        }
        const reviewer =
          auth.kind === 'user'
            ? { id: auth.user.id, name: auth.user.displayName || auth.user.username }
            : { id: 'local', name: '本机管理' }
        const note =
          typeof body.note === 'string' ? body.note : undefined
        const row =
          action === 'approve'
            ? deps.printRequests.approve(id, reviewer, note)
            : deps.printRequests.reject(id, reviewer, note)
        sendJson(res, 200, { ok: true, request: row })
      } catch (e) {
        sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '处理失败' })
      }
      return true
    }

    if (action === 'start') {
      if (!canManagePrintQueue(auth)) {
        sendJson(res, 403, { ok: false, message: '仅管理员可开始队列打印' })
        return true
      }
      try {
        try {
          const pm = deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'print_start',
              { proceed: true, id },
              hookCtx
            )) as { proceed?: boolean; status?: number; message?: string }
            if (before && before.proceed === false) {
              sendJson(res, before.status || 403, {
                ok: false,
                message: before.message || 'blocked'
              })
              return true
            }
          }
        } catch {
          /* ignore */
        }
        const starter =
          auth.kind === 'user'
            ? { id: auth.user.id, name: auth.user.displayName || auth.user.username }
            : { id: 'local', name: '本机管理' }
        const full = deps.printRequests.markPrinting(id, starter)
        const dispatch = deps.onStartPrintJob || deps.onApprovedPrint
        if (!dispatch) {
          deps.printRequests.markFailed(id, '服务端未配置打印下发')
          sendJson(res, 500, { ok: false, message: '服务端未配置打印下发' })
          return true
        }
        const result = await dispatch({
          deviceId: full.deviceId,
          filename: full.filename,
          contentBase64: full.contentBase64
        })
        if (!result.ok) {
          const failed = deps.printRequests.markFailed(id, result.message || '下发打印失败')
          sendJson(res, 502, {
            ok: false,
            message: result.message || '下发打印失败',
            request: failed
          })
          return true
        }
        const done = deps.printRequests.markDone(id)
        sendJson(res, 200, { ok: true, request: done })
      } catch (e) {
        sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '开始打印失败' })
      }
      return true
    }
  }

  return false
}

/** Guard a device control action for JWT users; apiKey/local always pass */
export function assertDeviceControlAllowed(
  auth: AuthContext,
  deviceId: string,
  action: string
): { ok: true } | { ok: false; message: string; status: number } {
  if (auth.kind === 'apiKey' || auth.kind === 'local') return { ok: true }
  if (auth.kind !== 'user') return { ok: false, status: 401, message: '未登录' }
  const map: Record<string, string> = {
    pause: 'pause',
    resume: 'resume',
    cancel: 'cancel',
    emergency_stop: 'emergency_stop',
    home: 'home',
    jog: 'jog',
    set_temp: 'set_temp',
    set_fan: 'set_fan',
    set_speed: 'set_speed',
    set_flow: 'set_flow',
    set_z_offset: 'set_z_offset',
    set_chamber_temp: 'set_chamber_temp',
    extrude: 'extrude',
    retract: 'retract',
    restart: 'restart',
    firmware_restart: 'firmware_restart',
    print_file: 'print',
    load_filament: 'filament_load',
    unload_filament: 'filament_unload',
    moonraker: 'moonraker',
    gcode: 'gcode',
    'files.read': 'files.read',
    'files.upload': 'files.upload'
  }
  const act = map[action]
  if (!act) return { ok: false, status: 400, message: '未知操作' }
  if (act === 'print') {
    if (canDirectPrint(auth.user, deviceId)) return { ok: true }
    if (canRequestPrint(auth.user, deviceId)) {
      return {
        ok: false,
        status: 403,
        message: '当前账号无直接打印权限，请提交打印申请'
      }
    }
    return { ok: false, status: 403, message: '无打印权限' }
  }
  if (!canDeviceAction(auth.user, deviceId, act as 'pause')) {
    return { ok: false, status: 403, message: `无权限: ${act}` }
  }
  return { ok: true }
}

export function filterDevicesForAuth<T extends { id: string }>(
  auth: AuthContext,
  devices: T[]
): T[] {
  if (auth.kind === 'apiKey' || auth.kind === 'local') return devices
  if (auth.kind !== 'user') return []
  return devices.filter((d) => canDeviceAction(auth.user, d.id, 'view'))
}
