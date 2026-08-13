/* Login-page script (no JWT). Uses window.HanyePlugin SDK. */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  P.registerSlot(
    'login.header',
    function (el) {
      el.innerHTML =
        '<div style="text-align:center;margin-bottom:8px;padding:8px 12px;border-radius:8px;background:linear-gradient(90deg,#0ea5e9,#6366f1);color:#fff;font-weight:600">插件已接管登录页抬头</div>'
    },
    { order: 0, plugin: 'demo_hello' }
  )

  P.registerSlot(
    'login.form.after',
    function (el) {
      el.innerHTML =
        '<div style="margin-top:12px;text-align:center">' +
        '<p style="margin:0 0 10px;font-size:12px;opacity:.75">由 demo_hello 插件注入 · 可改任意登录 UI</p>' +
        '<button type="button" data-demo-sso style="height:32px;padding:0 14px;border:1px solid #1677ff;background:#1677ff;color:#fff;border-radius:6px;cursor:pointer">' +
        '演示：第三方授权后直登宿主' +
        '</button>' +
        '</div>'
      var btn = el.querySelector('[data-demo-sso]')
      if (!btn) return
      btn.addEventListener('click', async function () {
        var externalId = window.prompt('输入模拟第三方 externalId', 'demo_user')
        if (!externalId) return
        btn.disabled = true
        try {
          var res = await fetch('/api/v1/plugin-demo/mock-sso/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ externalId: externalId })
          })
          var data = await res.json()
          if (!res.ok || !data.ok || !data.grantToken) {
            throw new Error(data.message || '插件登录失败')
          }
          var login = await P.exchangeLoginGrant(data.grantToken)
          if (!login.ok) throw new Error(login.message || '宿主签发 JWT 失败')
        } catch (e) {
          window.alert(e && e.message ? e.message : String(e))
        } finally {
          btn.disabled = false
        }
      })
    },
    { order: 10 }
  )

  P.patchTheme({
    /* appearance store keys optional */
  })
})()
