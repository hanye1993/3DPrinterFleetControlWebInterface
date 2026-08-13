/** Enterprise IdP / SSO providers for server user binding & login */

export type SsoProviderId = 'wecom' | 'dingtalk' | 'ad'

export type SsoProviderOption = {
  id: SsoProviderId
  label: string
  /** QR scan login supported */
  scanLogin: boolean
  enabled: boolean
  configured: boolean
}

export type WecomSsoSettings = {
  enabled: boolean
  corpId: string
  agentId: string
  secret: string
  /** OAuth redirect (must match企微后台); empty = use API base + callback path */
  redirectUri: string
}

export type DingtalkSsoSettings = {
  enabled: boolean
  appKey: string
  appSecret: string
  corpId: string
  redirectUri: string
}

export type AdSsoSettings = {
  enabled: boolean
  /** e.g. ldap://dc.example.com:389 or ldaps://dc.example.com:636 */
  ldapUrl: string
  baseDn: string
  /** Optional service account for search */
  bindDn: string
  bindPassword: string
  /** Use {username} placeholder, default (&(objectClass=user)(sAMAccountName={username})) */
  userFilter: string
  domain: string
}

export type SsoSettingsBundle = {
  wecom: WecomSsoSettings
  dingtalk: DingtalkSsoSettings
  ad: AdSsoSettings
  /** Allow POST confirm with externalId for lab testing (no real scan) */
  allowDevConfirm: boolean
  /**
   * 强制用户绑定企微/钉钉/AD 之一；未绑定则无法登录使用。
   * 需至少启用一个对接模块才可开启。
   */
  requireBinding: boolean
  /**
   * 强制企微/钉钉扫码或 AD 域登录；关闭则仍可用账号密码。
   * 需至少启用一个对接模块才可开启。
   */
  requireSsoLogin: boolean
}

export const SSO_PROVIDER_LABELS: Record<SsoProviderId, string> = {
  wecom: '企业微信',
  dingtalk: '钉钉',
  ad: 'AD 域'
}

export function defaultWecomSso(): WecomSsoSettings {
  return { enabled: false, corpId: '', agentId: '', secret: '', redirectUri: '' }
}

export function defaultDingtalkSso(): DingtalkSsoSettings {
  return { enabled: false, appKey: '', appSecret: '', corpId: '', redirectUri: '' }
}

export function defaultAdSso(): AdSsoSettings {
  return {
    enabled: false,
    ldapUrl: '',
    baseDn: '',
    bindDn: '',
    bindPassword: '',
    userFilter: '(&(objectClass=user)(sAMAccountName={username}))',
    domain: ''
  }
}

export function defaultSsoSettings(): SsoSettingsBundle {
  return {
    wecom: defaultWecomSso(),
    dingtalk: defaultDingtalkSso(),
    ad: defaultAdSso(),
    allowDevConfirm: false,
    requireBinding: false,
    requireSsoLogin: false
  }
}

export function normalizeWecomSso(raw: unknown): WecomSsoSettings {
  const d = defaultWecomSso()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  return {
    enabled: Boolean(o.enabled),
    corpId: typeof o.corpId === 'string' ? o.corpId.trim() : '',
    agentId: typeof o.agentId === 'string' ? o.agentId.trim() : '',
    secret: typeof o.secret === 'string' ? o.secret : '',
    redirectUri: typeof o.redirectUri === 'string' ? o.redirectUri.trim() : ''
  }
}

export function normalizeDingtalkSso(raw: unknown): DingtalkSsoSettings {
  const d = defaultDingtalkSso()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  return {
    enabled: Boolean(o.enabled),
    appKey: typeof o.appKey === 'string' ? o.appKey.trim() : '',
    appSecret: typeof o.appSecret === 'string' ? o.appSecret : '',
    corpId: typeof o.corpId === 'string' ? o.corpId.trim() : '',
    redirectUri: typeof o.redirectUri === 'string' ? o.redirectUri.trim() : ''
  }
}

export function normalizeAdSso(raw: unknown): AdSsoSettings {
  const d = defaultAdSso()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  return {
    enabled: Boolean(o.enabled),
    ldapUrl: typeof o.ldapUrl === 'string' ? o.ldapUrl.trim() : '',
    baseDn: typeof o.baseDn === 'string' ? o.baseDn.trim() : '',
    bindDn: typeof o.bindDn === 'string' ? o.bindDn.trim() : '',
    bindPassword: typeof o.bindPassword === 'string' ? o.bindPassword : '',
    userFilter:
      typeof o.userFilter === 'string' && o.userFilter.trim()
        ? o.userFilter.trim()
        : d.userFilter,
    domain: typeof o.domain === 'string' ? o.domain.trim() : ''
  }
}

export function normalizeSsoSettings(raw: unknown): SsoSettingsBundle {
  const d = defaultSsoSettings()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  const bundle: SsoSettingsBundle = {
    wecom: normalizeWecomSso(o.wecom),
    dingtalk: normalizeDingtalkSso(o.dingtalk),
    ad: normalizeAdSso(o.ad),
    allowDevConfirm: Boolean(o.allowDevConfirm),
    requireBinding: Boolean(o.requireBinding),
    requireSsoLogin: Boolean(o.requireSsoLogin)
  }
  // 未启用任何对接时，强制策略不可用
  if (!hasAnySsoEnabled(bundle)) {
    bundle.requireBinding = false
    bundle.requireSsoLogin = false
  }
  return bundle
}

/** 是否至少启用了一个对接模块（策略开关依赖此项） */
export function hasAnySsoEnabled(sso: SsoSettingsBundle): boolean {
  return Boolean(sso.wecom.enabled || sso.dingtalk.enabled || sso.ad.enabled)
}

export function userHasSsoBinding(user: {
  ssoProvider?: string
  ssoExternalId?: string
}): boolean {
  const p = user.ssoProvider
  if (p !== 'wecom' && p !== 'dingtalk' && p !== 'ad') return false
  return Boolean(user.ssoExternalId && String(user.ssoExternalId).trim())
}

export function isWecomConfigured(s: WecomSsoSettings): boolean {
  return Boolean(s.corpId && s.secret)
}

export function isDingtalkConfigured(s: DingtalkSsoSettings): boolean {
  return Boolean(s.appKey && s.appSecret)
}

export function isAdConfigured(s: AdSsoSettings): boolean {
  return Boolean(s.ldapUrl && s.baseDn)
}

export function listEnabledSsoProviders(sso: SsoSettingsBundle): SsoProviderOption[] {
  const out: SsoProviderOption[] = []
  if (sso.wecom.enabled) {
    out.push({
      id: 'wecom',
      label: SSO_PROVIDER_LABELS.wecom,
      scanLogin: true,
      enabled: true,
      configured: isWecomConfigured(sso.wecom)
    })
  }
  if (sso.dingtalk.enabled) {
    out.push({
      id: 'dingtalk',
      label: SSO_PROVIDER_LABELS.dingtalk,
      scanLogin: true,
      enabled: true,
      configured: isDingtalkConfigured(sso.dingtalk)
    })
  }
  if (sso.ad.enabled) {
    out.push({
      id: 'ad',
      label: SSO_PROVIDER_LABELS.ad,
      scanLogin: false,
      enabled: true,
      configured: isAdConfigured(sso.ad)
    })
  }
  return out
}

export function publicSsoSettings(sso: SsoSettingsBundle): Record<string, unknown> {
  return {
    allowDevConfirm: sso.allowDevConfirm,
    requireBinding: sso.requireBinding,
    requireSsoLogin: sso.requireSsoLogin,
    ssoFeatureAvailable: hasAnySsoEnabled(sso),
    wecom: {
      enabled: sso.wecom.enabled,
      corpId: sso.wecom.corpId,
      agentId: sso.wecom.agentId,
      secretSet: Boolean(sso.wecom.secret),
      redirectUri: sso.wecom.redirectUri
    },
    dingtalk: {
      enabled: sso.dingtalk.enabled,
      appKey: sso.dingtalk.appKey,
      corpId: sso.dingtalk.corpId,
      appSecretSet: Boolean(sso.dingtalk.appSecret),
      redirectUri: sso.dingtalk.redirectUri
    },
    ad: {
      enabled: sso.ad.enabled,
      ldapUrl: sso.ad.ldapUrl,
      baseDn: sso.ad.baseDn,
      bindDn: sso.ad.bindDn,
      bindPasswordSet: Boolean(sso.ad.bindPassword),
      userFilter: sso.ad.userFilter,
      domain: sso.ad.domain
    },
    providers: listEnabledSsoProviders(sso)
  }
}

export type UserSsoBinding = {
  ssoProvider: SsoProviderId | 'none'
  ssoExternalId: string
}

export function normalizeUserSsoBinding(raw: {
  ssoProvider?: unknown
  ssoExternalId?: unknown
}): UserSsoBinding {
  const p = raw.ssoProvider
  const provider: SsoProviderId | 'none' =
    p === 'wecom' || p === 'dingtalk' || p === 'ad' ? p : 'none'
  const id = typeof raw.ssoExternalId === 'string' ? raw.ssoExternalId.trim() : ''
  if (provider === 'none') return { ssoProvider: 'none', ssoExternalId: '' }
  return { ssoProvider: provider, ssoExternalId: id }
}
