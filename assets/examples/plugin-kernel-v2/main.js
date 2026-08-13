/**
 * Kernel v2 sample — activate(ctx): hooks, events, callback, cache, fetch.
 */
module.exports = {
  async activate(ctx) {
    ctx.log.info('demo_kernel_v2 activate', ctx.meta.kernelVersion)

    ctx.hooks.on(
      'filter:devices.list',
      (devices) => {
        if (!Array.isArray(devices)) return devices
        return devices.map((d) => {
          if (!d || typeof d !== 'object') return d
          const row = { ...d }
          const name = String(row.name || row.id || '')
          if (!name.includes('[v2]')) row.name = `[v2] ${name}`
          return row
        })
      },
      { priority: 80 }
    )

    // Domain events (print / device / alert / session)
    for (const ev of [
      'action:device.online',
      'action:device.offline',
      'action:print.finished',
      'action:print.failed',
      'action:alert.fired',
      'action:auth.session.created'
    ]) {
      ctx.hooks.on(ev, (payload) => {
        ctx.log.info('event', ev, payload && typeof payload === 'object' ? JSON.stringify(payload).slice(0, 200) : payload)
      })
    }

    if (ctx.cache) {
      await ctx.cache.set('boot_at', new Date().toISOString(), 3600_000)
    }

    // Signed third-party callback example: POST /api/v1/plugin-kernel-v2/hook
    // Header X-Hanye-Signature: hex(hmac-sha256(rawBody, secret))
    if (ctx.callbacks) {
      ctx.callbacks.register({
        path: '/api/v1/plugin-kernel-v2/hook',
        method: 'POST',
        secretVar: 'callback_secret',
        verify: ctx.vars.get('callback_secret') ? 'hmac-sha256' : 'none',
        handler: async (req) => {
          const body = req && typeof req === 'object' ? req.body : null
          ctx.log.info('inbound callback', body)
          return { ok: true, received: true }
        }
      })
    }

    ctx.http.registerRoute('GET', '/api/v1/plugin-kernel-v2/ping', async () => ({
      ok: true,
      kernel: ctx.meta.kernelVersion,
      banner: ctx.vars.get('banner'),
      devices: ctx.devices.list().length,
      bootAt: ctx.cache ? await ctx.cache.get('boot_at') : null
    }))
  },

  async deactivate(ctx) {
    ctx.log.info('demo_kernel_v2 deactivate')
  }
}
