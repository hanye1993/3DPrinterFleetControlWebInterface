/**
 * card_status_vivid — 设备卡片状态醒目增强
 * 槽位 context：health / state（见 PLUGIN.md §6.2）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var cfg = { showBadge: true, showBanner: false, animate: true }

  function loadCfg() {
    return fetch('/api/v1/card-status-vivid/config', {
      headers: { Accept: 'application/json' }
    })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var p = data && data.data && typeof data.data === 'object' ? data.data : data
        if (!p || p.ok === false) return
        cfg.showBadge = p.showBadge !== false
        cfg.showBanner = p.showBanner === true
        cfg.animate = p.animate !== false
        document.body.classList.toggle('csv-no-anim', !cfg.animate)
      })
      .catch(function () {})
  }

  function healthLabel(h) {
    h = String(h || 'offline')
    if (h === 'online') return '在线'
    if (h === 'warning') return '告警'
    if (h === 'error') return '异常'
    if (h === 'connecting') return '连接中'
    return '离线'
  }

  function stateLabel(s) {
    s = String(s || '').toLowerCase()
    if (!s) return ''
    if (s.indexOf('print') >= 0 || s === 'printing' || s === 'running') return '打印中'
    if (s === 'idle' || s === 'standby' || s === 'ready') return '空闲'
    if (s.indexOf('pause') >= 0) return '已暂停'
    if (s.indexOf('finish') >= 0 || s === 'complete' || s === 'completed') return '已完成'
    if (s.indexOf('error') >= 0 || s.indexOf('fail') >= 0) return '故障'
    if (s.indexOf('offline') >= 0) return '离线'
    return s
  }

  function stateKey(s) {
    s = String(s || '').toLowerCase()
    if (!s) return 'unknown'
    if (s.indexOf('print') >= 0 || s === 'running') return 'printing'
    if (s === 'idle' || s === 'standby' || s === 'ready') return 'idle'
    if (s.indexOf('pause') >= 0) return 'paused'
    if (s.indexOf('finish') >= 0 || s === 'complete' || s === 'completed') return 'finished'
    if (s.indexOf('error') >= 0 || s.indexOf('fail') >= 0) return 'error'
    if (s.indexOf('offline') >= 0) return 'offline'
    return 'other'
  }

  function tagCard(el, health, state) {
    var card = el && el.closest && el.closest('.device-card')
    if (!card) return
    card.classList.add('csv-card')
    card.setAttribute('data-csv-health', String(health || 'offline'))
    card.setAttribute('data-csv-state', stateKey(state))
    card.classList.toggle('csv-anim', cfg.animate)
  }

  P.registerSlot(
    'device.card.after-name',
    function (el, ctx) {
      var c = (ctx && ctx.context) || {}
      var health = c.health || 'offline'
      tagCard(el, health, c.state)
      if (!cfg.showBadge) {
        el.innerHTML = ''
        return
      }
      el.innerHTML =
        '<span class="csv-badge csv-h-' +
        String(health) +
        '" title="设备健康状态">' +
        healthLabel(health) +
        '</span>'
    },
    { order: 2, plugin: 'card_status_vivid' }
  )

  P.registerSlot(
    'device.card.extra',
    function (el, ctx) {
      var c = (ctx && ctx.context) || {}
      var health = c.health || 'offline'
      var state = c.state || ''
      tagCard(el, health, state)
      // 默认不渲染第二条状态条，只给卡片打标供 CSS 强化宿主底栏
      if (!cfg.showBanner) {
        el.innerHTML = ''
        return
      }
      var sk = stateKey(state)
      var sl = stateLabel(state)
      var hl = healthLabel(health)
      el.innerHTML =
        '<div class="csv-banner csv-h-' +
        String(health) +
        ' csv-s-' +
        sk +
        '">' +
        '<span class="csv-banner-dot"></span>' +
        '<strong class="csv-banner-main">' +
        (sl || hl) +
        '</strong>' +
        (sl && sl !== hl ? '<span class="csv-banner-sub">' + hl + '</span>' : '') +
        '</div>'
    },
    { order: 1, plugin: 'card_status_vivid' }
  )

  // 同步强化宿主自带状态文案区（不改源码，仅加 class）
  function polishHostMsg() {
    document.querySelectorAll('.device-card').forEach(function (card) {
      var msg = card.querySelector('.device-card-msg')
      if (msg) msg.classList.add('csv-host-msg')
      var footer = card.querySelector('.device-card-footer')
      if (footer) footer.classList.add('csv-host-footer')
      var dot = card.querySelector('.health-dot')
      if (dot) dot.classList.add('csv-host-dot')
    })
  }

  loadCfg().then(function () {
    P.emit('slot:change', { name: 'device.card.after-name' })
    P.emit('slot:change', { name: 'device.card.extra' })
    polishHostMsg()
    setInterval(polishHostMsg, 3000)
  })

  P.registerSettingsTab({
    key: 'card_status_vivid',
    label: '卡片状态醒目',
    after: 'plugins',
    order: 12,
    adminOnly: true,
    render: function (el) {
      el.innerHTML =
        '<div class="settings-tab-panel">' +
        '<h3>设备卡片状态醒目</h3>' +
        '<p>在「插件」页可改：名称旁徽章、状态条、脉冲动画。</p>' +
        '<p style="opacity:.7">当前：徽章 ' +
        (cfg.showBadge ? '开' : '关') +
        ' · 状态条 ' +
        (cfg.showBanner ? '开' : '关') +
        ' · 动画 ' +
        (cfg.animate ? '开' : '关') +
        '</p></div>'
    }
  })
})()
