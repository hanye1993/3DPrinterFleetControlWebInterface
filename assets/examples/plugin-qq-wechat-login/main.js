/**
 * qq_wechat_login — QQ 互联 + 微信开放平台网站应用登录
 *
 * 绑定数据存插件私有 JSON（宿主 PluginApi 无 updateUser）。
 * OAuth 回调用 __pluginHttp 返回 302 / HTML。
 */
const crypto = require('crypto')

const STORE_FILE = 'bindings.json'
const STATE_FILE = 'oauth_states.json'

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function loginMode(api) {
  const m = String(api.getVar('login_mode', 'all') || 'all')
    .trim()
    .toLowerCase()
  if (m === 'oauth_only' || m === 'oauth' || m === 'qqwx') return 'oauth_only'
  if (m === 'password_only' || m === 'password') return 'password_only'
  return 'all'
}

function httpJson(status, json) {
  return { __pluginHttp: { status: status || 200, json } }
}

function httpRedirect(url) {
  return {
    __pluginHttp: {
      status: 302,
      headers: { Location: String(url) },
      body: ''
    }
  }
}

function httpHtml(status, html) {
  return {
    __pluginHttp: {
      status: status || 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: String(html)
    }
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function loadStore(api) {
  const raw = api.readJson(STORE_FILE, null)
  if (raw && typeof raw === 'object') {
    return {
      byUser: raw.byUser && typeof raw.byUser === 'object' ? raw.byUser : {},
      byKey: raw.byKey && typeof raw.byKey === 'object' ? raw.byKey : {}
    }
  }
  return { byUser: {}, byKey: {} }
}

function saveStore(api, store) {
  api.writeJson(STORE_FILE, {
    byUser: store.byUser || {},
    byKey: store.byKey || {},
    updatedAt: new Date().toISOString()
  })
}

function loadStates(api) {
  const raw = api.readJson(STATE_FILE, null)
  return raw && typeof raw === 'object' ? raw : {}
}

function saveStates(api, states) {
  api.writeJson(STATE_FILE, states)
}

function pruneStates(states) {
  const now = Date.now()
  const next = {}
  for (const [k, v] of Object.entries(states || {})) {
    if (v && v.expiresAt && Number(v.expiresAt) > now) next[k] = v
  }
  return next
}

function bindKey(provider, openid) {
  return provider + ':' + String(openid || '').trim()
}

function userBindings(store, userId) {
  const row = store.byUser[userId]
  return row && typeof row === 'object' ? row : {}
}

function hasAnyBind(store, userId) {
  const b = userBindings(store, userId)
  return Boolean((b.qq && b.qq.openid) || (b.wechat && b.wechat.openid))
}

function setBinding(api, userId, provider, profile) {
  const store = loadStore(api)
  const openid = String(profile.openid || '').trim()
  if (!openid) throw new Error('缺少 openid')
  const key = bindKey(provider, openid)
  const existingUser = store.byKey[key]
  if (existingUser && existingUser !== userId) {
    throw new Error('该 ' + (provider === 'qq' ? 'QQ' : '微信') + ' 已绑定其他账号')
  }
  const prev = userBindings(store, userId)
  const old = prev[provider]
  if (old && old.openid && old.openid !== openid) {
    delete store.byKey[bindKey(provider, old.openid)]
  }
  const info = {
    openid,
    unionid: profile.unionid ? String(profile.unionid) : undefined,
    nickname: profile.nickname ? String(profile.nickname) : '',
    avatar: profile.avatar ? String(profile.avatar) : '',
    gender: profile.gender != null ? String(profile.gender) : undefined,
    boundAt: new Date().toISOString()
  }
  store.byUser[userId] = Object.assign({}, prev, { [provider]: info })
  store.byKey[key] = userId
  saveStore(api, store)
  return info
}

function clearBinding(api, userId, provider) {
  const store = loadStore(api)
  const prev = userBindings(store, userId)
  const old = prev[provider]
  if (!old || !old.openid) return false
  delete store.byKey[bindKey(provider, old.openid)]
  const next = Object.assign({}, prev)
  delete next[provider]
  if (!Object.keys(next).length) delete store.byUser[userId]
  else store.byUser[userId] = next
  saveStore(api, store)
  return true
}

function publicConfig(api, req) {
  const origin = requestOrigin(req)
  const qqRedirect =
    String(api.getVar('qq_redirect_uri', '') || '').trim() ||
    origin + '/api/v1/qq-wx/callback/qq'
  const wxRedirect =
    String(api.getVar('wx_redirect_uri', '') || '').trim() ||
    origin + '/api/v1/qq-wx/callback/wechat'
  return {
    loginMode: loginMode(api),
    forceBind: boolVar(api, 'force_bind', false),
    autoCreate: boolVar(api, 'auto_create', true),
    qqEnabled: boolVar(api, 'qq_enabled', true) && Boolean(String(api.getVar('qq_app_id', '') || '').trim()),
    wxEnabled: boolVar(api, 'wx_enabled', true) && Boolean(String(api.getVar('wx_app_id', '') || '').trim()),
    qqConfigured: Boolean(String(api.getVar('qq_app_id', '') || '').trim() && String(api.getVar('qq_app_key', '') || '').trim()),
    wxConfigured: Boolean(
      String(api.getVar('wx_app_id', '') || '').trim() && String(api.getVar('wx_app_secret', '') || '').trim()
    ),
    qqRedirectUri: qqRedirect,
    wxRedirectUri: wxRedirect
  }
}

function requestOrigin(req) {
  const headers = (req && req.headers) || {}
  const xfProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const xfHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = xfHost || String(headers.host || '').trim()
  if (host) {
    const proto = xfProto || (String(headers['x-forwarded-ssl'] || '') === 'on' ? 'https' : 'http')
    return proto + '://' + host
  }
  try {
    if (req && req.url && req.url.origin) return req.url.origin
  } catch (_) {}
  return 'http://127.0.0.1:17890'
}

function createOAuthState(api, payload) {
  const states = pruneStates(loadStates(api))
  const state = crypto.randomBytes(16).toString('hex')
  states[state] = Object.assign({}, payload, {
    expiresAt: Date.now() + 10 * 60 * 1000
  })
  saveStates(api, states)
  return state
}

function takeOAuthState(api, state) {
  const states = pruneStates(loadStates(api))
  const row = states[state]
  if (!row) return null
  delete states[state]
  saveStates(api, states)
  return row
}

async function fetchText(url) {
  const res = await fetch(url)
  return res.text()
}

async function fetchJson(url) {
  const res = await fetch(url)
  return res.json()
}

function parseQqCallbackJson(text) {
  const s = String(text || '').trim()
  const m = s.match(/callback\(\s*([\s\S]*)\s*\)\s*;?\s*$/)
  if (m) {
    try {
      return JSON.parse(m[1])
    } catch (_) {
      return null
    }
  }
  try {
    return JSON.parse(s)
  } catch (_) {
    return null
  }
}

function parseFormBody(text) {
  const out = {}
  String(text || '')
    .split('&')
    .forEach((pair) => {
      const i = pair.indexOf('=')
      if (i < 0) return
      const k = decodeURIComponent(pair.slice(0, i))
      const v = decodeURIComponent(pair.slice(i + 1) || '')
      out[k] = v
    })
  return out
}

async function exchangeQq(api, code, redirectUri) {
  const appId = String(api.getVar('qq_app_id', '') || '').trim()
  const appKey = String(api.getVar('qq_app_key', '') || '').trim()
  if (!appId || !appKey) throw new Error('未配置 QQ AppID / AppKey')
  const tokenUrl =
    'https://graph.qq.com/oauth2.0/token?grant_type=authorization_code' +
    '&client_id=' +
    encodeURIComponent(appId) +
    '&client_secret=' +
    encodeURIComponent(appKey) +
    '&code=' +
    encodeURIComponent(code) +
    '&redirect_uri=' +
    encodeURIComponent(redirectUri) +
    '&fmt=json'
  const tokenJson = await fetchJson(tokenUrl)
  if (!tokenJson || tokenJson.error || !tokenJson.access_token) {
    throw new Error(
      (tokenJson && (tokenJson.error_description || tokenJson.error)) || 'QQ 换取 access_token 失败'
    )
  }
  const accessToken = String(tokenJson.access_token)
  const meText = await fetchText(
    'https://graph.qq.com/oauth2.0/me?access_token=' + encodeURIComponent(accessToken)
  )
  const me = parseQqCallbackJson(meText)
  const openid = me && me.openid ? String(me.openid) : ''
  if (!openid) throw new Error('QQ 获取 openid 失败')
  let nickname = ''
  let avatar = ''
  let gender = ''
  try {
    const info = await fetchJson(
      'https://graph.qq.com/user/get_user_info?access_token=' +
        encodeURIComponent(accessToken) +
        '&oauth_consumer_key=' +
        encodeURIComponent(appId) +
        '&openid=' +
        encodeURIComponent(openid)
    )
    if (info && Number(info.ret) === 0) {
      nickname = String(info.nickname || '')
      avatar = String(info.figureurl_qq_2 || info.figureurl_qq_1 || info.figureurl_2 || '')
      gender = String(info.gender || '')
    }
  } catch (_) {}
  return { openid, nickname, avatar, gender, provider: 'qq' }
}

async function exchangeWechat(api, code) {
  const appId = String(api.getVar('wx_app_id', '') || '').trim()
  const secret = String(api.getVar('wx_app_secret', '') || '').trim()
  if (!appId || !secret) throw new Error('未配置微信 AppID / AppSecret')
  const tokenUrl =
    'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code'
  const tokenJson = await fetchJson(tokenUrl)
  if (!tokenJson || tokenJson.errcode || !tokenJson.access_token || !tokenJson.openid) {
    throw new Error(
      (tokenJson && (tokenJson.errmsg || String(tokenJson.errcode))) || '微信换取 access_token 失败'
    )
  }
  const accessToken = String(tokenJson.access_token)
  const openid = String(tokenJson.openid)
  const unionid = tokenJson.unionid ? String(tokenJson.unionid) : ''
  let nickname = ''
  let avatar = ''
  let gender = ''
  try {
    const info = await fetchJson(
      'https://api.weixin.qq.com/sns/userinfo?access_token=' +
        encodeURIComponent(accessToken) +
        '&openid=' +
        encodeURIComponent(openid)
    )
    if (info && !info.errcode) {
      nickname = String(info.nickname || '')
      avatar = String(info.headimgurl || '')
      gender = info.sex != null ? String(info.sex) : ''
      if (!unionid && info.unionid) {
        /* keep */
      }
    }
  } catch (_) {}
  return {
    openid,
    unionid: unionid || undefined,
    nickname,
    avatar,
    gender,
    provider: 'wechat'
  }
}

function safeUsername(provider, openid) {
  const prefix = provider === 'qq' ? 'qq_' : 'wx_'
  const id = String(openid || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 24)
    .toLowerCase()
  return prefix + (id || crypto.randomBytes(6).toString('hex'))
}

function defaultLevel(api) {
  const lv = String(api.getVar('default_level', 'viewer') || 'viewer')
    .trim()
    .toLowerCase()
  if (lv === 'admin' || lv === 'operator' || lv === 'viewer') return lv
  return 'viewer'
}

async function resolveUserFromProfile(api, profile) {
  const store = loadStore(api)
  const key = bindKey(profile.provider, profile.openid)
  const userId = store.byKey[key]
  if (userId) {
    const u = api.findUser({ id: userId })
    if (u) {
      // refresh profile snapshot
      try {
        setBinding(api, userId, profile.provider, profile)
      } catch (_) {}
      return u
    }
  }
  if (!boolVar(api, 'auto_create', true)) {
    throw new Error('该账号尚未绑定本站用户，请先用密码登录后绑定，或联系管理员')
  }
  let username = safeUsername(profile.provider, profile.openid)
  let n = 0
  while (api.findUser({ username })) {
    n += 1
    username = safeUsername(profile.provider, profile.openid) + '_' + n
  }
  const displayName =
    (profile.nickname && String(profile.nickname).trim()) ||
    (profile.provider === 'qq' ? 'QQ用户' : '微信用户')
  const user = await api.createUser({
    username,
    displayName,
    level: defaultLevel(api)
  })
  setBinding(api, user.id, profile.provider, profile)
  return user
}

function resultPage(opts) {
  const title = escapeHtml(opts.title || '登录')
  const message = escapeHtml(opts.message || '')
  const grant = opts.grantToken ? String(opts.grantToken) : ''
  const ok = Boolean(opts.ok)
  const close = Boolean(opts.close)
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0b1220;color:#e5e7eb;margin:0}
.card{max-width:420px;padding:28px 24px;border-radius:14px;background:#111827;border:1px solid rgba(255,255,255,.08);text-align:center}
.ok{color:#34d399}.err{color:#f87171}button{margin-top:16px;height:36px;padding:0 16px;border-radius:8px;border:0;background:#1677ff;color:#fff;cursor:pointer}</style></head><body>
<div class="card"><h2 class="${ok ? 'ok' : 'err'}">${title}</h2><p>${message}</p>
${close ? '<button onclick="window.close()">关闭窗口</button>' : '<p style="opacity:.7;font-size:13px">正在进入系统…</p>'}
</div>
<script>
(function(){
  var grant = ${JSON.stringify(grant)};
  var ok = ${ok ? 'true' : 'false'};
  var closeWin = ${close ? 'true' : 'false'};
  function done(){
    try { if (window.opener) window.opener.postMessage({ type: 'qq_wx_oauth', ok: ok, grantToken: grant, message: ${JSON.stringify(opts.message || '')} }, '*'); } catch(e) {}
    if (closeWin) { setTimeout(function(){ try{window.close()}catch(e){} }, 800); return; }
    if (ok && grant) {
      fetch('/api/v1/auth/plugin-login/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantToken: grant })
      }).then(function(r){ return r.json(); }).then(function(data){
        if (!data || !data.ok || !data.token) throw new Error((data && data.message) || '换票失败');
        try { localStorage.setItem('hanye_client_jwt', data.token); } catch(e) {}
        location.replace('/');
      }).catch(function(e){
        document.querySelector('.card').innerHTML = '<h2 class="err">登录失败</h2><p>'+String(e.message||e)+'</p><a href="/" style="color:#93c5fd">返回首页</a>';
      });
    }
  }
  done();
})();
</script></body></html>`
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function isAdmin(user) {
  return user && String(user.level || '') === 'admin'
}

function buildAuthorizeUrl(api, req, provider, intent, userId) {
  const cfg = publicConfig(api, req)
  const state = createOAuthState(api, {
    provider,
    intent: intent || 'login',
    userId: userId || null
  })
  if (provider === 'qq') {
    if (!cfg.qqConfigured) throw new Error('请先在插件配置中填写 QQ AppID / AppKey')
    if (!boolVar(api, 'qq_enabled', true)) throw new Error('QQ 登录未启用')
    const appId = String(api.getVar('qq_app_id', '') || '').trim()
    return (
      'https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=' +
      encodeURIComponent(appId) +
      '&redirect_uri=' +
      encodeURIComponent(cfg.qqRedirectUri) +
      '&state=' +
      encodeURIComponent(state) +
      '&scope=get_user_info'
    )
  }
  if (provider === 'wechat') {
    if (!cfg.wxConfigured) throw new Error('请先在插件配置中填写微信 AppID / AppSecret')
    if (!boolVar(api, 'wx_enabled', true)) throw new Error('微信登录未启用')
    const appId = String(api.getVar('wx_app_id', '') || '').trim()
    return (
      'https://open.weixin.qq.com/connect/qrconnect?appid=' +
      encodeURIComponent(appId) +
      '&redirect_uri=' +
      encodeURIComponent(cfg.wxRedirectUri) +
      '&response_type=code&scope=snsapi_login&state=' +
      encodeURIComponent(state) +
      '#wechat_redirect'
    )
  }
  throw new Error('未知登录渠道')
}

async function handleCallback(api, req, provider) {
  const q = (req && req.query) || {}
  const err = q.error || q.error_description
  if (err) {
    return httpHtml(
      400,
      resultPage({ ok: false, title: '授权失败', message: String(err), close: true })
    )
  }
  const code = String(q.code || '').trim()
  const state = String(q.state || '').trim()
  if (!code || !state) {
    return httpHtml(
      400,
      resultPage({ ok: false, title: '回调无效', message: '缺少 code 或 state', close: true })
    )
  }
  const st = takeOAuthState(api, state)
  if (!st || st.provider !== provider) {
    return httpHtml(
      400,
      resultPage({ ok: false, title: '状态无效', message: '授权已过期，请重试', close: true })
    )
  }
  try {
    const cfg = publicConfig(api, req)
    const profile =
      provider === 'qq'
        ? await exchangeQq(api, code, cfg.qqRedirectUri)
        : await exchangeWechat(api, code)

    if (st.intent === 'bind') {
      const userId = String(st.userId || '').trim()
      if (!userId) throw new Error('绑定会话无效')
      const user = api.findUser({ id: userId })
      if (!user) throw new Error('用户不存在')
      setBinding(api, userId, provider, profile)
      return httpHtml(
        200,
        resultPage({
          ok: true,
          title: '绑定成功',
          message:
            (provider === 'qq' ? 'QQ' : '微信') +
            ' 已绑定到 ' +
            (user.displayName || user.username) +
            (profile.nickname ? '（' + profile.nickname + '）' : ''),
          close: true
        })
      )
    }

    const user = await resolveUserFromProfile(api, profile)
    const grant = api.createLoginGrant(user.id, { ttlSec: 120 })
    return httpHtml(
      200,
      resultPage({
        ok: true,
        title: '授权成功',
        message: '欢迎，' + (user.displayName || user.username),
        grantToken: grant.grantToken,
        close: false
      })
    )
  } catch (e) {
    return httpHtml(
      400,
      resultPage({
        ok: false,
        title: '登录失败',
        message: e instanceof Error ? e.message : String(e),
        close: true
      })
    )
  }
}

function summarizeBind(b) {
  if (!b) return null
  return {
    qq: b.qq
      ? {
          openid: b.qq.openid,
          nickname: b.qq.nickname || '',
          avatar: b.qq.avatar || '',
          boundAt: b.qq.boundAt
        }
      : null,
    wechat: b.wechat
      ? {
          openid: b.wechat.openid,
          unionid: b.wechat.unionid || '',
          nickname: b.wechat.nickname || '',
          avatar: b.wechat.avatar || '',
          boundAt: b.wechat.boundAt
        }
      : null
  }
}

module.exports = {
  async login_before(api, payload) {
    if (loginMode(api) === 'oauth_only') {
      return {
        proceed: false,
        status: 403,
        body: {
          ok: false,
          message: '已开启强制 QQ/微信登录，请使用 QQ 或微信扫码登录'
        }
      }
    }
    return payload
  },

  async login_after(api, me) {
    const store = loadStore(api)
    const user = me && me.user
    const force = boolVar(api, 'force_bind', false)
    const bound = user && user.id ? hasAnyBind(store, user.id) : false
    return Object.assign({}, me, {
      qqWx: {
        forceBind: force,
        needsBind: force && !bound,
        bindings: user && user.id ? summarizeBind(userBindings(store, user.id)) : null
      }
    })
  },

  async auth_me(api, me) {
    const store = loadStore(api)
    const user = me && me.user
    const force = boolVar(api, 'force_bind', false)
    const bound = user && user.id ? hasAnyBind(store, user.id) : false
    return Object.assign({}, me, {
      qqWx: {
        forceBind: force,
        needsBind: force && !bound,
        bindings: user && user.id ? summarizeBind(userBindings(store, user.id)) : null,
        config: {
          loginMode: loginMode(api),
          qqEnabled: boolVar(api, 'qq_enabled', true),
          wxEnabled: boolVar(api, 'wx_enabled', true)
        }
      }
    })
  },

  async users_list(api, list) {
    const store = loadStore(api)
    const rows = Array.isArray(list) ? list : []
    return rows.map((u) => {
      if (!u || !u.id) return u
      const b = summarizeBind(userBindings(store, u.id))
      const pluginData = Object.assign({}, u.pluginData || {}, { qq_wx: b })
      return Object.assign({}, u, { pluginData })
    })
  },

  async register(api) {
    api.registerRoute(
      'GET',
      '/api/v1/qq-wx/config',
      async (req) => ({ ok: true, ...publicConfig(api, req) }),
      { public: true }
    )

    api.registerRoute(
      'GET',
      '/api/v1/qq-wx/start',
      async (req) => {
        const q = req.query || {}
        const provider = String(q.provider || '').trim()
        const intent = String(q.intent || 'login').trim() === 'bind' ? 'bind' : 'login'
        if (provider !== 'qq' && provider !== 'wechat') {
          return httpJson(400, { ok: false, message: 'provider 须为 qq 或 wechat' })
        }
        const mode = loginMode(api)
        if (intent === 'login' && mode === 'password_only') {
          return httpJson(403, { ok: false, message: '当前仅允许密码登录' })
        }
        let userId = null
        if (intent === 'bind') {
          // bind 也可由带 token 的前端走 /bind/start；此处允许 query.userId 仅配合已签名 state 不安全
          // 公开 start 只允许 login；bind 走下方认证路由
          return httpJson(401, { ok: false, message: '请登录后调用 /api/v1/qq-wx/bind/start' })
        }
        try {
          const url = buildAuthorizeUrl(api, req, provider, 'login', userId)
          return httpRedirect(url)
        } catch (e) {
          return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
        }
      },
      { public: true }
    )

    api.registerRoute('GET', '/api/v1/qq-wx/bind/start', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const q = req.query || {}
      const provider = String(q.provider || '').trim()
      if (provider !== 'qq' && provider !== 'wechat') {
        return httpJson(400, { ok: false, message: 'provider 须为 qq 或 wechat' })
      }
      try {
        const url = buildAuthorizeUrl(api, req, provider, 'bind', user.id)
        return httpRedirect(url)
      } catch (e) {
        return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
      }
    })

    api.registerRoute(
      'GET',
      '/api/v1/qq-wx/callback/qq',
      async (req) => handleCallback(api, req, 'qq'),
      { public: true }
    )
    api.registerRoute(
      'GET',
      '/api/v1/qq-wx/callback/wechat',
      async (req) => handleCallback(api, req, 'wechat'),
      { public: true }
    )

    api.registerRoute('GET', '/api/v1/qq-wx/me', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const store = loadStore(api)
      const force = boolVar(api, 'force_bind', false)
      const bound = hasAnyBind(store, user.id)
      return {
        ok: true,
        forceBind: force,
        needsBind: force && !bound,
        bindings: summarizeBind(userBindings(store, user.id)),
        config: publicConfig(api, req)
      }
    })

    api.registerRoute('POST', '/api/v1/qq-wx/unbind', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const body = (req && req.body) || {}
      const provider = String(body.provider || '').trim()
      if (provider !== 'qq' && provider !== 'wechat') {
        return httpJson(400, { ok: false, message: 'provider 须为 qq 或 wechat' })
      }
      if (boolVar(api, 'force_bind', false)) {
        const store = loadStore(api)
        const b = userBindings(store, user.id)
        const other = provider === 'qq' ? b.wechat : b.qq
        if (!other || !other.openid) {
          return httpJson(400, {
            ok: false,
            message: '已开启强制绑定，至少保留一种 QQ/微信绑定'
          })
        }
      }
      clearBinding(api, user.id, provider)
      return { ok: true }
    })

    api.registerRoute('GET', '/api/v1/qq-wx/admin/bindings', async (req) => {
      const user = authUser(req)
      if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const store = loadStore(api)
      return { ok: true, byUser: store.byUser, config: publicConfig(api, req) }
    })

    api.registerRoute('POST', '/api/v1/qq-wx/admin/unbind', async (req) => {
      const user = authUser(req)
      if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const body = (req && req.body) || {}
      const userId = String(body.userId || '').trim()
      const provider = String(body.provider || '').trim()
      if (!userId) return httpJson(400, { ok: false, message: '缺少 userId' })
      if (provider !== 'qq' && provider !== 'wechat' && provider !== 'all') {
        return httpJson(400, { ok: false, message: 'provider 须为 qq / wechat / all' })
      }
      if (provider === 'all') {
        clearBinding(api, userId, 'qq')
        clearBinding(api, userId, 'wechat')
      } else {
        clearBinding(api, userId, provider)
      }
      return { ok: true }
    })

    api.log('qq_wechat_login routes ready')
  }
}
