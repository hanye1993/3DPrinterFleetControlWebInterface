/**
 * Per-device capability probe for plugins (control / files / camera / gcode / moonraker).
 */
export type DeviceControlCaps = {
  pause: boolean
  resume: boolean
  cancel: boolean
  emergency_stop: boolean
  home: boolean
  jog: boolean
  set_temp: boolean
  set_fan: boolean
  set_speed: boolean
  set_flow: boolean
  set_z_offset: boolean
  set_chamber_temp: boolean
  extrude: boolean
  retract: boolean
  restart: boolean
  firmware_restart: boolean
  print_file: boolean
  load_filament: boolean
  unload_filament: boolean
}

export type DeviceCapabilities = {
  deviceId: string
  brand: string
  tech: string
  connectionMode: string
  control: DeviceControlCaps
  files: boolean
  printRemote: boolean
  camera: boolean
  gcode: boolean
  /** Full Moonraker HTTP proxy (GET/POST/DELETE on printer baseUrl) */
  moonrakerProxy: boolean
  resin: boolean
  notes?: string[]
}

type DeviceRow = Record<string, unknown>

function moonrakerLike(brand: string, mode: string, d?: DeviceRow): boolean {
  if (brand === 'klipper' || brand === 'qidi') return true
  if (brand === 'creality' && mode !== 'cloud') return true
  if (brand === 'snapmaker' && String(d?.snapmakerApi || '') === 'moonraker') return true
  return false
}

function hasLanHost(d: DeviceRow): boolean {
  const host =
    (typeof d.bambuHost === 'string' && d.bambuHost.trim()) ||
    (typeof d.baseUrl === 'string' && d.baseUrl.trim()) ||
    ''
  return Boolean(host)
}

/** Cloud device may still expose LAN if IP + LAN access code are stored. */
function hasLanAccessHint(d: DeviceRow): boolean {
  if (typeof d.bambuLanSecretKey === 'string' && d.bambuLanSecretKey.trim()) return true
  if (typeof d.bambuLanAccessCode === 'string' && d.bambuLanAccessCode.trim()) return true
  const pd = d.pluginData
  if (pd && typeof pd === 'object' && !Array.isArray(pd)) {
    const code = (pd as Record<string, unknown>).bambuLanAccessCode
    if (typeof code === 'string' && code.trim()) return true
  }
  return false
}

function bambuLanCapable(d: DeviceRow, mode: string): boolean {
  if (!hasLanHost(d)) return false
  if (mode !== 'cloud') return true
  return hasLanAccessHint(d)
}

function noneControl(): DeviceControlCaps {
  return {
    pause: false,
    resume: false,
    cancel: false,
    emergency_stop: false,
    home: false,
    jog: false,
    set_temp: false,
    set_fan: false,
    set_speed: false,
    set_flow: false,
    set_z_offset: false,
    set_chamber_temp: false,
    extrude: false,
    retract: false,
    restart: false,
    firmware_restart: false,
    print_file: false,
    load_filament: false,
    unload_filament: false
  }
}

export function computeDeviceCapabilities(d: DeviceRow | null | undefined): DeviceCapabilities {
  const deviceId = String(d?.id || '')
  const brand = String(d?.brand || '')
  const tech = String(d?.tech || 'fdm')
  const mode = String(d?.connectionMode || 'lan')
  const notes: string[] = []

  const none = noneControl()

  if (!d) {
    return {
      deviceId,
      brand,
      tech,
      connectionMode: mode,
      control: none,
      files: false,
      printRemote: false,
      camera: false,
      gcode: false,
      moonrakerProxy: false,
      resin: tech === 'resin',
      notes: ['设备不存在']
    }
  }

  let control = { ...none }
  let files = false
  let printRemote = false
  let camera = false
  let gcode = false
  let moonrakerProxy = false

  if (moonrakerLike(brand, mode, d)) {
    control = {
      pause: true,
      resume: true,
      cancel: true,
      emergency_stop: true,
      home: true,
      jog: true,
      set_temp: true,
      set_fan: true,
      set_speed: true,
      set_flow: true,
      set_z_offset: true,
      set_chamber_temp: true,
      extrude: true,
      retract: true,
      restart: true,
      firmware_restart: true,
      print_file: true,
      load_filament: true,
      unload_filament: true
    }
    files = true
    printRemote = true
    camera = true
    gcode = true
    moonrakerProxy = true
    if (brand === 'snapmaker') {
      notes.push('Snapmaker U1：Moonraker 全能力（与 Klipper 通道相同）')
    }
  } else if (brand === 'bambu') {
    const lan = bambuLanCapable(d, mode)
    control = {
      pause: true,
      resume: true,
      cancel: true,
      emergency_stop: true,
      home: true,
      jog: true,
      set_temp: true,
      set_fan: true,
      set_speed: true,
      set_flow: true,
      set_z_offset: false,
      set_chamber_temp: true,
      extrude: true,
      retract: true,
      restart: false,
      firmware_restart: false,
      print_file: lan,
      load_filament: true,
      unload_filament: true
    }
    files = lan
    printRemote = lan
    camera = lan
    gcode = false
    moonrakerProxy = false
    if (mode === 'cloud' && lan) {
      notes.push('云端状态 + 局域网传文件/摄像头（已配置 IP 与局域网访问码）')
    } else if (mode === 'cloud') {
      notes.push(
        '云端拓竹只能看状态/简单控制；若需传文件开打，请在设备详情填写局域网 IP 与访问码（仅局域网+开发者模式）'
      )
    } else if (!hasLanHost(d)) {
      notes.push('缺少局域网 IP，无法 FTPS 传文件/开打')
    }
  } else if (brand === 'elegoo') {
    control = {
      ...none,
      pause: true,
      resume: true,
      cancel: true,
      set_fan: true,
      set_speed: true
    }
    camera = true
    notes.push('爱乐酷 SDCP：任务控制与摄像头；传文件/开打/深控未接入')
  } else if (brand === 'anycubic') {
    if (mode === 'cloud') {
      control = { ...none, pause: true, resume: true, cancel: true }
      notes.push('纵维云端仅暂停/恢复/取消；传文件请改局域网或官方 App')
    } else {
      control = {
        ...none,
        pause: true,
        resume: true,
        cancel: true,
        set_temp: true,
        set_fan: true
      }
      camera = true
      notes.push('纵维 LAN：有限控制与摄像头；传文件/开打未接入')
    }
  } else if (brand === 'flashforge') {
    control = { ...none, pause: true, resume: true, cancel: true }
    notes.push('闪铸：仅任务控制；传文件未接入')
  } else if (brand === 'snapmaker') {
    control = { ...none, pause: true, resume: true, cancel: true }
    camera = true
    notes.push('Snapmaker（旧 Luban）：任务控制与摄像头；传文件未接入。U1 请重新添加以启用 Moonraker')
  } else if (brand === 'creality' && mode === 'cloud') {
    notes.push('创想云：仅状态与有限控制；传文件/深控请改用局域网（Moonraker / 本机 IP）添加')
  } else {
    notes.push('未知品牌能力')
  }

  return {
    deviceId,
    brand,
    tech,
    connectionMode: mode,
    control,
    files,
    printRemote,
    camera,
    gcode,
    moonrakerProxy,
    resin: tech === 'resin',
    notes: notes.length ? notes : undefined
  }
}
