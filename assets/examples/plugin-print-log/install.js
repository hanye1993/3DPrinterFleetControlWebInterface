module.exports = async function install(api) {
  api.log('[print_log] installed')
  try {
    api.writeJson('records.json', [])
    api.writeJson('pending.json', {})
    api.writeJson('status_prev.json', {})
  } catch (_) {
    /* ignore */
  }
}
