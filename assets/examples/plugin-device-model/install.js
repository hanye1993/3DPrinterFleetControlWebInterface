module.exports = async function install(api) {
  api.writeJson('installed.json', { at: new Date().toISOString() })
  api.log('device_model_card installed')
}
