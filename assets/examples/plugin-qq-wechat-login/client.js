/**
 * 登录后：用户管理列/解绑、强制绑定遮罩、设置说明
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var bindCache = Object.create(null)
  var meInfo = null

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(data) {
    if (data && data.data && typeof data.data === 'object') return data.data
    return data
  }

  function loadMe() {
    return fetch('/api/v1/qq-wx/me', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        meInfo = unwrap(data)
        return meInfo
      })
      .catch(function () {
        meInfo = null
        return null
      })
  }

  function loadAdminBindings() {
    return fetch('/api/v1/qq-wx/admin/bindings', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var payload = unwrap(data)
        bindCache = Object.create(null)
        var byUser = (payload && payload.byUser) || {}
        Object.keys(byUser).forEach(function (uid) {
          bindCache[uid] = byUser[uid]
        })
        return bindCache
      })
      .catch(function () {
        return bindCache
      })
  }

  function fmtBind(b) {
    if (!b) return '未绑定'
    var parts = []
    if (b.qq && b.qq.openid) parts.push('QQ:' + (b.qq.nickname || '已绑'))
    if (b.wechat && b.wechat.openid) parts.push('微信:' + (b.wechat.nickname || '已绑'))
    return parts.length ? parts.join(' · ') : '未绑定'
  }

  function openBind(provider) {
    window.open(
      '/api/v1/qq-wx/bind/start?provider=' + encodeURIComponent(provider),
      'qqwx_bind',
      'width=720,height=640'
    )
  }

  function adminUnbind(userId, provider) {
    return fetch('/api/v1/qq-wx/admin/unbind', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: userId, provider: provider })
    }).then(function (r) {
      return r.json()
    })
  }

  // —— 用户管理 ——
  P.registerUserColumn({
    id: 'qq_wx_bind',
    title: 'QQ/微信',
    width: 160,
    order: 40,
    plugin: 'qq_wechat_login',
    render: function (user) {
      var pd = (user && user.pluginData) || {}
      var b = pd.qq_wx || bindCache[String(user && user.id)] || null
      return fmtBind(b)
    }
  })

  P.registerUserRowAction({
    id: 'qqwx_unbind_qq',
    label: '解绑QQ',
    order: 80,
    danger: true,
    plugin: 'qq_wechat_login',
    run: async function (ctx) {
      var user = ctx.user || {}
      if (!window.confirm('确认解绑用户「' + (user.displayName || user.username || '') + '」的 QQ？'))
        return
      var data = await adminUnbind(String(user.id), 'qq')
      var payload = unwrap(data)
      if (payload && payload.ok === false) throw new Error(payload.message || '解绑失败')
      await loadAdminBindings()
      window.alert('已解绑 QQ')
    }
  })

  P.registerUserRowAction({
    id: 'qqwx_unbind_wx',
    label: '解绑微信',
    order: 81,
    danger: true,
    plugin: 'qq_wechat_login',
    run: async function (ctx) {
      var user = ctx.user || {}
      if (!window.confirm('确认解绑用户「' + (user.displayName || user.username || '') + '」的微信？'))
        return
      var data = await adminUnbind(String(user.id), 'wechat')
      var payload = unwrap(data)
      if (payload && payload.ok === false) throw new Error(payload.message || '解绑失败')
      await loadAdminBindings()
      window.alert('已解绑微信')
    }
  })

  P.registerUserFormField({
    id: 'qqwx_bind_info',
    mode: 'edit',
    order: 90,
    plugin: 'qq_wechat_login',
    render: function (el, ctx) {
      var user = (ctx && ctx.user) || {}
      var pd = user.pluginData || {}
      var b = pd.qq_wx || bindCache[String(user.id)] || null
      el.innerHTML =
        '<div class="qqwx-user-field"><div class="qqwx-user-field-title">QQ / 微信绑定</div>' +
        '<div class="qqwx-user-field-body">' +
        fmtBind(b) +
        '</div>' +
        '<div class="qqwx-user-field-hint">可在行操作中手动解绑；用户也可在强制绑定页自行绑定。</div></div>'
    }
  })

  // —— 强制绑定遮罩 ——
  function renderForceBind(el) {
    if (!meInfo || !meInfo.needsBind) {
      el.innerHTML = ''
      return
    }
    var cfg = meInfo.config || {}
    var html =
      '<div class="qqwx-force-mask"><div class="qqwx-force-card">' +
      '<h2>需要绑定 QQ 或微信</h2>' +
      '<p>管理员已开启「强制绑定」。请至少绑定一种第三方账号后继续使用。</p>' +
      '<div class="qqwx-login-actions">'
    if (cfg.qqEnabled !== false) {
      html += '<button type="button" class="qqwx-btn qqwx-btn-qq" data-bind="qq">绑定 QQ</button>'
    }
    if (cfg.wxEnabled !== false) {
      html +=
        '<button type="button" class="qqwx-btn qqwx-btn-wx" data-bind="wechat">绑定微信</button>'
    }
    html +=
      '</div><button type="button" class="qqwx-link" data-refresh>我已完成绑定，刷新状态</button></div></div>'
    el.innerHTML = html
    el.querySelectorAll('[data-bind]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBind(btn.getAttribute('data-bind'))
      })
    })
    var refresh = el.querySelector('[data-refresh]')
    if (refresh) {
      refresh.addEventListener('click', function () {
        loadMe().then(function () {
          P.emit('slot:change', { name: 'app.main.before' })
          if (meInfo && !meInfo.needsBind) location.reload()
        })
      })
    }
  }

  P.registerSlot(
    'app.main.before',
    function (el) {
      renderForceBind(el)
      return function () {
        el.innerHTML = ''
      }
    },
    { order: 0, plugin: 'qq_wechat_login' }
  )

  window.addEventListener('message', function (ev) {
    var data = ev && ev.data
    if (!data || data.type !== 'qq_wx_oauth') return
    loadMe().then(function () {
      P.emit('slot:change', { name: 'app.main.before' })
      if (meInfo && !meInfo.needsBind) location.reload()
    })
  })

  function loadPluginVars() {
    return fetch('/api/v1/plugins', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list = (data && data.plugins) || (data && data.data && data.data.plugins) || []
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].identifier === 'qq_wechat_login') {
            return Object.assign({}, list[i].vars || {})
          }
        }
        return {}
      })
      .catch(function () {
        return {}
      })
  }

  function savePluginVars(vars) {
    return fetch('/api/v1/plugins/' + encodeURIComponent('qq_wechat_login') + '/vars', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ vars: vars })
    }).then(function (r) {
      return r.json()
    })
  }

  function fieldRow(label, controlHtml, hint) {
    return (
      '<div class="qqwx-field">' +
      '<label class="qqwx-label">' +
      label +
      '</label>' +
      controlHtml +
      (hint ? '<div class="qqwx-hint">' + hint + '</div>' : '') +
      '</div>'
    )
  }

  function boolSelect(name, value) {
    var on = value === '1' || value === true || value === 'true'
    return (
      '<select class="qqwx-input" name="' +
      name +
      '">' +
      '<option value="1"' +
      (on ? ' selected' : '') +
      '>开启</option>' +
      '<option value="0"' +
      (!on ? ' selected' : '') +
      '>关闭</option>' +
      '</select>'
    )
  }

  function textInput(name, value, placeholder, type) {
    return (
      '<input class="qqwx-input" type="' +
      (type || 'text') +
      '" name="' +
      name +
      '" value="' +
      String(value || '').replace(/"/g, '&quot;') +
      '" placeholder="' +
      String(placeholder || '').replace(/"/g, '&quot;') +
      '" autocomplete="off" />'
    )
  }

  function modeSelect(value) {
    var v = String(value || 'all')
    var opts = [
      ['all', '密码 + QQ + 微信'],
      ['oauth_only', '仅 QQ / 微信登录'],
      ['password_only', '仅密码登录']
    ]
    var html = '<select class="qqwx-input" name="login_mode">'
    for (var i = 0; i < opts.length; i++) {
      html +=
        '<option value="' +
        opts[i][0] +
        '"' +
        (v === opts[i][0] ? ' selected' : '') +
        '>' +
        opts[i][1] +
        '</option>'
    }
    html += '</select>'
    return html
  }

  function levelSelect(value) {
    var v = String(value || 'viewer')
    var opts = [
      ['viewer', 'viewer 只读'],
      ['operator', 'operator 操作员'],
      ['admin', 'admin 管理员']
    ]
    var html = '<select class="qqwx-input" name="default_level">'
    for (var i = 0; i < opts.length; i++) {
      html +=
        '<option value="' +
        opts[i][0] +
        '"' +
        (v === opts[i][0] ? ' selected' : '') +
        '>' +
        opts[i][1] +
        '</option>'
    }
    html += '</select>'
    return html
  }

  function callbackHint() {
    var origin = location.origin || ''
    return (
      '<div class="qqwx-callback-box">' +
      '<div><b>QQ 回调</b> <code>' +
      origin +
      '/api/v1/qq-wx/callback/qq</code></div>' +
      '<div style="margin-top:6px"><b>微信回调</b> <code>' +
      origin +
      '/api/v1/qq-wx/callback/wechat</code></div>' +
      '<div class="qqwx-hint">请把以上地址填到 QQ 互联 / 微信开放平台（微信一般只填域名）。下方回调 URL 留空则自动用本站地址。</div>' +
      '</div>'
    )
  }

  function collectForm(root) {
    var vars = {}
    root.querySelectorAll('[name]').forEach(function (node) {
      vars[node.getAttribute('name')] = String(node.value || '')
    })
    return vars
  }

  function renderSettingsForm(el, vars) {
    var v = vars || {}
    el.innerHTML =
      '<div class="settings-tab-panel qqwx-settings">' +
      '<h3>QQ / 微信登录设置</h3>' +
      callbackHint() +
      '<div class="qqwx-section-title">登录策略</div>' +
      fieldRow('登录方式', modeSelect(v.login_mode || 'all')) +
      fieldRow(
        '强制绑定',
        boolSelect('force_bind', v.force_bind || '0'),
        '开启后：密码登录成功后必须绑定 QQ 或微信才能继续使用'
      ) +
      fieldRow(
        '首次第三方登录自动创建用户',
        boolSelect('auto_create', v.auto_create == null ? '1' : v.auto_create)
      ) +
      fieldRow('自动创建用户等级', levelSelect(v.default_level || 'viewer')) +
      '<div class="qqwx-section-title">QQ 互联</div>' +
      fieldRow('启用 QQ 登录', boolSelect('qq_enabled', v.qq_enabled == null ? '1' : v.qq_enabled)) +
      fieldRow('AppID', textInput('qq_app_id', v.qq_app_id, 'QQ 互联 AppID')) +
      fieldRow('AppKey', textInput('qq_app_key', v.qq_app_key, 'QQ 互联 AppKey', 'password')) +
      fieldRow(
        '回调 URL（可选）',
        textInput('qq_redirect_uri', v.qq_redirect_uri, '留空则用本站默认回调')
      ) +
      '<div class="qqwx-section-title">微信开放平台（网站应用）</div>' +
      fieldRow('启用微信登录', boolSelect('wx_enabled', v.wx_enabled == null ? '1' : v.wx_enabled)) +
      fieldRow('AppID', textInput('wx_app_id', v.wx_app_id, '微信网站应用 AppID')) +
      fieldRow(
        'AppSecret',
        textInput('wx_app_secret', v.wx_app_secret, '微信网站应用 AppSecret', 'password')
      ) +
      fieldRow(
        '回调 URL（可选）',
        textInput('wx_redirect_uri', v.wx_redirect_uri, '留空则用本站默认回调')
      ) +
      '<div class="qqwx-actions">' +
      '<button type="button" class="qqwx-save-btn" data-save>保存设置</button>' +
      '<span class="qqwx-save-msg" data-msg></span>' +
      '</div>' +
      '</div>'

    var btn = el.querySelector('[data-save]')
    var msg = el.querySelector('[data-msg]')
    if (!btn) return
    btn.addEventListener('click', function () {
      var next = collectForm(el)
      btn.disabled = true
      if (msg) {
        msg.textContent = '保存中…'
        msg.className = 'qqwx-save-msg'
      }
      savePluginVars(next)
        .then(function (data) {
          if (data && data.ok === false) throw new Error(data.message || '保存失败')
          if (msg) {
            msg.textContent = '已保存'
            msg.className = 'qqwx-save-msg is-ok'
          }
          return loadMe()
        })
        .then(function () {
          P.emit('slot:change', { name: 'app.main.before' })
        })
        .catch(function (e) {
          if (msg) {
            msg.textContent = e && e.message ? e.message : String(e)
            msg.className = 'qqwx-save-msg is-err'
          }
        })
        .finally(function () {
          btn.disabled = false
        })
    })
  }

  // —— 设置 Tab（可编辑） ——
  P.registerSettingsTab({
    key: 'qq_wechat_login',
    label: 'QQ/微信登录',
    after: 'plugins',
    order: 5,
    adminOnly: true,
    render: function (el) {
      el.innerHTML =
        '<div class="settings-tab-panel qqwx-settings"><p style="opacity:.7">加载设置…</p></div>'
      loadPluginVars().then(function (vars) {
        renderSettingsForm(el, vars)
      })
    }
  })

  loadMe().then(function () {
    P.emit('slot:change', { name: 'app.main.before' })
  })
  loadAdminBindings()
})()
