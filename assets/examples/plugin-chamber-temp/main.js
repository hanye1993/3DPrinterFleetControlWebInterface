/**
 * chamber_temp — server API only (no nav modules).
 */
module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/chamber-temp/temps', async () => {
      const devices = api.getDevices()
      const statuses = api.getStatuses() || {}
      const warn = Number(api.getVar('warn_celsius', '45')) || 45
      const rows = (Array.isArray(devices) ? devices : []).map((d) => {
        const id = String((d && d.id) || '')
        const name = String((d && d.name) || id)
        const st = statuses[id] || {}
        const raw = st.chamberTemp
        const temp =
          raw == null || raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw)
        const health = String(st.health || 'offline')
        return {
          id,
          name,
          brand: d && d.brand,
          health,
          chamberTemp: temp,
          warn: temp != null && temp >= warn,
          unit: 'C'
        }
      })
      return {
        ok: true,
        warnCelsius: warn,
        showOnCards: api.getVar('show_on_cards', '1') === '1',
        showPanel: api.getVar('show_panel', '0') === '1',
        vars: {
          show_badge: api.getVar('show_badge', '1')
        },
        pollSec: Math.max(2, Math.min(60, Number(api.getVar('poll_sec', '5')) || 5)),
        rows,
        at: new Date().toISOString()
      }
    })
  }
}
