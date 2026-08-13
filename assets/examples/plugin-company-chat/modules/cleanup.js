/** cron: 按 retain_days 清理过期聊天记录 */
module.exports = async function cleanup(api) {
  const main = require('../main.js')
  if (main && typeof main.runCleanup === 'function') {
    return main.runCleanup(api)
  }
  api.log('cleanup skipped: runCleanup missing')
  return { ok: false }
}
