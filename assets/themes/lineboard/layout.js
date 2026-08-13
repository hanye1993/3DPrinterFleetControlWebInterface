/**
 * lineboard — 航线看板
 * 结构：workspace 轨 + table 密表；此处补全站槽位文案/角标。
 */
;(function () {
  var T = window.HanyeTheme
  if (!T) return

  T.registerSlot('app.nav.after', function (el) {
    el.innerHTML = '<div class="lineboard-nav-badge">LINE<br/>BOARD</div>'
  })

  T.registerSlot('device.card.after', function (el, ctx) {
    var name =
      (ctx && ctx.context && (ctx.context.deviceName || ctx.context.deviceId)) || ''
    el.innerHTML =
      '<div class="lineboard-card-mark">ROW · ' +
      String(name || 'UNIT').slice(0, 18) +
      '</div>'
  })

  T.registerSlot('device.detail.before', function (el) {
    el.innerHTML =
      '<div class="lineboard-ticker" style="margin-bottom:12px;box-shadow:none">' +
      '<span>DEVICE DETAIL · LINEBOARD</span><span class="lineboard-ticker__meta">TABLE VIEW</span>' +
      '</div>'
  })

  T.on('ready', function (p) {
    console.log('[lineboard] ready', p && p.packId)
  })
})()
