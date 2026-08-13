module.exports = async function uninstall(api) {
  if (api.db && api.db.available) {
    try {
      await api.db.dropTable('room_msg')
      await api.db.dropTable('dm_msg')
    } catch (e) {
      api.log('dropTable', e)
    }
  }
  api.log('company_chat uninstalled')
}
