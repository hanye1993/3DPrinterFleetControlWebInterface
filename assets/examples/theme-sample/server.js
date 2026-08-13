/**
 * Optional theme server hooks — MySQL CRUD via api.db (USE_MYSQL=1).
 */
module.exports = {
  async install(api) {
    if (!api.db.available) {
      api.log('MySQL 未启用，跳过建表')
      return
    }
    await api.db.ensureTable(
      'meta',
      'k VARCHAR(64) PRIMARY KEY, v JSON NULL, updated_at DATETIME(3) NOT NULL'
    )
    await api.db.upsert(
      'meta',
      { k: 'installed_at', v: JSON.stringify(new Date().toISOString()), updated_at: new Date() },
      ['k']
    )
    api.log('theme db ready', await api.db.count('meta'))
  },

  async enable(api) {
    if (!api.db.available) return
    await api.db.insert('meta', {
      k: `enable_${Date.now()}`,
      v: JSON.stringify({ event: 'enable' }),
      updated_at: new Date()
    })
  },

  async uninstall(api) {
    if (api.db.available) await api.db.dropTable('meta')
  }
}
