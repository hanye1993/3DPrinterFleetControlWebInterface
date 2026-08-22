/**
 * farm_dispatch shared helpers — 必须外链加载（宿主 CSP 禁止 iframe 内联 script）
 */
;(function (global) {
  var TOKEN_KEY = 'hanye_client_jwt'
  var SERVER_KEY = 'hanye_client_server'

  function readAttr(name) {
    try {
      return document.documentElement.getAttribute(name) || ''
    } catch (e) {
      return ''
    }
  }

  function token() {
    try {
      var inj = readAttr('data-hanye-jwt')
      if (inj) return inj
      if (typeof global.__HANYE_JWT__ === 'string' && global.__HANYE_JWT__) return global.__HANYE_JWT__
      var t = localStorage.getItem(TOKEN_KEY) || ''
      if (t) return t
      if (global.parent && global.parent !== global) {
        try {
          t = global.parent.localStorage.getItem(TOKEN_KEY) || ''
        } catch (e1) {}
        if (t) return t
      }
      if (global.top && global.top !== global) {
        try {
          t = global.top.localStorage.getItem(TOKEN_KEY) || ''
        } catch (e2) {}
      }
      return t || ''
    } catch (e) {
      return ''
    }
  }

  function authHeaders(json) {
    var h = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    var t = token()
    if (t) h.Authorization = 'Bearer ' + t
    return h
  }

  function unwrap(j) {
    if (!j || typeof j !== 'object') return j
    if (j.data && typeof j.data === 'object') {
      var d = j.data
      if (
        j.ok === true ||
        d.ok != null ||
        d.roles ||
        d.board ||
        d.jobs ||
        d.logs ||
        d.models ||
        d.materials ||
        d.colors ||
        d.candidates ||
        d.stats ||
        d.records ||
        d.user ||
        d.dispatch ||
        d.groups ||
        d.devices ||
        d.spools ||
        d.notices
      ) {
        return d
      }
    }
    return j
  }

  function pickHttpBase(v) {
    var s = String(v || '')
      .trim()
      .replace(/\/$/, '')
    return /^https?:\/\//i.test(s) ? s : ''
  }

  function apiBase() {
    try {
      var inj = pickHttpBase(readAttr('data-hanye-api') || global.__HANYE_API_ORIGIN__)
      if (inj) return inj
    } catch (e0) {}
    try {
      var ls = pickHttpBase(localStorage.getItem(SERVER_KEY) || '')
      if (ls) return ls
    } catch (e1) {}
    try {
      if (global.parent && global.parent !== global) {
        try {
          var pls = pickHttpBase(global.parent.localStorage.getItem(SERVER_KEY) || '')
          if (pls) return pls
        } catch (e2) {}
        try {
          var po = pickHttpBase(global.parent.location && global.parent.location.origin)
          if (po) return po
        } catch (e3) {}
      }
    } catch (e4) {}
    try {
      var lo = pickHttpBase(location.origin)
      if (lo) return lo
    } catch (e5) {}
    return 'http://127.0.0.1:17890'
  }

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path
    var base = apiBase()
    return base ? base + path : path
  }

  function api(method, path, body, opts) {
    var ms = (opts && opts.timeout) || 15000
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort()
      } catch (e0) {}
    }, ms)
    return fetch(apiUrl(path), {
      method: method,
      headers: authHeaders(body != null),
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return { ok: false, message: '响应解析失败' }
          })
          .then(function (j) {
            j = unwrap(j)
            if (!res.ok && (!j || j.ok !== false)) {
              j = { ok: false, message: (j && j.message) || 'HTTP ' + res.status }
            }
            return j
          })
      })
      .finally(function () {
        clearTimeout(timer)
      })
      .catch(function (e) {
        var msg =
          e && e.name === 'AbortError' ? '请求超时' : e && e.message ? e.message : String(e)
        return { ok: false, message: msg }
      })
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function fmtTime(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d.getTime())) return String(iso)
    function p(n) {
      return n < 10 ? '0' + n : '' + n
    }
    return (
      d.getFullYear() +
      '-' +
      p(d.getMonth() + 1) +
      '-' +
      p(d.getDate()) +
      ' ' +
      p(d.getHours()) +
      ':' +
      p(d.getMinutes())
    )
  }

  global.FarmDispatch = {
    token: token,
    api: api,
    apiBase: apiBase,
    esc: esc,
    fmtTime: fmtTime
  }
})(typeof window !== 'undefined' ? window : this)
