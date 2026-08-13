module.exports = async function install(api) {
  api.writeJson('installed.json', { at: new Date().toISOString() })
  api.log('chamber_temp installed')
}
