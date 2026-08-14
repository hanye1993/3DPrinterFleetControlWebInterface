/**
 * extra_cameras — persist third-party cams on device.pluginData.extraCameras
 * Host merges them into /devices/:id/cameras, monitor wall, and AI patrol.
 */
function normalizeUrl(raw) {
  var s = String(raw == null ? '' : raw)
    .trim()
    .replace(/\s+/g, '')
  if (!s) return ''
  if (/^https?:\/\//i.test(s) || s.indexOf('bambu-cam://') === 0) return s
  // IP / host without scheme → assume http
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(s) || s.indexOf('/') === 0) return 'http://' + s.replace(/^\/+/, '')
  return s
}

function isHttpCam(url) {
  return /^https?:\/\//i.test(url) || String(url).indexOf('bambu-cam://') === 0
}

function ensureId(rawId, url, index) {
  var id = String(rawId || '').trim()
  if (id.indexOf('extra:') === 0 && id.length > 6) return id
  if (id && id.indexOf('/') < 0 && id.length < 80) return 'extra:' + id
  var base = url
    .replace(/^https?:\/\//i, '')
    .slice(0, 40)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
  return 'extra:' + (base || 'cam') + '_' + index
}

function normalizeList(list, defaultAi) {
  if (!Array.isArray(list)) return []
  var out = []
  var seen = Object.create(null)
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (!item || typeof item !== 'object') continue
    var streamUrl = normalizeUrl(item.streamUrl || item.url || item.snapshotUrl)
    if (!streamUrl || !isHttpCam(streamUrl)) continue
    var snap = normalizeUrl(item.snapshotUrl)
    var snapshotUrl = snap && isHttpCam(snap) ? snap : undefined
    var id = ensureId(item.id, streamUrl, i)
    if (seen[id]) continue
    seen[id] = 1
    var name = String(item.name || '').trim() || '第三方摄像头 ' + (out.length + 1)
    var aiEnabled =
      item.aiEnabled === false ? false : item.aiEnabled === true ? true : defaultAi !== false
    out.push({
      id: id,
      name: name,
      streamUrl: streamUrl,
      snapshotUrl: snapshotUrl,
      aiEnabled: aiEnabled
    })
  }
  return out
}

function findDevice(api, deviceId) {
  var devices = (api.getDevices && api.getDevices()) || []
  for (var i = 0; i < devices.length; i++) {
    if (String(devices[i].id) === String(deviceId)) return devices[i]
  }
  return null
}

async function register(api) {
  api.registerRoute('GET', '/api/v1/extra-cameras/list', async function (req) {
    var q = (req && req.query) || {}
    var deviceId = String(q.deviceId || '').trim()
    if (!deviceId) return { ok: false, message: '缺少 deviceId' }
    var d = findDevice(api, deviceId)
    if (!d) return { ok: false, message: '设备不存在' }
    var pd = d.pluginData && typeof d.pluginData === 'object' ? d.pluginData : {}
    var cameras = normalizeList(pd.extraCameras, api.getVar('default_ai', '1') === '1')
    return {
      ok: true,
      deviceId: deviceId,
      cameras: cameras,
      showSettings: api.getVar('show_settings', '1') === '1',
      defaultAi: api.getVar('default_ai', '1') === '1'
    }
  })

  api.registerRoute('PUT', '/api/v1/extra-cameras/save', async function (req) {
    var body = (req && req.body) || {}
    var deviceId = String(body.deviceId || '').trim()
    if (!deviceId) return { ok: false, message: '缺少 deviceId' }
    var devices = (api.getDevices && api.getDevices()) || []
    var idx = -1
    for (var i = 0; i < devices.length; i++) {
      if (String(devices[i].id) === deviceId) {
        idx = i
        break
      }
    }
    if (idx < 0) return { ok: false, message: '设备不存在' }
    var defaultAi = api.getVar('default_ai', '1') === '1'
    var cameras = normalizeList(body.cameras, defaultAi)
    if (cameras.length > 16) return { ok: false, message: '单设备最多 16 路第三方摄像头' }

    var next = devices.slice()
    var row = Object.assign({}, next[idx])
    var pd = Object.assign(
      {},
      row.pluginData && typeof row.pluginData === 'object' ? row.pluginData : {}
    )
    pd.extraCameras = cameras
    row.pluginData = pd
    next[idx] = row
    if (typeof api.saveDevices !== 'function') {
      return { ok: false, message: '无法保存设备（saveDevices 不可用）' }
    }
    await Promise.resolve(api.saveDevices(next))
    return { ok: true, deviceId: deviceId, cameras: cameras }
  })

  api.log('[extra_cameras] routes ready')
}

module.exports = { register }
