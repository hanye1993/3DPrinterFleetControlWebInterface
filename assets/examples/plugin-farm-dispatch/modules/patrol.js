const path = require('path')

/** 升级后清掉 _shell 缓存，避免旧版 exports 导致 pageHtml is not a function */
function loadShell() {
  try {
    const p = require.resolve('./_shell')
    delete require.cache[p]
  } catch (_) {
    /* ignore */
  }
  return require('./_shell')
}

function pageFrame(title, pageScript) {
  const shell = loadShell()
  if (typeof shell.pageHtml === 'function') return shell.pageHtml(title, pageScript)
  // 兜底：不依赖 _shell.pageHtml（防缓存残留）
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

module.exports = async function patrol() {
  return { __html: pageFrame('巡查看板', 'page-patrol.js') }
}
