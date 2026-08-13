/**
 * card_progress_vivid — 进度条上爬行的虫子（持续爬行动画，位置跟填充前端）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var cfg = { showWorm: true, animate: true, thick: true }

  function loadCfg() {
    return fetch('/api/v1/card-progress-vivid/config', {
      headers: { Accept: 'application/json' }
    })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var p = data && data.data && typeof data.data === 'object' ? data.data : data
        if (!p || p.ok === false) return
        // 兼容旧变量 show_percent：当作是否显示虫子
        var show =
          p.showWorm != null
            ? p.showWorm !== false
            : p.showPercent != null
              ? p.showPercent !== false
              : true
        cfg.showWorm = show
        cfg.animate = p.animate !== false
        cfg.thick = p.thick !== false
        document.body.classList.toggle('cpv-no-anim', !cfg.animate)
        document.body.classList.toggle('cpv-thick', cfg.thick)
        document.body.classList.toggle('cpv-thin', !cfg.thick)
        document.body.classList.toggle('cpv-hide-worm', !cfg.showWorm)
      })
      .catch(function () {})
  }

  function pctOf(v) {
    var n = Number(v)
    if (!Number.isFinite(n) || n < 0) return 0
    if (n > 100) return 100
    return Math.round(n)
  }

  function tone(health, pct) {
    var h = String(health || '')
    if (h === 'error') return 'err'
    if (h === 'offline' || h === 'connecting') return 'off'
    if (pct >= 100) return 'done'
    if (pct > 0) return 'run'
    return 'idle'
  }

  function wormHtml() {
    return (
      '<span class="cpv-worm" aria-hidden="true">' +
      '<i class="cpv-worm-seg s1"></i>' +
      '<i class="cpv-worm-seg s2"></i>' +
      '<i class="cpv-worm-seg s3"></i>' +
      '<i class="cpv-worm-seg s4"></i>' +
      '<i class="cpv-worm-seg s5"></i>' +
      '<i class="cpv-worm-head"></i>' +
      '</span>'
    )
  }

  function placeWorm(wrap, pct, t) {
    if (!wrap) return
    wrap.classList.add('cpv-progress')
    wrap.setAttribute('data-cpv-tone', t)
    wrap.style.setProperty('--cpv-pct', pct + '%')

    var bar = wrap.querySelector('.card-progress-bar')
    if (bar) bar.classList.add('cpv-bar')

    var host = wrap.querySelector('.cpv-worm-host')
    if (!cfg.showWorm) {
      if (host) host.remove()
      return
    }
    if (!host) {
      host = document.createElement('span')
      host.className = 'cpv-worm-host'
      host.innerHTML = wormHtml()
      wrap.appendChild(host)
    }
    host.className = 'cpv-worm-host cpv-t-' + t + (cfg.animate ? ' is-crawling' : '')
    // 虫子头朝右，贴在填充前端；低进度时稍微露出
    var left = Math.max(4, Math.min(pct, 98))
    host.style.left = left + '%'
  }

  function enhanceFromSlot(el, health, pct) {
    var card = el && el.closest && el.closest('.device-card')
    if (!card) return null
    card.classList.add('cpv-card')
    card.setAttribute('data-cpv-tone', tone(health, pct))
    card.setAttribute('data-cpv-pct', String(pct))
    return card.querySelector('.card-progress')
  }

  P.registerSlot(
    'device.card.progress.after',
    function (el, ctx) {
      var c = (ctx && ctx.context) || {}
      var pct = pctOf(c.progress)
      var health = c.health || 'offline'
      var t = tone(health, pct)
      el.innerHTML = ''
      var wrap = enhanceFromSlot(el, health, pct)
      placeWorm(wrap, pct, t)
    },
    { order: 0, plugin: 'card_progress_vivid' }
  )

  function polish() {
    document.querySelectorAll('.device-card .card-progress').forEach(function (wrap) {
      wrap.classList.add('cpv-progress')
      var bar = wrap.querySelector('.card-progress-bar')
      if (bar) bar.classList.add('cpv-bar')
      if (!wrap.querySelector('.cpv-worm-host') && cfg.showWorm) {
        var w = bar && bar.style && bar.style.width ? parseFloat(bar.style.width) : 0
        var pct = pctOf(w)
        var card = wrap.closest('.device-card')
        var health =
          (card && card.getAttribute('data-csv-health')) ||
          (card && card.classList.contains('error') ? 'error' : 'online')
        placeWorm(wrap, pct, tone(health, pct))
      } else if (wrap.querySelector('.cpv-worm-host') && cfg.animate) {
        wrap.querySelector('.cpv-worm-host').classList.add('is-crawling')
      }
    })
  }

  loadCfg().then(function () {
    P.emit('slot:change', { name: 'device.card.progress.after' })
    polish()
    setInterval(polish, 3000)
  })
})()
