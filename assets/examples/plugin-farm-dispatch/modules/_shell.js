/**
 * Shared iframe shell — CSS 可内联（CSP 允许 style unsafe-inline）；
 * JS 必须外链 static/*.js（宿主 script-src 'self' 禁止内联脚本）。
 */
function shellCss() {
  return `
:root {
  color-scheme: dark;
  --fd-bg: #0f141c;
  --fd-panel: rgba(255,255,255,.04);
  --fd-border: rgba(255,255,255,.12);
  --fd-text: #e8eaed;
  --fd-muted: rgba(232,234,237,.62);
  --fd-primary: #4096ff;
  --fd-ok: #52c41a;
  --fd-warn: #faad14;
  --fd-err: #ff7875;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--fd-bg);
  color: var(--fd-text);
}
body {
  font: 13px/1.45 system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  padding: 12px 14px 28px;
}
h2 { margin: 0 0 4px; font-size: 17px; font-weight: 650; }
.sub { color: var(--fd-muted); font-size: 12px; margin-bottom: 14px; }
.card {
  background: var(--fd-panel);
  border: 1px solid var(--fd-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 4px;
}
.dev-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  min-height: 148px;
  padding: 14px;
  cursor: pointer;
  border-radius: 12px;
  background: linear-gradient(165deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
  box-shadow: 0 1px 0 rgba(255,255,255,.04) inset;
  transition: border-color .15s ease, background .15s ease, transform .12s ease;
}
.dev-card:hover {
  border-color: rgba(64,150,255,.5);
  background: linear-gradient(165deg, rgba(64,150,255,.12), rgba(255,255,255,.04));
  transform: translateY(-1px);
}
.dev-card:active { transform: translateY(0); }
.dev-card.is-err { border-color: rgba(255,120,117,.5); }
.dev-card.is-fin { border-color: rgba(82,196,26,.45); }
.dev-card.is-mnt { border-color: rgba(250,173,20,.45); }
.dev-card.is-print { border-color: rgba(64,150,255,.45); }
.dev-card.is-idle { border-color: rgba(64,150,255,.28); }
.dev-card-name {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
  word-break: break-word;
}
.dev-card-body { flex: 1; }
.dev-card-fil {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  margin-top: 8px;
}
.dev-card-fil .swatch { width: 14px; height: 14px; }
.dev-card-foot {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px; padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,.08);
  font-size: 11px; color: var(--fd-muted);
}
.confirm-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  display: none; align-items: center; justify-content: center; z-index: 40;
  padding: 16px;
}
.confirm-mask.on { display: flex; }
.confirm-box {
  width: min(360px, 100%);
  background: #161d27;
  border: 1px solid var(--fd-border);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
}
.confirm-box h3 { margin: 0 0 8px; font-size: 15px; font-weight: 650; }
.confirm-box .meta { margin-bottom: 14px; }
.confirm-acts { display: flex; gap: 8px; }
.confirm-acts button { flex: 1; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
input, select, textarea, button {
  border-radius: 8px;
  border: 1px solid var(--fd-border);
  background: rgba(255,255,255,.06);
  color: inherit;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
}
/* 原生下拉：系统选项列表需强制深色字，否则白底浅字看不见 */
select {
  color: var(--fd-text);
  background-color: #1a222d;
  color-scheme: dark;
}
select option,
select optgroup {
  background-color: #1a222d;
  color: #e8eaed;
}
textarea { width: 100%; min-height: 72px; resize: vertical; }
button { cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: rgba(64,150,255,.28); border-color: rgba(64,150,255,.5); }
button.ok { background: rgba(82,196,26,.22); border-color: rgba(82,196,26,.45); }
button.warn { background: rgba(250,173,20,.22); border-color: rgba(250,173,20,.45); }
button.danger { background: rgba(255,120,117,.22); border-color: rgba(255,120,117,.5); }
button.ghost { background: transparent; }
.badge {
  display: inline-block; font-size: 11px; font-weight: 650;
  padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.08);
}
.b-err { background: rgba(255,120,117,.22); color: #ffccc7; }
.b-fin { background: rgba(82,196,26,.2); color: #b7eb8f; }
.b-mnt { background: rgba(250,173,20,.22); color: #ffe58f; }
.b-wait { background: rgba(250,173,20,.18); color: #ffe58f; }
.b-print { background: rgba(64,150,255,.22); color: #91caff; }
.b-rej { background: rgba(255,120,117,.18); color: #ffa39e; }
.meta { color: var(--fd-muted); font-size: 12px; line-height: 1.5; }
.empty { text-align: center; color: var(--fd-muted); padding: 36px 8px; }
.fd-toast {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  z-index: 50; max-width: min(92vw, 420px); padding: 10px 14px;
  border-radius: 10px; background: rgba(22,29,39,.96);
  border: 1px solid var(--fd-border); color: var(--fd-text);
  box-shadow: 0 8px 28px rgba(0,0,0,.35); font-size: 13px;
  opacity: 0; pointer-events: none; transition: opacity .18s ease;
}
.fd-toast.on { opacity: 1; }
.err { color: var(--fd-err); margin: 8px 0; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tab {
  border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer;
  background: transparent; color: var(--fd-muted); border: 1px solid var(--fd-border);
}
.tab.on { color: var(--fd-text); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.22); }
.group-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 12px; }
.group-chip {
  cursor: pointer; padding: 4px 10px; border-radius: 8px; font-size: 12px;
  background: transparent; color: var(--fd-muted); border: 1px solid var(--fd-border);
}
.group-chip.on { color: #fff; background: rgba(64,150,255,.22); border-color: var(--fd-primary); }
.group-h {
  margin: 14px 0 8px; font-size: 12px; color: var(--fd-muted);
}
.group-h:first-child { margin-top: 4px; }
.swatch {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.35); display: inline-block; vertical-align: middle;
}
.grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 860px) { .grid, .grid2 { grid-template-columns: 1fr; } }
.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: none; align-items: flex-end; justify-content: center; z-index: 20;
}
.sheet-mask.on { display: flex; }
.sheet {
  width: min(560px, 100%); max-height: 82vh; overflow: auto;
  background: #161d27; border: 1px solid var(--fd-border);
  border-radius: 14px 14px 0 0; padding: 14px;
}
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
th { opacity: .7; }
code { white-space: pre-wrap; word-break: break-all; font-size: 11px; }
.filebox {
  border: 1px dashed var(--fd-border); border-radius: 10px; padding: 16px; text-align: center;
  cursor: pointer; background: rgba(255,255,255,.03);
}
`
}

/** 无内联 JS 的页面骨架；脚本走同源 /api/.../asset/static（满足 CSP script-src 'self'） */
function pageHtml(title, pageScript) {
  const asset = (f) => '/api/v1/plugins/farm_dispatch/asset/static/' + f
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${shellCss()}</style>
</head>
<body>
<div id="app"><div class="empty">加载中…</div></div>
<script src="${asset('shell.js')}"></script>
<script src="${asset(pageScript)}"></script>
</body>
</html>`
}

module.exports = { shellCss, pageHtml }
