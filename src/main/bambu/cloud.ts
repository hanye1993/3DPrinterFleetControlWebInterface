import axios, { type AxiosInstance } from 'axios'

export type BambuRegion = 'china' | 'global'

export type BambuCloudDevice = {
  dev_id: string
  name: string
  online: boolean
  print_status?: string
  dev_model_name?: string
  dev_product_name?: string
  dev_access_code?: string
}

export function bambuApiBase(region: BambuRegion): string {
  return region === 'china' ? 'https://api.bambulab.cn' : 'https://api.bambulab.com'
}

export function bambuMqttHost(region: BambuRegion): string {
  return region === 'china' ? 'cn.mqtt.bambulab.com' : 'us.mqtt.bambulab.com'
}

/** phone number (digits, optional +86) vs email */
export function isPhoneAccount(account: string): boolean {
  const a = account.trim()
  if (a.includes('@')) return false
  const digits = a.replace(/^\+?86/, '').replace(/\D/g, '')
  return /^1\d{10}$/.test(digits) || (/^\d{6,15}$/.test(digits) && !a.includes('@'))
}

export function normalizeAccount(account: string): string {
  const a = account.trim()
  if (!isPhoneAccount(a)) return a
  // keep as user entered digits; strip spaces/dashes
  return a.replace(/[\s-]/g, '')
}

function client(region: BambuRegion, token?: string): AxiosInstance {
  return axios.create({
    baseURL: bambuApiBase(region),
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'bambu_network_agent/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

export type LoginResult =
  | { ok: true; accessToken: string }
  | { ok: false; needCode: true; message: string; via: 'sms' | 'email' }
  | { ok: false; needCode: false; message: string }

/** Send SMS or email verification code for codeLogin */
export async function bambuSendVerifyCode(
  region: BambuRegion,
  account: string
): Promise<{ ok: boolean; message: string; via: 'sms' | 'email' }> {
  const acc = normalizeAccount(account)
  const phone = isPhoneAccount(acc)
  try {
    if (phone) {
      await client(region).post('/v1/user-service/user/sendsmscode', {
        phone: acc,
        type: 'codeLogin'
      })
      return { ok: true, message: '短信验证码已发送，请查收手机', via: 'sms' }
    }
    await client(region).post('/v1/user-service/user/sendemail/code', {
      email: acc,
      type: 'codeLogin'
    })
    return { ok: true, message: '邮箱验证码已发送，请查收邮件', via: 'email' }
  } catch (err) {
    return {
      ok: false,
      message: axiosError(err),
      via: phone ? 'sms' : 'email'
    }
  }
}

/** Password login. May require SMS/email verification code next. */
export async function bambuLogin(
  region: BambuRegion,
  account: string,
  password: string
): Promise<LoginResult> {
  const acc = normalizeAccount(account)
  try {
    const { data } = await client(region).post('/v1/user-service/user/login', {
      account: acc,
      password,
      apiError: ''
    })

    if (data?.accessToken) {
      return { ok: true, accessToken: String(data.accessToken) }
    }

    const loginType = String(data?.loginType || '')
    if (loginType === 'verifyCode') {
      const sent = await bambuSendVerifyCode(region, acc)
      const via = sent.via
      return {
        ok: false,
        needCode: true,
        via,
        message: sent.ok
          ? sent.message
          : `需要验证码，但发送失败: ${sent.message}`
      }
    }

    if (loginType === 'tfa') {
      return {
        ok: false,
        needCode: false,
        message: '该账号启用了二次验证（TFA），暂请改用局域网模式或关闭 TFA'
      }
    }

    return {
      ok: false,
      needCode: false,
      message: data?.message || data?.error || '登录失败'
    }
  } catch (err) {
    return { ok: false, needCode: false, message: axiosError(err) }
  }
}

/** Login with SMS/email verification code (no password). */
export async function bambuLoginWithCode(
  region: BambuRegion,
  account: string,
  code: string
): Promise<LoginResult> {
  const acc = normalizeAccount(account)
  try {
    const { data } = await client(region).post('/v1/user-service/user/login', {
      account: acc,
      code: code.trim()
    })
    if (data?.accessToken) {
      return { ok: true, accessToken: String(data.accessToken) }
    }
    return {
      ok: false,
      needCode: false,
      message: data?.message || data?.error || '验证码登录失败'
    }
  } catch (err) {
    return { ok: false, needCode: false, message: axiosError(err) }
  }
}

export async function bambuGetUserId(
  region: BambuRegion,
  token: string
): Promise<{ ok: boolean; uid?: string; message?: string }> {
  try {
    const { data } = await client(region, token).get('/v1/design-user-service/my/preference')
    const uid = data?.uid ?? data?.user_id ?? data?.userId
    if (uid == null) return { ok: false, message: '无法获取用户 ID' }
    return { ok: true, uid: String(uid) }
  } catch (err) {
    return { ok: false, message: axiosError(err) }
  }
}

export async function bambuListDevices(
  region: BambuRegion,
  token: string
): Promise<{ ok: boolean; devices: BambuCloudDevice[]; message?: string }> {
  try {
    const { data } = await client(region, token).get('/v1/iot-service/api/user/bind')
    const devices = (data?.devices || []) as BambuCloudDevice[]
    return {
      ok: true,
      devices: devices.map((d) => ({
        ...d,
        dev_access_code: d.dev_access_code?.replace(/\s+/g, '') || d.dev_access_code
      }))
    }
  } catch (err) {
    return { ok: false, devices: [], message: axiosError(err) }
  }
}

function axiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg =
      (err.response?.data as { message?: string; error?: string } | undefined)?.message ||
      (err.response?.data as { error?: string } | undefined)?.error ||
      err.message
    return msg || '网络错误'
  }
  return err instanceof Error ? err.message : String(err)
}
