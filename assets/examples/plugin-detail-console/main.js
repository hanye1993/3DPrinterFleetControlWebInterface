/**
 * detail_console — 服务端：聚合状态 / 料卷绑定辅助
 */
async function register(api) {
  api.registerRoute('GET', '/api/v1/detail-console/snapshot', async (req, api) => {
    const q = (req && req.query) || {}
    const deviceId = String(q.deviceId || '').trim()
    if (!deviceId) return { ok: false, message: '缺少 deviceId' }

    const devices = (api.getDevices && api.getDevices()) || []
    const device = devices.find((d) => String(d.id) === deviceId) || null
    const statuses = (api.getStatuses && api.getStatuses()) || {}
    const status = statuses[deviceId] || null

    let spools = []
    try {
      // 走宿主耗材列表钩子可读的落库：优先插件私有缓存，否则空；前端也会直拉 /api/v1/filament
      const cached = api.readJson('spools-cache.json', null)
      if (cached && Array.isArray(cached.spools)) spools = cached.spools
    } catch (_) {
      /* ignore */
    }

    return {
      ok: true,
      data: {
        device: device
          ? {
              id: device.id,
              name: device.name,
              brand: device.brand,
              tech: device.tech,
              model: device.model || '',
              connectionMode: device.connectionMode || 'lan'
            }
          : null,
        status,
        vars: {
          replace_detail: api.getVar('replace_detail', '1'),
          poll_ms: api.getVar('poll_ms', '2000'),
          default_temp: api.getVar('default_temp', '220')
        }
      }
    }
  })

  api.log('[detail_console] routes ready')
}

module.exports = { register }
