;(function () {
  var P = window.HanyePlugin
  if (!P) return
  P.registerSlot('app.main.before', function (el) {
    el.innerHTML =
      '<div style="padding:8px 12px;font-size:12px;opacity:.8">capability_kit：宿主原语示例已加载（见 /api/v1/plugins/capability_kit/probe）</div>'
  }, { order: 90, plugin: 'capability_kit' })
})()
