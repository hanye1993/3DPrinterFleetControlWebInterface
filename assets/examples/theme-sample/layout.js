/**
 * sample_topnav — 示例主题 layout.js
 * 排版来自 theme.json 的 layout / deviceView / loginLayout。
 * 此处演示：顶栏 / 导航旁 / 底栏 / 详情 等全站槽位（与插件同名）。
 */
;(function () {
  var T = window.HanyeTheme
  if (!T) return

  T.registerSlot('app.nav.after', function (el) {
    el.innerHTML =
      '<div class="sample-nav-tag" style="font-size:11px;opacity:.75;padding:4px 8px">THEME · NAV</div>'
  })

  T.registerSlot('app.footer.before', function (el) {
    el.innerHTML =
      '<div class="sample-footer-tag" style="font-size:11px;letter-spacing:.08em;opacity:.8">THEME FOOTER</div>'
  })

  T.registerSlot('device.detail.before', function (el, ctx) {
    var id =
      (ctx && ctx.context && (ctx.context.deviceId || ctx.context.id)) || ''
    el.innerHTML =
      '<div class="sample-detail-tag" style="font-size:12px;margin-bottom:8px;opacity:.85">THEME DETAIL' +
      (id ? ' · ' + String(id).slice(0, 8) : '') +
      '</div>'
  })

  T.on('ready', function (p) {
    console.log('[sample_topnav] theme ready', p && p.packId)
  })
})()
