module.exports = async function install(api) {
  api.writeJson('bindings.json', { byUser: {}, byKey: {}, updatedAt: new Date().toISOString() })
  api.writeJson('oauth_states.json', {})
  api.log('qq_wechat_login installed')
}
