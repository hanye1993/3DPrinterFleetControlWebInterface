/**
 * Multi-channel exception notifier:
 * PushPlus / Server酱 / SMS (主流国内短信商) / 企微 / 钉钉 / Webhook
 */
import { createHmac, createHash } from 'crypto'
import type { SsoSettingsBundle } from '../../shared/sso'
import { isWecomConfigured } from '../../shared/sso'
import {
  type AlertEventKind,
  type AlertNotifyPayload,
  type AlertNotifySettings,
  type SmsProviderId,
  normalizeAlertNotifySettings,
  parsePhoneList,
  ALERT_EVENT_LABELS
} from '../../shared/alertNotify'
import { getWecomAccessToken } from '../auth/ssoProviders'

export type AlertNotifyChannelResult = {
  channel: string
  ok: boolean
  message?: string
}

export type AlertNotifyDispatchResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  results: AlertNotifyChannelResult[]
}

type GetSettings = () => {
  alertNotify?: unknown
  notifyOnError?: boolean
  notifyOnPrintDone?: boolean
  notifyOnIdle?: boolean
  notifyOnLowFilament?: boolean
  sso?: SsoSettingsBundle
  apiKey?: string
}

const cooldownUntil = new Map<string, number>()

function cfgOf(getSettings: GetSettings): AlertNotifySettings {
  return normalizeAlertNotifySettings(getSettings().alertNotify)
}

function eventAllowed(getSettings: GetSettings, kind: AlertEventKind): boolean {
  const s = getSettings()
  const cfg = cfgOf(getSettings)
  if (!cfg.enabled) return false
  if (!cfg.events[kind]) return false
  // Align with legacy desktop notify toggles when present
  if (kind === 'printerError' && s.notifyOnError === false) return false
  if (kind === 'printDone' && s.notifyOnPrintDone === false) return false
  if (kind === 'printerIdle' && s.notifyOnIdle === false) return false
  if (kind === 'lowFilament' && s.notifyOnLowFilament === false) return false
  return true
}

function applyCooldown(cfg: AlertNotifySettings, payload: AlertNotifyPayload): boolean {
  const key = `${payload.kind}:${payload.deviceId || '_'}:${payload.title}`
  const until = cooldownUntil.get(key) || 0
  const now = Date.now()
  if (now < until) return false
  cooldownUntil.set(key, now + cfg.cooldownSec * 1000)
  return true
}

async function postJson(
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000)
  })
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, text: text.slice(0, 500) }
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : ''
  )
}

/** —— PushPlus —— */
async function sendPushPlus(
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.pushplusEnabled || !cfg.pushplusToken) {
    return { channel: 'pushplus', ok: false, message: '未启用或未填 Token' }
  }
  try {
    const body: Record<string, unknown> = {
      token: cfg.pushplusToken,
      title: payload.title,
      content: payload.content,
      template: 'html'
    }
    if (cfg.pushplusTopic) body.topic = cfg.pushplusTopic
    const r = await postJson('https://www.pushplus.plus/send', body)
    let ok = r.ok
    let message = r.text
    try {
      const j = JSON.parse(r.text) as { code?: number; msg?: string }
      ok = Number(j.code) === 200
      message = j.msg || r.text
    } catch {
      /* plain */
    }
    return { channel: 'pushplus', ok, message }
  } catch (e) {
    return { channel: 'pushplus', ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** —— Server酱 SCT / SC3 —— */
function serverchanUrl(sendKey: string): string {
  const key = sendKey.trim()
  if (/^sctp\d+t/i.test(key)) {
    const match = key.match(/^sctp(\d+)t/i)
    const num = match?.[1] || ''
    return `https://${num}.push.ft07.com/send/${encodeURIComponent(key)}.send`
  }
  return `https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`
}

async function sendServerChan(
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.serverchanEnabled || !cfg.serverchanSendKey) {
    return { channel: 'serverchan', ok: false, message: '未启用或未填 SendKey' }
  }
  try {
    const url = serverchanUrl(cfg.serverchanSendKey)
    const r = await postJson(url, { title: payload.title, desp: payload.content })
    let ok = r.ok
    let message = r.text
    try {
      const j = JSON.parse(r.text) as { code?: number; data?: { errno?: number }; message?: string }
      ok = Number(j.code) === 0 || Number(j.data?.errno) === 0
      message = j.message || r.text
    } catch {
      /* plain */
    }
    return { channel: 'serverchan', ok, message }
  } catch (e) {
    return { channel: 'serverchan', ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** —— DingTalk robot —— */
async function sendDingtalk(
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.dingtalkNotifyEnabled || !cfg.dingtalkWebhook) {
    return { channel: 'dingtalk', ok: false, message: '未启用或未填 Webhook' }
  }
  try {
    let url = cfg.dingtalkWebhook
    if (cfg.dingtalkSecret) {
      const ts = String(Date.now())
      const sign = encodeURIComponent(
        createHmac('sha256', cfg.dingtalkSecret).update(`${ts}\n${cfg.dingtalkSecret}`).digest('base64')
      )
      url += (url.includes('?') ? '&' : '?') + `timestamp=${ts}&sign=${sign}`
    }
    const text = `${payload.title}\n\n${payload.content}`
    const r = await postJson(url, {
      msgtype: 'text',
      text: { content: text }
    })
    let ok = r.ok
    let message = r.text
    try {
      const j = JSON.parse(r.text) as { errcode?: number; errmsg?: string }
      ok = Number(j.errcode) === 0
      message = j.errmsg || r.text
    } catch {
      /* plain */
    }
    return { channel: 'dingtalk', ok, message }
  } catch (e) {
    return { channel: 'dingtalk', ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** —— WeCom app message (reuse SSO corp credentials) —— */
async function sendWecom(
  getSettings: GetSettings,
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.wecomNotifyEnabled) {
    return { channel: 'wecom', ok: false, message: '未启用企微通知' }
  }
  const sso = getSettings().sso
  const wecom = sso?.wecom
  if (!wecom || !isWecomConfigured(wecom) || !wecom.agentId) {
    return { channel: 'wecom', ok: false, message: '请先在「企业软件对接」配置企微 CorpId / AgentId / Secret' }
  }
  try {
    const token = await getWecomAccessToken(wecom)
    const touser = (cfg.wecomNotifyTouser || '@all').replace(/,/g, '|')
    const r = await postJson(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
      {
        touser,
        msgtype: 'text',
        agentid: Number(wecom.agentId) || wecom.agentId,
        text: { content: `${payload.title}\n${payload.content}` },
        safe: 0
      }
    )
    let ok = r.ok
    let message = r.text
    try {
      const j = JSON.parse(r.text) as { errcode?: number; errmsg?: string }
      ok = Number(j.errcode) === 0
      message = j.errmsg || r.text
    } catch {
      /* plain */
    }
    return { channel: 'wecom', ok, message }
  } catch (e) {
    return { channel: 'wecom', ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** —— Custom / legacy status webhook style —— */
async function sendWebhook(
  getSettings: GetSettings,
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.webhookNotifyEnabled || !cfg.webhookNotifyUrl) {
    return { channel: 'webhook', ok: false, message: '未启用或未填 URL' }
  }
  try {
    const r = await postJson(
      cfg.webhookNotifyUrl,
      {
        type: 'alert',
        kind: payload.kind,
        title: payload.title,
        content: payload.content,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        at: payload.at || new Date().toISOString(),
        extra: payload.extra || {},
        label: ALERT_EVENT_LABELS[payload.kind]
      },
      {
        'X-Api-Key': getSettings().apiKey || '',
        'User-Agent': 'printer-monitor-alert'
      }
    )
    return { channel: 'webhook', ok: r.ok, message: r.text || `HTTP ${r.status}` }
  } catch (e) {
    return { channel: 'webhook', ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** —— SMS helpers —— */
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

async function sendAliyunSms(
  cfg: AlertNotifySettings,
  phone: string,
  content: string
): Promise<void> {
  if (!cfg.smsAccessKeyId || !cfg.smsAccessKeySecret || !cfg.smsSignName || !cfg.smsTemplateCode) {
    throw new Error('阿里云短信需 AccessKey / 签名 / 模板 Code')
  }
  const params: Record<string, string> = {
    AccessKeyId: cfg.smsAccessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: cfg.smsRegion || 'cn-hangzhou',
    SignName: cfg.smsSignName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: `${Date.now()}${Math.random().toString(16).slice(2)}`,
    SignatureVersion: '1.0',
    TemplateCode: cfg.smsTemplateCode,
    TemplateParam: JSON.stringify({ content: content.slice(0, 100), code: content.slice(0, 20) }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25'
  }
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(sorted)}`
  const sign = createHmac('sha1', `${cfg.smsAccessKeySecret}&`)
    .update(stringToSign)
    .digest('base64')
  const url = `https://dysmsapi.aliyuncs.com/?${sorted}&Signature=${percentEncode(sign)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const data = (await res.json()) as { Code?: string; Message?: string }
  if (data.Code !== 'OK') throw new Error(data.Message || data.Code || '阿里云发送失败')
}

async function sendTencentSms(
  cfg: AlertNotifySettings,
  phone: string,
  content: string
): Promise<void> {
  if (!cfg.smsAccessKeyId || !cfg.smsAccessKeySecret || !cfg.smsSdkAppId || !cfg.smsSignName || !cfg.smsTemplateCode) {
    throw new Error('腾讯云短信需 SecretId/SecretKey / SdkAppId / 签名 / 模板')
  }
  const host = 'sms.tencentcloudapi.com'
  const service = 'sms'
  const action = 'SendSms'
  const version = '2021-01-11'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: cfg.smsSdkAppId,
    SignName: cfg.smsSignName,
    TemplateId: cfg.smsTemplateCode,
    TemplateParamSet: [content.slice(0, 40)]
  })
  const hashedRequestPayload = createHash('sha256').update(payload).digest('hex')
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
    'content-type;host;x-tc-action',
    hashedRequestPayload
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n')
  const secretDate = createHmac('sha256', `TC3${cfg.smsAccessKeySecret}`).update(date).digest()
  const secretService = createHmac('sha256', secretDate).update(service).digest()
  const secretSigning = createHmac('sha256', secretService).update('tc3_request').digest()
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${cfg.smsAccessKeyId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`
  const res = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      Authorization: authorization
    },
    body: payload,
    signal: AbortSignal.timeout(12_000)
  })
  const data = (await res.json()) as {
    Response?: { Error?: { Message?: string }; SendStatusSet?: Array<{ Code?: string }> }
  }
  const err = data.Response?.Error?.Message
  if (err) throw new Error(err)
  const code = data.Response?.SendStatusSet?.[0]?.Code
  if (code && code !== 'Ok') throw new Error(code)
}

async function sendHuaweiSms(
  cfg: AlertNotifySettings,
  phone: string,
  content: string
): Promise<void> {
  if (!cfg.smsAppKey || !cfg.smsAppSecret || !cfg.smsChannel || !cfg.smsSignName || !cfg.smsTemplateCode) {
    throw new Error('华为云短信需 AppKey/AppSecret / 通道号 / 签名 / 模板')
  }
  const wsse = (() => {
    const nonce = createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 32)
    const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const passwordDigest = createHash('sha256')
      .update(nonce + created + cfg.smsAppSecret)
      .digest('base64')
    return `UsernameToken Username="${cfg.smsAppKey}",PasswordDigest="${passwordDigest}",Nonce="${nonce}",Created="${created}"`
  })()
  const endpoint = (cfg.smsEndpoint || 'https://smsapi.cn-north-4.myhuaweicloud.com:443').replace(/\/$/, '')
  const body = new URLSearchParams({
    from: cfg.smsChannel,
    to: `+86${phone}`,
    templateId: cfg.smsTemplateCode,
    templateParas: JSON.stringify([content.slice(0, 40)]),
    signature: cfg.smsSignName
  })
  const res = await fetch(`${endpoint}/sms/batchSendSms/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'WSSE realm="SDP",profile="UsernameToken",type="Appkey"',
      'X-WSSE': wsse
    },
    body,
    signal: AbortSignal.timeout(12_000)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`)
}

async function sendSimpleProviderSms(
  provider: SmsProviderId,
  cfg: AlertNotifySettings,
  phone: string,
  content: string
): Promise<void> {
  const key = cfg.smsApiKey
  const user = cfg.smsApiUser
  if (provider === 'smsbao') {
    if (!user || !key) throw new Error('短信宝需账号与 API 密钥（密码 MD5）')
    const url = `https://api.smsbao.com/sms?u=${encodeURIComponent(user)}&p=${encodeURIComponent(key)}&m=${encodeURIComponent(phone)}&c=${encodeURIComponent(content)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    const text = (await res.text()).trim()
    if (text !== '0') throw new Error(`短信宝错误码 ${text}`)
    return
  }
  if (provider === 'yunpian') {
    if (!key) throw new Error('云片需 ApiKey')
    const body = new URLSearchParams({
      apikey: key,
      mobile: phone,
      text: cfg.smsSignName ? `【${cfg.smsSignName}】${content}` : content
    })
    const res = await fetch('https://sms.yunpian.com/v2/sms/single_send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(12_000)
    })
    const data = (await res.json()) as { code?: number; msg?: string }
    if (Number(data.code) !== 0) throw new Error(data.msg || '云片发送失败')
    return
  }
  if (provider === 'chuanglan') {
    if (!cfg.smsApiUrl || !user || !key) throw new Error('创蓝需账号、密码与 API URL')
    const r = await postJson(cfg.smsApiUrl, {
      account: user,
      password: key,
      phone,
      msg: cfg.smsSignName ? `【${cfg.smsSignName}】${content}` : content,
      report: 'true'
    })
    let code = ''
    try {
      code = String((JSON.parse(r.text) as { code?: string }).code || '')
    } catch {
      code = r.text
    }
    if (code !== '0') throw new Error(r.text.slice(0, 200) || '创蓝发送失败')
    return
  }
  if (provider === 'ihuyi') {
    if (!user || !key) throw new Error('互亿无线需账号与密码')
    const body = new URLSearchParams({
      account: user,
      password: key,
      mobile: phone,
      content: cfg.smsSignName ? `您的验证码是：${content.slice(0, 6)}。请不要把验证码泄露给其他人。` : content
    })
    // ihuyi templates are strict; send as general content API if configured
    const url = cfg.smsApiUrl || 'https://106.ihuyi.com/webservice/sms.php?method=Submit'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(12_000)
    })
    const text = await res.text()
    if (!/code>2</.test(text) && !/code>0</.test(text) && !text.includes('<code>2</code>')) {
      // success code is 2 for ihuyi
      if (!text.includes('<code>2</code>')) throw new Error(text.slice(0, 200) || '互亿发送失败')
    }
    return
  }
  if (provider === 'juhe') {
    if (!key || !cfg.smsTemplateCode) throw new Error('聚合数据需 Key 与模板 ID')
    const url =
      `http://v.juhe.cn/sms/send?mobile=${encodeURIComponent(phone)}` +
      `&tpl_id=${encodeURIComponent(cfg.smsTemplateCode)}` +
      `&tpl_value=${encodeURIComponent(`#content#=${content.slice(0, 40)}`)}` +
      `&key=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    const data = (await res.json()) as { error_code?: number; reason?: string }
    if (Number(data.error_code) !== 0) throw new Error(data.reason || '聚合发送失败')
    return
  }
  if (provider === 'submail') {
    if (!user || !key) throw new Error('SUBMAIL 需 appid 与 appkey')
    const r = await postJson('https://api-v4.mysubmail.com/sms/send.json', {
      appid: user,
      to: phone,
      content: cfg.smsSignName ? `【${cfg.smsSignName}】${content}` : content,
      signature: key
    })
    let status = ''
    try {
      status = String((JSON.parse(r.text) as { status?: string }).status || '')
    } catch {
      status = ''
    }
    if (status !== 'success') throw new Error(r.text.slice(0, 200) || 'SUBMAIL 发送失败')
    return
  }
  // custom
  if (!cfg.smsApiUrl) throw new Error('自定义短信需填写 API URL')
  const vars: Record<string, string> = {
    phone,
    content,
    title: content.slice(0, 20),
    sign: cfg.smsSignName,
    key,
    secret: cfg.smsAccessKeySecret || cfg.smsAppSecret || '',
    user,
    tpl: cfg.smsTemplateCode
  }
  const method = cfg.smsApiMethod === 'GET' ? 'GET' : 'POST'
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.smsApiHeaders.trim()) {
    try {
      headers = { ...headers, ...(JSON.parse(cfg.smsApiHeaders) as Record<string, string>) }
    } catch {
      throw new Error('smsApiHeaders 须为 JSON 对象')
    }
  }
  const tpl = cfg.smsApiBodyTemplate || '{"mobile":"{{phone}}","content":"{{content}}"}'
  const filled = fillTemplate(tpl, vars)
  if (method === 'GET') {
    const url = cfg.smsApiUrl.includes('{{')
      ? fillTemplate(cfg.smsApiUrl, vars)
      : `${cfg.smsApiUrl}${cfg.smsApiUrl.includes('?') ? '&' : '?'}${filled.startsWith('{') ? `body=${encodeURIComponent(filled)}` : fillTemplate(filled, vars)}`
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`)
    return
  }
  const isJson = filled.trim().startsWith('{') || filled.trim().startsWith('[')
  const res = await fetch(cfg.smsApiUrl, {
    method: 'POST',
    headers: isJson ? headers : { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: filled,
    signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`)
}

async function sendSmsAll(
  cfg: AlertNotifySettings,
  payload: AlertNotifyPayload
): Promise<AlertNotifyChannelResult> {
  if (!cfg.smsEnabled) return { channel: 'sms', ok: false, message: '未启用短信' }
  const phones = parsePhoneList(cfg.smsPhones)
  if (!phones.length) return { channel: 'sms', ok: false, message: '未配置有效手机号' }
  const content = `${payload.title} ${payload.content}`.slice(0, 200)
  const errors: string[] = []
  for (const phone of phones) {
    try {
      if (cfg.smsProvider === 'aliyun') await sendAliyunSms(cfg, phone, content)
      else if (cfg.smsProvider === 'tencent') await sendTencentSms(cfg, phone, content)
      else if (cfg.smsProvider === 'huawei') await sendHuaweiSms(cfg, phone, content)
      else await sendSimpleProviderSms(cfg.smsProvider, cfg, phone, content)
    } catch (e) {
      errors.push(`${phone}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (errors.length === phones.length) {
    return { channel: 'sms', ok: false, message: errors.join('; ') }
  }
  return {
    channel: 'sms',
    ok: errors.length === 0,
    message: errors.length ? `部分失败: ${errors.join('; ')}` : `已发送 ${phones.length} 个号码`
  }
}

export async function dispatchAlertNotify(
  getSettings: GetSettings,
  payload: AlertNotifyPayload,
  opts?: {
    bypassCooldown?: boolean
    bypassEventGate?: boolean
    channels?: string[]
    /** Loose host so PluginManager is assignable without ctx contravariance issues */
    getPluginManager?: () => { runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown> } | null
  }
): Promise<AlertNotifyDispatchResult> {
  let event = payload
  try {
    const pm = opts?.getPluginManager?.()
    if (pm) {
      const hooked = (await pm.runHook('alert_notify', {
        proceed: true,
        payload: event
      })) as {
        proceed?: boolean
        skipped?: boolean
        reason?: string
        payload?: AlertNotifyPayload
      }
      if (hooked && hooked.proceed === false) {
        return {
          ok: true,
          skipped: true,
          reason: hooked.reason || '插件拦截',
          results: []
        }
      }
      if (hooked?.payload) event = hooked.payload
    }
  } catch {
    /* ignore */
  }

  const cfg = cfgOf(getSettings)
  if (!opts?.bypassEventGate && !eventAllowed(getSettings, event.kind)) {
    return { ok: true, skipped: true, reason: '事件未启用或总开关关闭', results: [] }
  }
  if (!opts?.bypassCooldown && !applyCooldown(cfg, event)) {
    return { ok: true, skipped: true, reason: '冷却中', results: [] }
  }

  const want = (name: string) => !opts?.channels?.length || opts.channels.includes(name)
  const tasks: Array<Promise<AlertNotifyChannelResult>> = []
  if (want('pushplus') && cfg.pushplusEnabled) tasks.push(sendPushPlus(cfg, event))
  if (want('serverchan') && cfg.serverchanEnabled) tasks.push(sendServerChan(cfg, event))
  if (want('sms') && cfg.smsEnabled) tasks.push(sendSmsAll(cfg, event))
  if (want('wecom') && cfg.wecomNotifyEnabled) tasks.push(sendWecom(getSettings, cfg, event))
  if (want('dingtalk') && cfg.dingtalkNotifyEnabled) tasks.push(sendDingtalk(cfg, event))
  if (want('webhook') && cfg.webhookNotifyEnabled) tasks.push(sendWebhook(getSettings, cfg, event))

  if (!tasks.length) {
    return { ok: false, reason: '没有已启用的通知渠道', results: [] }
  }
  const results = await Promise.all(tasks)
  const out = { ok: results.some((r) => r.ok), results }
  try {
    const pm = opts?.getPluginManager?.() as
      | { emitDomainEvent?: (name: string, payload?: unknown) => Promise<void> }
      | null
      | undefined
    if (pm?.emitDomainEvent) {
      void pm.emitDomainEvent('action:alert.fired', {
        event,
        results,
        ok: out.ok
      })
    }
  } catch {
    /* ignore */
  }
  return out
}

/** Detect printer status transitions and fan out notifications */
export function detectStatusAlertEvents(
  prev: Map<string, { health?: string; state?: string }>,
  statuses: Record<string, unknown>,
  deviceNames?: Map<string, string>
): AlertNotifyPayload[] {
  const out: AlertNotifyPayload[] = []
  for (const [deviceId, raw] of Object.entries(statuses)) {
    if (!raw || typeof raw !== 'object') continue
    const st = raw as { health?: string; state?: string; deviceName?: string; name?: string }
    const health = String(st.health || '')
    const state = String(st.state || '').toLowerCase()
    const before = prev.get(deviceId)
    prev.set(deviceId, { health, state })
    if (!before) continue
    const name =
      deviceNames?.get(deviceId) ||
      st.deviceName ||
      st.name ||
      deviceId
    const at = new Date().toISOString()

    if (before.health !== 'error' && health === 'error') {
      out.push({
        kind: 'printerError',
        title: `打印机异常：${name}`,
        content: `设备 ${name} 健康状态变为错误（state=${state || '-'}）`,
        deviceId,
        deviceName: name,
        at
      })
    }
    const wasPrinting = /print|run|busy|pause/.test(before.state || '')
    const nowIdle = /idle|standby|ready|complete|finish|success|done/.test(state) || state === 'idle'
    const nowDone = /complete|finish|success|done/.test(state)
    if (wasPrinting && nowDone) {
      out.push({
        kind: 'printDone',
        title: `打印完成：${name}`,
        content: `设备 ${name} 打印任务已结束`,
        deviceId,
        deviceName: name,
        at
      })
    } else if (wasPrinting && nowIdle && before.state !== state) {
      out.push({
        kind: 'printerIdle',
        title: `打印机空闲：${name}`,
        content: `设备 ${name} 已回到空闲`,
        deviceId,
        deviceName: name,
        at
      })
    } else if (!wasPrinting && nowIdle && before.state && before.state !== state && /print|run|busy/.test(before.state)) {
      out.push({
        kind: 'printerIdle',
        title: `打印机空闲：${name}`,
        content: `设备 ${name} 已回到空闲`,
        deviceId,
        deviceName: name,
        at
      })
    }
  }
  return out
}

export function buildAiVisionAlertPayload(alert: {
  deviceId: string
  deviceName: string
  label: string
  kind: string
  confidence: number
  action?: string
  at: string
}): AlertNotifyPayload {
  return {
    kind: 'aiVision',
    title: `AI 监控异常：${alert.deviceName}`,
    content: `检测到「${alert.label}」（置信度 ${(alert.confidence * 100).toFixed(0)}%）${
      alert.action ? `，已执行动作：${alert.action}` : ''
    }`,
    deviceId: alert.deviceId,
    deviceName: alert.deviceName,
    at: alert.at,
    extra: { faultKind: alert.kind, confidence: alert.confidence, action: alert.action }
  }
}
