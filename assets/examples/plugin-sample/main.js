/**
 * Server hooks — can change devices, permissions, theme data, routes.
 */
module.exports = {
  async devices_list(api, devices) {
    if (api.getVar('prefix_devices') !== '1') return devices
    const g = api.getVar('greeting', '插件')
    if (!Array.isArray(devices)) return devices
    return devices.map((d) => {
      if (!d || typeof d !== 'object') return d
      const row = { ...d }
      const name = String(row.name || row.id || '')
      if (!name.startsWith(`[${g}]`)) row.name = `[${g}] ${name}`
      return row
    })
  },

  /** Patch effective permission list (login /me) */
  async permissions_effective(api, perms) {
    // Demo: ensure plugin page reachable; real plugins can add/remove any perm
    const list = Array.isArray(perms) ? perms.slice() : []
    if (!list.includes('nav.settings')) list.push('nav.settings')
    return list
  },

  /**
   * Extra permission codes for 用户权限勾选.
   * Module `perm` is auto-included; this hook can add more (non-nav) codes.
   */
  async permissions_catalog(api, list) {
    const rows = Array.isArray(list) ? list.slice() : []
    if (!rows.some((r) => r && r.code === 'plugin.demo_hello.extra')) {
      rows.push({
        code: 'plugin.demo_hello.extra',
        label: '演示扩展能力',
        plugin: 'demo_hello',
        description: '示例：非导航类插件权限，可在业务里自行 hasPerm 校验'
      })
    }
    return rows
  },

  /** Ensure demo MySQL table when USE_MYSQL=1 */
  async register(api) {
    if (api.db?.available) {
      try {
        await api.db.ensureTable(
          'demo_kv',
          'k VARCHAR(64) PRIMARY KEY, v JSON NULL, updated_at DATETIME(3) NOT NULL'
        )
        await api.db.upsert(
          'demo_kv',
          { k: 'hello', v: JSON.stringify({ ok: true }), updated_at: new Date() },
          ['k']
        )
        const one = await api.db.getOne('demo_kv', { k: 'hello' })
        api.log('demo_kv row', one)
      } catch (e) {
        api.log('db CRUD demo failed', e)
      }
    }
    api.registerRoute('GET', '/api/v1/plugin-demo/hello', async () => ({
      greeting: api.getVar('greeting', '你好'),
      devices: api.getDevices().length,
      time: new Date().toISOString(),
      db: Boolean(api.db?.available)
    }))
    api.registerRoute(
      'POST',
      '/api/v1/plugin-demo/mock-sso/login',
      async (req) => {
        const body = req && req.body && typeof req.body === 'object' ? req.body : {}
        const externalId = String(body.externalId || '').trim()
        const displayName = String(body.displayName || '').trim()
        if (!externalId) {
          throw new Error('缺少 externalId')
        }
        // Demo only: treat externalId as a verified third-party identity.
        // Real plugins should validate OAuth/OIDC/企业平台回调后，再创建 grant。
        const username = `demo_sso_${externalId.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase()}`
        let user = api.findUser({ username })
        if (!user) {
          user = await api.createUser({
            username,
            displayName: displayName || `演示对接 ${externalId}`,
            level: 'viewer'
          })
        }
        const grant = api.createLoginGrant(user.id, { ttlSec: 120 })
        return {
          ok: true,
          externalId,
          grantToken: grant.grantToken,
          expiresAt: grant.expiresAt,
          user: grant.user
        }
      },
      { public: true }
    )
  },

  async theme_resolve(api, theme) {
    return {
      ...(theme && typeof theme === 'object' ? theme : {}),
      // Soft hint — client theme.css does the heavy lift
      pluginTheme: 'demo_hello'
    }
  },

  async ui_assets(api, assets) {
    const next = assets && typeof assets === 'object' ? { ...assets } : {}
    if (api.getVar('hide_models_nav') === '1') {
      next.hideNavKeys = [...(next.hideNavKeys || []), 'models', 'aiModels']
    }
    return next
  },

  /**
   * Zone camera snapshot for plugin sourceType === 'demo_vendor'.
   * Prefer pluginData.snapUrl; otherwise return a tiny JPEG placeholder.
   */
  async monitor_camera_snapshot(api, payload) {
    const cam = payload && payload.camera
    if (!cam || cam.sourceType !== 'demo_vendor') return payload
    const pd = cam.pluginData && typeof cam.pluginData === 'object' ? cam.pluginData : {}
    const snap = String(pd.snapUrl || cam.url || '').trim()
    if (snap.startsWith('http://') || snap.startsWith('https://')) {
      return { handled: false, url: snap }
    }
    // 1x1 JPEG
    const base64 =
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k='
    return {
      handled: true,
      ok: true,
      contentType: 'image/jpeg',
      base64
    }
  },

  /** Tag new print requests with demo pluginData */
  async print_request_create(api, payload) {
    if (!payload || payload.proceed === false) return payload
    const body = payload.body && typeof payload.body === 'object' ? { ...payload.body } : {}
    const pd =
      body.pluginData && typeof body.pluginData === 'object' ? { ...body.pluginData } : {}
    if (!pd.tag) pd.tag = 'demo_hello'
    body.pluginData = pd
    return { ...payload, body }
  }
}
