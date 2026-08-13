module.exports = async function install(api) {
  api.writeJson('installed.json', { at: new Date().toISOString() })
  api.log('capability_kit installed')
}
