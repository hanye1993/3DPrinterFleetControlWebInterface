import { createConnection } from 'net'
import type {
  AdSsoSettings,
  DingtalkSsoSettings,
  SsoSettingsBundle,
  WecomSsoSettings
} from '../../shared/sso'
import { isAdConfigured, isDingtalkConfigured, isWecomConfigured } from '../../shared/sso'

async function httpJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init)
  const data = (await res.json()) as Record<string, unknown>
  return data
}

let wecomTokenCache: { token: string; expiresAt: number } | null = null

export async function getWecomAccessToken(cfg: WecomSsoSettings): Promise<string> {
  if (!isWecomConfigured(cfg)) throw new Error('企业微信未配置 CorpId / Secret')
  if (wecomTokenCache && wecomTokenCache.expiresAt > Date.now() + 30_000) {
    return wecomTokenCache.token
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.secret)}`
  const data = await httpJson(url)
  if (data.errcode && Number(data.errcode) !== 0) {
    throw new Error(String(data.errmsg || '获取企微 token 失败'))
  }
  const token = String(data.access_token || '')
  if (!token) throw new Error('企微 access_token 为空')
  const expiresIn = Number(data.expires_in) || 7200
  wecomTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 }
  return token
}

export function buildWecomAuthorizeUrl(opts: {
  cfg: WecomSsoSettings
  redirectUri: string
  state: string
}): string {
  const appid = opts.cfg.corpId
  const agentid = opts.cfg.agentId || ''
  const redirect = encodeURIComponent(opts.redirectUri)
  const state = encodeURIComponent(opts.state)
  // 企业微信网页授权 / 扫码登录
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(appid)}&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&state=${state}&agentid=${encodeURIComponent(agentid)}#wechat_redirect`
}

export async function exchangeWecomCode(
  cfg: WecomSsoSettings,
  code: string
): Promise<{ userid: string }> {
  const token = await getWecomAccessToken(cfg)
  const url = `https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`
  const data = await httpJson(url)
  if (data.errcode && Number(data.errcode) !== 0) {
    throw new Error(String(data.errmsg || '企微 code 兑换失败'))
  }
  const userid = String(data.UserId || data.userid || '')
  if (!userid) throw new Error('未获取到企微 UserId（请确认扫码账号在可见范围）')
  return { userid }
}

let dingTokenCache: { token: string; expiresAt: number } | null = null

export async function getDingtalkAccessToken(cfg: DingtalkSsoSettings): Promise<string> {
  if (!isDingtalkConfigured(cfg)) throw new Error('钉钉未配置 AppKey / AppSecret')
  if (dingTokenCache && dingTokenCache.expiresAt > Date.now() + 30_000) {
    return dingTokenCache.token
  }
  const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(cfg.appKey)}&appsecret=${encodeURIComponent(cfg.appSecret)}`
  const data = await httpJson(url)
  if (data.errcode && Number(data.errcode) !== 0) {
    throw new Error(String(data.errmsg || '获取钉钉 token 失败'))
  }
  const token = String(data.access_token || '')
  if (!token) throw new Error('钉钉 access_token 为空')
  const expiresIn = Number(data.expires_in) || 7200
  dingTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 }
  return token
}

export function buildDingtalkAuthorizeUrl(opts: {
  cfg: DingtalkSsoSettings
  redirectUri: string
  state: string
}): string {
  const redirect = encodeURIComponent(opts.redirectUri)
  const state = encodeURIComponent(opts.state)
  const clientId = encodeURIComponent(opts.cfg.appKey)
  return `https://login.dingtalk.com/oauth2/auth?redirect_uri=${redirect}&response_type=code&client_id=${clientId}&scope=openid&state=${state}&prompt=consent`
}

export async function exchangeDingtalkCode(
  cfg: DingtalkSsoSettings,
  code: string
): Promise<{ userid: string }> {
  // OAuth userAccessToken
  const tokenRes = await httpJson('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: cfg.appKey,
      clientSecret: cfg.appSecret,
      code,
      grantType: 'authorization_code'
    })
  })
  const userAccessToken = String(tokenRes.accessToken || tokenRes.access_token || '')
  if (!userAccessToken) {
    throw new Error(String(tokenRes.message || tokenRes.errmsg || '钉钉 code 兑换失败'))
  }
  const meRes = await httpJson('https://api.dingtalk.com/v1.0/contact/users/me', {
    headers: { 'x-acs-dingtalk-access-token': userAccessToken }
  })
  const userid = String(meRes.unionId || meRes.openId || meRes.userid || meRes.userId || '')
  if (!userid) throw new Error('未获取到钉钉用户标识')
  return { userid }
}

/** Minimal LDAP simple bind over TCP (no StartTLS). For lab / intranet AD. */
export async function authenticateAd(
  cfg: AdSsoSettings,
  username: string,
  password: string
): Promise<{ ok: boolean; externalId?: string; message?: string }> {
  if (!isAdConfigured(cfg)) {
    return { ok: false, message: 'AD 未配置 ldapUrl / baseDn' }
  }
  const user = username.trim()
  if (!user || !password) return { ok: false, message: '域账号或密码为空' }

  let host = ''
  let port = 389
  try {
    const u = new URL(cfg.ldapUrl)
    host = u.hostname
    port = u.port ? Number(u.port) : u.protocol === 'ldaps:' ? 636 : 389
  } catch {
    return { ok: false, message: 'ldapUrl 无效' }
  }

  const upn = user.includes('@') ? user : cfg.domain ? `${user}@${cfg.domain}` : user
  // Prefer UPN bind; also try DOMAIN\user
  const bindCandidates = [
    upn,
    cfg.domain && !user.includes('\\') ? `${cfg.domain}\\${user}` : '',
    user
  ].filter(Boolean)

  for (const bindName of bindCandidates) {
    const ok = await ldapSimpleBind(host, port, bindName, password)
    if (ok) {
      const externalId = user.includes('\\') ? user.split('\\').pop() || user : user.split('@')[0] || user
      return { ok: true, externalId }
    }
  }
  return { ok: false, message: 'AD 账号或密码错误' }
}

function ldapSimpleBind(
  host: string,
  port: number,
  bindDn: string,
  password: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    const timer = setTimeout(() => done(false), 8000)
    socket.on('error', () => {
      clearTimeout(timer)
      done(false)
    })
    socket.on('connect', () => {
      // LDAP BindRequest (simple)
      const dnBuf = Buffer.from(bindDn, 'utf8')
      const pwBuf = Buffer.from(password, 'utf8')
      const bindPayload = Buffer.concat([
        Buffer.from([0x02, 0x01, 0x03]), // version 3
        Buffer.from([0x04, dnBuf.length]),
        dnBuf,
        Buffer.from([0x80, pwBuf.length]),
        pwBuf
      ])
      const bindSeq = Buffer.concat([
        Buffer.from([0x60, bindPayload.length]),
        bindPayload
      ])
      const msg = Buffer.concat([
        Buffer.from([0x30, bindSeq.length + 5, 0x02, 0x01, 0x01]),
        bindSeq
      ])
      // Fix length byte if needed — use proper BER for small messages
      const messageId = Buffer.from([0x02, 0x01, 0x01])
      const inner = Buffer.concat([messageId, Buffer.from([0x60, bindPayload.length]), bindPayload])
      const packet = Buffer.concat([Buffer.from([0x30, inner.length]), inner])
      socket.write(packet)
    })
    socket.on('data', (buf) => {
      clearTimeout(timer)
      const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
      let ok = false
      for (let i = 0; i < data.length - 2; i++) {
        if (data[i] === 0x0a && data[i + 1] === 0x01 && data[i + 2] === 0x00) {
          ok = true
          break
        }
      }
      done(ok)
    })
  })
}

export function resolveSsoRedirect(
  provider: 'wecom' | 'dingtalk',
  sso: SsoSettingsBundle,
  apiBase: string
): string {
  const custom =
    provider === 'wecom' ? sso.wecom.redirectUri : sso.dingtalk.redirectUri
  if (custom) return custom
  return `${apiBase.replace(/\/$/, '')}/api/v1/auth/sso/callback/${provider}`
}

import { buildHttpUrl } from '../../shared/serverUrl'

export function resolveApiPublicBase(settings: {
  publicIp?: string
  publicIpv6?: string
  domain?: string
  apiPort?: number
}): string {
  if (settings.domain) {
    const d = settings.domain.replace(/\/$/, '')
    return d.startsWith('http') ? d : `https://${d}`
  }
  if (settings.publicIpv6) {
    const ip = settings.publicIpv6.replace(/\/$/, '').replace(/^\[/, '').replace(/\]$/, '')
    if (ip.startsWith('http')) return ip
    const port = settings.apiPort || 17890
    return buildHttpUrl(ip, port)
  }
  if (settings.publicIp) {
    const ip = settings.publicIp.replace(/\/$/, '')
    if (ip.startsWith('http')) return ip
    const port = settings.apiPort || 17890
    return buildHttpUrl(ip, port)
  }
  return `http://127.0.0.1:${settings.apiPort || 17890}`
}
