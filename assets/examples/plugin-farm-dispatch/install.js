/**
 * 安装 / 升级：只补齐缺失数据，兼容「无数据库」纯文件模式与 MySQL 插件数据表。
 * 禁止用 fs.existsSync 判断（MySQL 模式磁盘上可能没有文件，会误清空库内数据）。
 */
function ensureJson(api, name, init) {
  try {
    const cur = api.readJson(name, '__missing__')
    if (cur === '__missing__') api.writeJson(name, init)
  } catch (e) {
    try {
      api.log('[farm_dispatch] ensureJson ' + name + ' ' + (e && e.message))
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = async function install(api) {
  ensureJson(api, 'duty.json', {})
  ensureJson(api, 'jobs.json', [])
  ensureJson(api, 'notifications.json', [])
  ensureJson(api, 'audit_log.json', [])
  ensureJson(api, 'allow_once.json', {})
  ensureJson(api, 'dispatch_stats.json', {})
  api.log(
    '[farm_dispatch] installed — 文件/无库模式均可用；请到「软件设置 → 巡查派单」初始化用户组'
  )
}
