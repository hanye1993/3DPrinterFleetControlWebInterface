/**
 * capability_kit — 宿主原语最小演示（Kernel v2）
 * 监听 print.finished 写入 history.json；提供探测路由。
 */
module.exports = {
  async activate(ctx) {
    ctx.log.info('capability_kit activate', ctx.meta.kernelVersion)

    ctx.hooks.on('action:print.finished', (payload) => {
      const list = ctx.storage.readJson('history.json', [])
      const rows = Array.isArray(list) ? list : []
      rows.unshift({
        at: new Date().toISOString(),
        ...(payload && typeof payload === 'object' ? payload : { raw: payload })
      })
      ctx.storage.writeJson('history.json', rows.slice(0, 200))
      ctx.log.info('history +1', payload && payload.deviceId)
    })

    ctx.http.registerRoute('GET', '/api/v1/plugins/capability_kit/probe', async () => {
      const devices = ctx.devices.list() || []
      const first = devices[0]
      const deviceId = first && first.id != null ? String(first.id) : ''
      const caps = deviceId && ctx.devices.getCapabilities
        ? ctx.devices.getCapabilities(deviceId)
        : null
      return {
        ok: true,
        data: {
          kernelVersion: ctx.meta.kernelVersion,
          publicBaseUrl: ctx.settings.getPublicBaseUrl
            ? ctx.settings.getPublicBaseUrl()
            : '',
          sampleDeviceId: deviceId || null,
          capabilities: caps,
          historyCount: (ctx.storage.readJson('history.json', []) || []).length
        }
      }
    })

    ctx.http.registerRoute(
      'POST',
      '/api/v1/plugins/capability_kit/demo-lock',
      async (req) => {
        const body = (req && req.body) || {}
        const deviceId = String(body.deviceId || '')
        if (!deviceId) return { ok: false, message: '缺少 deviceId' }
        if (!ctx.devices.claim) return { ok: false, message: 'devices.lock 不可用' }
        const r = await ctx.devices.claim(deviceId, { ttlSec: 120, ownerLabel: 'capability_kit' })
        return r
      }
    )
  },

  async deactivate(ctx) {
    ctx.log.info('capability_kit deactivate')
  }
}
