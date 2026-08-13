module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/card-progress-vivid/config', async () => ({
      ok: true,
      showPercent: api.getVar('show_percent', '1') === '1',
      animate: api.getVar('animate', '1') === '1',
      thick: api.getVar('thick', '1') === '1'
    }))
  }
}
