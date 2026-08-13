;(function () {
  var T = window.HanyeTheme
  if (!T) return
  T.on('ready', function (ev) {
    try {
      document.documentElement.setAttribute('data-fs-board', '1')
      if (ev && ev.mode) {
        document.documentElement.setAttribute('data-fs-mode', String(ev.mode))
      }
    } catch (_) {
      /* ignore */
    }
  })
})()
