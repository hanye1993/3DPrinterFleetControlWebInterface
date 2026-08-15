/**
 * print_log — Soft Settings「打印记录」：设备勾选、导航开关等
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var PLUGIN = 'print_log'

  function authHeaders(json) {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(j) {
    if (j && j.data && typeof j.data === 'object') return j.data
    return j
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {}).then(function (r) {
      return r.json().then(function (j) {
        var payload = unwrap(j)
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && payload.message) || (j && j.message) || '请求失败')
        }
        return payload
      })
    })
  }

  function render(el, cfg) {
    var devices = cfg.devices || []
    var selected = {}
    ;(cfg.deviceIds || []).forEach(function (id) {
      selected[String(id)] = true
    })
    var chips = devices
      .map(function (d) {
        var id = String(d.id)
        return (
          '<label class="pl-chip">' +
          '<input type="checkbox" data-dev="' +
          escapeHtml(id) +
          '"' +
          (selected[id] ? ' checked' : '') +
          (cfg.recordAll ? ' disabled' : '') +
          '/> ' +
          escapeHtml(d.name || id) +
          '</label>'
        )
      })
      .join('')

    el.innerHTML =
      '<div class="settings-tab-panel pl-settings">' +
      '<h3>打印记录</h3>' +
      '<p class="pl-desc">记录系统发送 / 打印队列 / 批量 / 现场操作的打印任务：时间、人员、设备、文件与材料用量。</p>' +
      '<div class="pl-field"><label>显示侧栏导航「打印记录」</label>' +
      '<select data-k="showNav">' +
      '<option value="1"' +
      (cfg.showNav !== false ? ' selected' : '') +
      '>显示</option>' +
      '<option value="0"' +
      (cfg.showNav === false ? ' selected' : '') +
      '>隐藏</option>' +
      '</select>' +
      '<div class="pl-hint">隐藏后仍可通过用户权限「打印记录」授权访问（若你另有入口）。刷新页面后导航生效。</div></div>' +
      '<div class="pl-field"><label>记录范围</label>' +
      '<select data-k="recordAll">' +
      '<option value="1"' +
      (cfg.recordAll !== false ? ' selected' : '') +
      '>全部打印机</option>' +
      '<option value="0"' +
      (cfg.recordAll === false ? ' selected' : '') +
      '>仅勾选的打印机</option>' +
      '</select></div>' +
      '<div class="pl-field"><label>要记录的打印机</label>' +
      '<div class="pl-chips" data-devs>' +
      (chips || '<span class="pl-hint">暂无设备</span>') +
      '</div></div>' +
      '<div class="pl-field pl-row">' +
      '<label><input type="checkbox" data-k="recordSystem"' +
      (cfg.recordSystem !== false ? ' checked' : '') +
      '/> 系统发送 / 队列 / 批量</label>' +
      '<label><input type="checkbox" data-k="recordOnDevice"' +
      (cfg.recordOnDevice !== false ? ' checked' : '') +
      '/> 现场机上操作</label>' +
      '</div>' +
      '<div class="pl-field pl-grid2">' +
      '<div><label>保留天数（0=不清理）</label>' +
      '<input type="number" min="0" max="3650" data-k="retainDays" value="' +
      escapeHtml(cfg.retainDays != null ? cfg.retainDays : 180) +
      '"/></div>' +
      '<div><label>最多保留条数</label>' +
      '<input type="number" min="100" max="20000" data-k="maxRows" value="' +
      escapeHtml(cfg.maxRows != null ? cfg.maxRows : 2000) +
      '"/></div></div>' +
      '<div class="pl-actions">' +
      '<button type="button" class="pl-btn primary" data-act="save">保存设置</button>' +
      '<button type="button" class="pl-btn" data-act="clear">清空全部记录</button>' +
      '<span class="pl-msg" data-msg></span></div>' +
      '<p class="pl-hint">用户侧栏入口还需在「用户」里勾选权限：<code>打印记录</code>（plugin.print_log.page）。</p>' +
      '</div>'

    var allSel = el.querySelector('[data-k="recordAll"]')
    if (allSel) {
      allSel.addEventListener('change', function () {
        var dis = allSel.value === '1'
        el.querySelectorAll('[data-dev]').forEach(function (ck) {
          ck.disabled = dis
        })
      })
    }
  }

  function collect(el) {
    var showNav = el.querySelector('[data-k="showNav"]').value === '1'
    var recordAll = el.querySelector('[data-k="recordAll"]').value === '1'
    var deviceIds = []
    el.querySelectorAll('[data-dev]').forEach(function (ck) {
      if (ck.checked) deviceIds.push(ck.getAttribute('data-dev'))
    })
    return {
      showNav: showNav,
      recordAll: recordAll,
      deviceIds: deviceIds,
      recordSystem: el.querySelector('[data-k="recordSystem"]').checked,
      recordOnDevice: el.querySelector('[data-k="recordOnDevice"]').checked,
      retainDays: Number(el.querySelector('[data-k="retainDays"]').value || 180),
      maxRows: Number(el.querySelector('[data-k="maxRows"]').value || 2000)
    }
  }

  P.registerSettingsTab({
    key: 'print_log',
    label: '打印记录',
    after: 'plugins',
    order: 12,
    adminOnly: true,
    plugin: PLUGIN,
    render: function (el) {
      el.innerHTML = '<div class="settings-tab-panel"><p>加载中…</p></div>'
      fetchJson('/api/v1/print-log/config', { headers: authHeaders() })
        .then(function (cfg) {
          render(el, cfg || {})
        })
        .catch(function (e) {
          el.innerHTML =
            '<div class="settings-tab-panel"><p class="pl-err">' +
            escapeHtml(e && e.message ? e.message : '加载失败') +
            '</p></div>'
        })

      if (el._plBound) return
      el._plBound = true
      el.addEventListener('click', function (ev) {
        var t = ev.target
        if (!t || !t.getAttribute) return
        var act = t.getAttribute('data-act')
        var msg = el.querySelector('[data-msg]')
        if (act === 'save') {
          t.disabled = true
          if (msg) msg.textContent = '保存中…'
          fetchJson('/api/v1/print-log/config', {
            method: 'PUT',
            headers: authHeaders(true),
            body: JSON.stringify(collect(el))
          })
            .then(function (cfg) {
              if (msg) msg.textContent = '已保存（刷新页面后导航开关生效）'
              render(el, cfg)
              try {
                P.emit('nav:change', null)
              } catch (_) {
                /* ignore */
              }
            })
            .catch(function (e) {
              if (msg) msg.textContent = e && e.message ? e.message : '保存失败'
            })
            .then(function () {
              t.disabled = false
            })
          return
        }
        if (act === 'clear') {
          if (!confirm('确定清空全部打印记录？不可恢复。')) return
          t.disabled = true
          fetchJson('/api/v1/print-log/records', {
            method: 'DELETE',
            headers: authHeaders(true),
            body: JSON.stringify({ all: true })
          })
            .then(function () {
              if (msg) msg.textContent = '已清空记录'
            })
            .catch(function (e) {
              if (msg) msg.textContent = e && e.message ? e.message : '清空失败'
            })
            .then(function () {
              t.disabled = false
            })
        }
      })
    }
  })
})()
