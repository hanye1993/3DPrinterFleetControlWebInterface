module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/card-status-vivid/config', async () => ({
      ok: true,
      showBadge: api.getVar('show_badge', '1') === '1',
      showBanner: api.getVar('show_banner', '0') === '1',
      animate: api.getVar('animate', '1') === '1'
    }))
  }
}
