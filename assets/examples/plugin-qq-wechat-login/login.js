/**
 * 登录页：QQ / 微信按钮 + 按 login_mode 隐藏密码区
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var cfg = {
    loginMode: 'all',
    qqEnabled: false,
    wxEnabled: false,
    qqConfigured: false,
    wxConfigured: false
  }

  function loadConfig() {
    return fetch('/api/v1/qq-wx/config')
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var payload = data && data.data && typeof data.data === 'object' ? data.data : data
        if (!payload || payload.ok === false) return cfg
        cfg = {
          loginMode: String(payload.loginMode || 'all'),
          qqEnabled: Boolean(payload.qqEnabled),
          wxEnabled: Boolean(payload.wxEnabled),
          qqConfigured: Boolean(payload.qqConfigured),
          wxConfigured: Boolean(payload.wxConfigured)
        }
        return cfg
      })
      .catch(function () {
        return cfg
      })
  }

  function startOAuth(provider) {
    window.location.href =
      '/api/v1/qq-wx/start?provider=' + encodeURIComponent(provider) + '&intent=login'
  }

  function renderButtons(el) {
    var parts = []
    parts.push('<div class="qqwx-login-box">')
    if (cfg.loginMode === 'oauth_only') {
      parts.push('<div class="qqwx-login-hint">请使用 QQ 或微信登录</div>')
    } else if (cfg.loginMode !== 'password_only') {
      parts.push('<div class="qqwx-login-divider"><span>或使用第三方登录</span></div>')
    }
    parts.push('<div class="qqwx-login-actions">')
    if (cfg.loginMode !== 'password_only' && cfg.qqEnabled) {
      parts.push(
        '<button type="button" class="qqwx-btn qqwx-btn-qq" data-qqwx="qq"' +
          (cfg.qqConfigured ? '' : ' disabled title="未配置 AppID"') +
          '>QQ 登录</button>'
      )
    }
    if (cfg.loginMode !== 'password_only' && cfg.wxEnabled) {
      parts.push(
        '<button type="button" class="qqwx-btn qqwx-btn-wx" data-qqwx="wechat"' +
          (cfg.wxConfigured ? '' : ' disabled title="未配置 AppID"') +
          '>微信登录</button>'
      )
    }
    parts.push('</div>')
    if (!cfg.qqConfigured && !cfg.wxConfigured && cfg.loginMode !== 'password_only') {
      parts.push('<div class="qqwx-login-warn">管理员尚未配置 QQ/微信 AppID</div>')
    }
    parts.push('</div>')
    el.innerHTML = parts.join('')
    el.querySelectorAll('[data-qqwx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startOAuth(btn.getAttribute('data-qqwx'))
      })
    })
  }

  function hidePasswordForm() {
    // 尽量隐藏内置账号密码区（不改源码，用 CSS）
    var style = document.createElement('style')
    style.setAttribute('data-qqwx-hide-pwd', '1')
    style.textContent =
      'form.ant-form, .login-form form, [class*="login"] form { display: none !important; }' +
      '.qqwx-login-box { margin-top: 0 !important; }'
    document.head.appendChild(style)
  }

  loadConfig().then(function () {
    if (cfg.loginMode === 'oauth_only') hidePasswordForm()

    P.registerSlot(
      'login.sso.after',
      function (el) {
        if (cfg.loginMode === 'password_only') {
          el.innerHTML = ''
          return
        }
        renderButtons(el)
      },
      { order: 5, plugin: 'qq_wechat_login' }
    )

    P.registerSlot(
      'login.form.after',
      function (el) {
        // 无 SSO 区时也显示按钮
        if (cfg.loginMode === 'password_only') {
          el.innerHTML = ''
          return
        }
        if (document.querySelector('.qqwx-login-box')) {
          el.innerHTML = ''
          return
        }
        renderButtons(el)
      },
      { order: 20, plugin: 'qq_wechat_login' }
    )

    P.emit('slot:change', { name: 'login.sso.after' })
    P.emit('slot:change', { name: 'login.form.after' })
  })

  // 回调页若落到登录页带 grant（备用）
  try {
    var u = new URL(location.href)
    var grant = u.searchParams.get('plugin_grant') || u.searchParams.get('qqwx_grant')
    if (grant) {
      P.exchangeLoginGrant(grant).then(function (res) {
        if (!res || !res.ok) window.alert((res && res.message) || '登录失败')
        else location.replace('/')
      })
    }
  } catch (_) {}
})()
