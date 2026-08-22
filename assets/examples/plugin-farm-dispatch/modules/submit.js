function loadShell() {
  try {
    delete require.cache[require.resolve('./_shell')]
  } catch (_) {}
  return require('./_shell')
}

function pageFrame(title, pageScript) {
  const shell = loadShell()
  if (typeof shell.pageHtml === 'function') return shell.pageHtml(title, pageScript)
  const css = typeof shell.shellCss === 'function' ? shell.shellCss() : ''
  const asset = (f) => '/api/v1/plugins/farm_dispatch/asset/static/' + f
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div id="app"><div class="empty">加载中…</div></div>
<script src="${asset('shell.js')}"></script>
<script src="${asset(pageScript)}"></script>
</body>
</html>`
}

module.exports = async function submit() {
  return { __html: pageFrame('提交打印', 'page-submit.js') }
}
