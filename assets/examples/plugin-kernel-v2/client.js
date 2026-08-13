;(function () {
  if (typeof window === 'undefined' || !window.HanyePlugin) return
  var api = window.HanyePlugin
  api.onReady(function () {
    api.slot('app.header.after', function () {
      var el = document.createElement('div')
      el.className = 'hanye-kernel-v2-banner'
      el.textContent = 'Plugin Kernel v2 demo'
      return el
    })
  })
})()
