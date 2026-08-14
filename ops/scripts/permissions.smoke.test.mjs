/**
 * Smoke tests for permission helpers (plain node:test, no build step).
 * Run: node --test ops/scripts/permissions.smoke.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

function deviceActionPerm(action) {
  return `device.action.${action}`
}

function hasPerm(perms, code) {
  const set = perms instanceof Set ? perms : new Set(perms)
  if (set.has('*') || set.has('admin')) return true
  return set.has(code)
}

function canDeviceAction(user, deviceId, action) {
  const aclMap = user.deviceAcl || {}
  const acl = aclMap[deviceId]
  const restricted = Object.keys(aclMap).length > 0
  if (user.level === 'admin' && !restricted) return true
  const perms = new Set(user.permissions || [])
  if (action === 'view') {
    if (restricted) {
      if (!acl || acl.length === 0) return false
      return acl.includes('view') || acl.includes('*')
    }
    return hasPerm(perms, 'device.view')
  }
  if (!restricted) {
    if (!hasPerm(perms, 'device.view')) return false
    return hasPerm(perms, deviceActionPerm(action))
  }
  if (!acl || acl.length === 0) return false
  if (!acl.includes('view') && !acl.includes('*')) return false
  return acl.includes(action) || acl.includes('*')
}

describe('canDeviceAction', () => {
  it('admin without ACL can control', () => {
    assert.equal(canDeviceAction({ level: 'admin', permissions: [], deviceAcl: {} }, 'd1', 'pause'), true)
  })

  it('operator without ACL uses global device.action.*', () => {
    const u = {
      level: 'operator',
      permissions: ['device.view', 'device.action.pause', 'device.action.jog'],
      deviceAcl: {}
    }
    assert.equal(canDeviceAction(u, 'd1', 'view'), true)
    assert.equal(canDeviceAction(u, 'd1', 'pause'), true)
    assert.equal(canDeviceAction(u, 'd1', 'jog'), true)
  })

  it('viewer cannot control', () => {
    const u = { level: 'viewer', permissions: ['device.view'], deviceAcl: {} }
    assert.equal(canDeviceAction(u, 'd1', 'pause'), false)
  })

  it('restricted ACL limits devices', () => {
    const u = {
      level: 'operator',
      permissions: ['device.view', 'device.action.pause', 'device.action.jog'],
      deviceAcl: { d1: ['view', 'pause'] }
    }
    assert.equal(canDeviceAction(u, 'd1', 'pause'), true)
    assert.equal(canDeviceAction(u, 'd1', 'jog'), false)
    assert.equal(canDeviceAction(u, 'd2', 'view'), false)
  })
})
