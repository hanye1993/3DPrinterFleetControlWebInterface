import type { IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import { signJwt } from './jwt'
import type { UserStore } from './users'
import {
  listEnabledSsoProviders,
  userHasSsoBinding,
  type SsoSettingsBundle
} from '../../shared/sso'
import {
  authenticateAd,
  buildDingtalkAuthorizeUrl,
  buildWecomAuthorizeUrl,
  exchangeDingtalkCode,
  exchangeWecomCode,
  resolveApiPublicBase,
  resolveSsoRedirect
} from './ssoProviders'
import {
  completeSsoQrSession,
  createSsoQrSession,
  failSsoQrSession,
  getSsoQrSession,
  publicQrSession
} from './ssoSessions'
import type { PresenceStore } from './presence'
import { mePayload } from './authApi'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export type SsoPublicDeps = {
  users: UserStore
  presence?: PresenceStore
  getSso: () => SsoSettingsBundle
  getApiBaseSettings: () => { publicIp?: string; publicIpv6?: string; domain?: string; apiPort?: number }
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
    emitDomainEvent: (name: string, payload?: unknown) => Promise<void>
  } | null
}

async function finishSsoLogin(
  deps: SsoPublicDeps,
  provider: 'wecom' | 'dingtalk' | 'ad',
  externalId: string,
  ctx: { method: string; path: string }
): Promise<
  | { ok: true; token: string; userId: string; me: ReturnType<typeof mePayload> }
  | { ok: false; status: number; body: unknown }
> {
  const sso = deps.getSso()
  const pm = deps.getPluginManager?.()
  if (pm) {
    const before = (await pm.runHook(
      'sso_before',
      { proceed: true, provider, externalId },
      ctx
    )) as { proceed?: boolean; status?: number; body?: unknown; externalId?: string }
    if (before && before.proceed === false) {
      return {
        ok: false,
        status: before.status || 403,
        body: before.body ?? { ok: false, message: 'sso blocked' }
      }
    }
    if (before?.externalId) externalId = String(before.externalId)
  }
  const issued = issueTokenForExternal(deps.users, provider, externalId, sso, deps.presence)
  if (!issued.ok) {
    return { ok: false, status: 401, body: { ok: false, message: issued.message } }
  }
  const user = deps.users.getById(issued.userId)!
  const me = mePayload(user)
  if (pm) {
    await pm.runHook('sso_after', { ...me, token: issued.token, provider, externalId }, ctx)
    void pm.emitDomainEvent('action:auth.session.created', {
      userId: issued.userId,
      via: `sso:${provider}`
    })
  }
  return { ok: true, token: issued.token, userId: issued.userId, me }
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

function issueTokenForExternal(
  users: UserStore,
  provider: 'wecom' | 'dingtalk' | 'ad',
  externalId: string,
  sso?: SsoSettingsBundle,
  presence?: PresenceStore
): { ok: true; token: string; userId: string } | { ok: false; message: string } {
  const user = users.getBySso(provider, externalId)
  if (!user) {
    return {
      ok: false,
      message: `未找到绑定该${provider === 'wecom' ? '企微' : provider === 'dingtalk' ? '钉钉' : 'AD'}账号的用户，请先在服务端用户管理中绑定`
    }
  }
  if (!user.enabled) {
    return {
      ok: false,
      message: user.banReason
        ? `账号已被封禁：${user.banReason}`
        : '账号已被封禁，请联系管理员解封'
    }
  }
  if (sso?.requireBinding && !userHasSsoBinding(user)) {
    return { ok: false, message: '已开启强制绑定，账号未完成对接绑定' }
  }
  const token = signJwt(
    { sub: user.id, username: user.username, level: user.level },
    users.getJwtSecret()
  )
  presence?.touch(user)
  return { ok: true, token, userId: user.id }
}

/**
 * Public SSO routes (no JWT required). Returns true if handled.
 */
export async function handleSsoPublicApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  deps: SsoPublicDeps
  sendJson: SendJson
  readBody: ReadBody
}): Promise<boolean> {
  const { method, path, url, req, res, deps, sendJson, readBody } = opts
  const sso = deps.getSso()

  if (method === 'GET' && path === '/api/v1/auth/sso/providers') {
    sendJson(res, 200, {
      ok: true,
      providers: listEnabledSsoProviders(sso),
      allowDevConfirm: sso.allowDevConfirm,
      requireBinding: sso.requireBinding,
      requireSsoLogin: sso.requireSsoLogin,
      ssoFeatureAvailable: Boolean(sso.wecom.enabled || sso.dingtalk.enabled || sso.ad.enabled)
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/sso/qr/start') {
    try {
      const body = await parseJson(req, readBody)
      const provider = body.provider === 'dingtalk' ? 'dingtalk' : body.provider === 'wecom' ? 'wecom' : null
      if (!provider) {
        sendJson(res, 400, { ok: false, message: 'provider 须为 wecom 或 dingtalk' })
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

      const apiBase = resolveApiPublicBase(deps.getApiBaseSettings())
      // Create session first with placeholder URL, then fill authorize URL with state=session.id
      const redirectUri = resolveSsoRedirect(provider, sso, apiBase)
      const draft = createSsoQrSession({
        provider,
        authorizeUrl: '',
        mode: 'login'
      })
      const authorizeUrl =
        provider === 'wecom'
          ? buildWecomAuthorizeUrl({
              cfg: sso.wecom,
              redirectUri,
              state: draft.id
            })
          : buildDingtalkAuthorizeUrl({
              cfg: sso.dingtalk,
              redirectUri,
              state: draft.id
            })
      draft.authorizeUrl = authorizeUrl
      // Dev mode without credentials: QR points to a confirm hint page URL (open in browser)
      if (!opt.configured && sso.allowDevConfirm) {
        draft.authorizeUrl = `${apiBase}/api/v1/auth/sso/qr/${draft.id}/dev-hint`
      }

      sendJson(res, 200, { ok: true, session: publicQrSession(draft) })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '创建扫码会话失败' })
    }
    return true
  }

  const statusMatch = path.match(/^\/api\/v1\/auth\/sso\/qr\/([^/]+)\/status$/)
  if (method === 'GET' && statusMatch) {
    const id = decodeURIComponent(statusMatch[1])
    const session = getSsoQrSession(id)
    if (!session) {
      sendJson(res, 404, { ok: false, message: '会话不存在或已过期' })
      return true
    }
    const pub = publicQrSession(session)
    if (session.status === 'ok' && session.userId) {
      const user = deps.users.getById(session.userId)
      if (user && session.token) {
        const me = mePayload(user)
        const requireBinding = Boolean(sso.requireBinding)
        sendJson(res, 200, {
          ...me,
          session: pub,
          token: session.token,
          requireBinding,
          needsSsoBind: requireBinding && !userHasSsoBinding(user)
        })
        return true
      }
    }
    sendJson(res, 200, { ok: true, session: pub })
    return true
  }

  if (method === 'GET' && path.match(/^\/api\/v1\/auth\/sso\/qr\/[^/]+\/dev-hint$/)) {
    const id = path.split('/')[5]
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><meta charset="utf-8"/><title>开发确认登录</title>
      <body style="font-family:sans-serif;padding:24px">
      <h2>开发模式扫码确认</h2>
      <p>会话 ${id}</p>
      <p>请在服务端「允许开发确认」开启后，用客户端或 API 提交 externalId 完成登录。</p>
      </body>`
    )
    return true
  }

  const devConfirm = path.match(/^\/api\/v1\/auth\/sso\/qr\/([^/]+)\/dev-confirm$/)
  if (method === 'POST' && devConfirm) {
    if (!sso.allowDevConfirm) {
      sendJson(res, 403, { ok: false, message: '未开启开发确认' })
      return true
    }
    try {
      const id = decodeURIComponent(devConfirm[1])
      const session = getSsoQrSession(id)
      if (!session || session.status !== 'pending') {
        sendJson(res, 400, { ok: false, message: '会话无效' })
        return true
      }
      const body = await parseJson(req, readBody)
      const externalId = String(body.externalId || '').trim()
      if (!externalId) {
        sendJson(res, 400, { ok: false, message: '需要 externalId' })
        return true
      }
      const finished = await finishSsoLogin(deps, session.provider, externalId, { method, path })
      if (!finished.ok) {
        failSsoQrSession(id, String((finished.body as { message?: string })?.message || 'sso failed'))
        sendJson(res, finished.status, finished.body)
        return true
      }
      completeSsoQrSession(id, {
        externalId,
        userId: finished.userId,
        token: finished.token
      })
      sendJson(res, 200, { ...finished.me, token: finished.token })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : '确认失败' })
    }
    return true
  }

  const cbWecom = method === 'GET' && path === '/api/v1/auth/sso/callback/wecom'
  const cbDing = method === 'GET' && path === '/api/v1/auth/sso/callback/dingtalk'
  if (cbWecom || cbDing) {
    const provider = cbWecom ? 'wecom' : 'dingtalk'
    const code = String(url.searchParams.get('code') || '')
    const state = String(url.searchParams.get('state') || '')
    const session = getSsoQrSession(state)
    if (!session || session.provider !== provider) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h3>登录会话无效或已过期，请回到客户端重新扫码</h3>')
      return true
    }
    try {
      if (!code) throw new Error('缺少 code')
      const { userid } =
        provider === 'wecom'
          ? await exchangeWecomCode(sso.wecom, code)
          : await exchangeDingtalkCode(sso.dingtalk, code)

      if (session.mode === 'bind') {
        if (!session.userId) throw new Error('绑定会话缺少用户')
        const clash = deps.users.getBySso(provider, userid)
        if (clash && clash.id !== session.userId) {
          throw new Error('该对接账号已被其他用户绑定')
        }
        deps.users.update(session.userId, {
          ssoProvider: provider,
          ssoExternalId: userid
        })
        completeSsoQrSession(state, { externalId: userid, userId: session.userId })
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><meta charset="utf-8"/><title>绑定成功</title><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>绑定成功</h2><p>请返回监控台客户端继续。</p></body>'
        )
        return true
      }

      const finished = await finishSsoLogin(deps, provider, userid, { method, path })
      if (!finished.ok) {
        const msg = String((finished.body as { message?: string })?.message || '登录失败')
        failSsoQrSession(state, msg)
        res.writeHead(finished.status || 400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<h3>${msg}</h3>`)
        return true
      }
      completeSsoQrSession(state, {
        externalId: userid,
        userId: finished.userId,
        token: finished.token
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><meta charset="utf-8"/><title>登录成功</title><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>登录成功</h2><p>请返回监控台客户端，将自动进入。</p></body>'
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failSsoQrSession(state, msg)
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h3>${session.mode === 'bind' ? '绑定' : '登录'}失败：${msg}</h3>`)
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/auth/sso/ad/login') {
    try {
      if (!sso.ad.enabled) {
        sendJson(res, 400, { ok: false, message: 'AD 未启用' })
        return true
      }
      const body = await parseJson(req, readBody)
      const username = String(body.username || '')
      const password = String(body.password || '')
      const ad = await authenticateAd(sso.ad, username, password)
      if (!ad.ok || !ad.externalId) {
        sendJson(res, 401, { ok: false, message: ad.message || 'AD 登录失败' })
        return true
      }
      const finished = await finishSsoLogin(deps, 'ad', ad.externalId, { method, path })
      if (!finished.ok) {
        sendJson(res, finished.status, finished.body)
        return true
      }
      sendJson(res, 200, { ...finished.me, token: finished.token })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : 'AD 登录失败' })
    }
    return true
  }

  return false
}
