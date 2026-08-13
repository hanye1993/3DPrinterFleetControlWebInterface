module.exports = async function install(api) {
  api.writeJson('roster.json', {})
  api.writeJson('room_messages.json', [])
  api.writeJson('dm_messages.json', [])
  api.writeJson('files_meta.json', {})
  api.log('company_chat installed')
}
