/**
 * command_hud v2 — full site HUD clock / node counters
 */
;(function () {
  var T = window.HanyeTheme
  if (!T) return

  function pad(n) {
    return (n < 10 ? '0' : '') + n
  }

  function clock() {
    var d = new Date()
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  }

  function countDevices() {
    try {
      var n = document.querySelectorAll('.hud-stage .device-card').length
      return n
    } catch (_) {
      return 0
    }
  }

  function tick() {
    var clocks = document.querySelectorAll('[data-hud-clock]')
    for (var i = 0; i < clocks.length; i++) clocks[i].textContent = clock()
    var n = countDevices()
    var label = n < 10 ? '0' + n : String(n)
    var nums = document.querySelectorAll('[data-hud-core-num]')
    for (var j = 0; j < nums.length; j++) nums[j].textContent = label
    var nodes = document.querySelectorAll('[data-hud-nodes]')
    for (var k = 0; k < nodes.length; k++) nodes[k].textContent = label
  }

  T.on('ready', function (p) {
    console.log('[command_hud] full ready', p && p.packId, p && p.siteMode)
    tick()
    if (!window.__hudOpsTimer) {
      window.__hudOpsTimer = setInterval(tick, 1000)
    }
  })
})()
