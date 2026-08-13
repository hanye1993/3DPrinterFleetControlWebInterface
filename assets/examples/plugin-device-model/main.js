/**
 * device_model_card — 提供机型映射 API（卡片 context 不含 model，需自行拉设备列表）
 */
module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/device-model-card/models', async () => {
      const devices = api.getDevices()
      const rows = (Array.isArray(devices) ? devices : []).map((d) => {
        const id = String((d && d.id) || '')
        const raw = d && d.model != null ? String(d.model).trim() : ''
        return {
          id,
          name: String((d && d.name) || id),
          brand: d && d.brand,
          model: raw || null
        }
      })
      return {
        ok: true,
        showOnCards: api.getVar('show_on_cards', '1') === '1',
        place: String(api.getVar('place', 'after_name') || 'after_name'),
        pollSec: Math.max(5, Math.min(120, Number(api.getVar('poll_sec', '15')) || 15)),
        rows,
        at: new Date().toISOString()
      }
    })
  }
}
