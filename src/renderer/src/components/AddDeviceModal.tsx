import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Table,
  Typography,
  message
} from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { probeMoonraker, probeCreality, probeQidi } from '../adapters'
import { useDeviceStore } from '../stores/deviceStore'
import { isClientMode } from '../api/serverClient'
import * as onboard from '../api/onboardApi'
import {
  cancelLanDiscover,
  pollLanDiscover,
  startLanDiscover,
  type LanDiscoverHit
} from '../api/discoverApi'
import type {
  BambuRegion,
  ConnectionMode,
  DeviceConfig,
  PrinterBrand,
  PrinterTech
} from '../types/printer'
import type { BambuCloudDevice } from '../api/onboardApi'
import { BambuDevModeHelp } from './BambuDevModeHelp'
import { useIsMobile } from '../hooks/useIsMobile'
import { newId } from '../utils/id'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin } from '../plugins/runtime'
import {
  AddDeviceBrandPluginForm,
  AddDevicePluginFields,
  applyAddDeviceFieldCollect,
  buildAddDeviceFormCtx
} from './AddDevicePluginHosts'

type LanHit = {
  host: string
  brand: PrinterBrand
  port: number
  label: string
  name?: string
  baseUrl?: string
  needsCredentials?: boolean
  detail?: string
}

type FormValues = {
  name: string
  brand: string
  model?: string
  baseUrl?: string
  apiKey?: string
  group?: string
  tags?: string
  connectionMode?: string
  bambuDeviceId?: string
  bambuHost?: string
  bambuAccessCode?: string
  bambuRegion?: BambuRegion
  bambuLoginMethod?: 'sms' | 'password'
  bambuAccount?: string
  bambuPassword?: string
  bambuCode?: string
  /** Creality Fluidd user (optional) */
  crealityUser?: string
  crealityPassword?: string
  flashforgeSerial?: string
  flashforgeCheckCode?: string
  snapmakerToken?: string
  /** QIDI Fluidd user (optional) */
  qidiUser?: string
  qidiPassword?: string
  [key: string]: unknown
}


export function AddDeviceModal({
  open,
  onClose,
  tech = 'fdm'
}: {
  open: boolean
  onClose: () => void
  tech?: PrinterTech
}) {
  const storeAdd = useDeviceStore((s) => s.addDevice)
  const isMobile = useIsMobile(768)
  const addDevice = async (device: DeviceConfig, apiKey?: string) => {
    const brandId = String(device.brand || form.getFieldValue('brand') || '')
    const mode = String(
      (device as { connectionMode?: string }).connectionMode ||
        form.getFieldValue('connectionMode') ||
        ''
    )
    const merged = applyAddDeviceFieldCollect(
      form,
      tech,
      brandId,
      mode,
      { ...(device as unknown as Record<string, unknown>) }
    ) as unknown as DeviceConfig
    await storeAdd({ ...merged, tech }, apiKey)
  }
  const [form] = Form.useForm<FormValues>()
  const brand = Form.useWatch('brand', form) as string | undefined
  const connectionMode = Form.useWatch('connectionMode', form) as string | undefined
  const loginMethod = Form.useWatch('bambuLoginMethod', form) as 'sms' | 'password' | undefined
  const [probing, setProbing] = useState(false)
  const [cloudConfirmOpen, setCloudConfirmOpen] = useState(false)
  const [pluginTick, setPluginTick] = useState(0)

  useEffect(() => {
    return getHanyePlugin().on('add-device:change', () => setPluginTick((n) => n + 1))
  }, [])

  const pluginBrands = useMemo(
    () => getHanyePlugin().getAddDeviceBrands(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick, open]
  )
  const pluginBrandDef = useMemo(
    () => (brand ? getHanyePlugin().getAddDeviceBrand(brand) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brand, pluginTick]
  )
  const isPluginBrand = Boolean(pluginBrandDef)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      brand: tech === 'resin' ? 'elegoo' : 'klipper',
      connectionMode: 'lan'
    })
  }, [open, tech, form])

  // cloud login state
  const [needCode, setNeedCode] = useState(false)
  const [codeVia, setCodeVia] = useState<'sms' | 'email'>('sms')
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [cloudToken, setCloudToken] = useState<string | null>(null)
  const [cloudUid, setCloudUid] = useState<string | null>(null)
  const [cloudDevices, setCloudDevices] = useState<BambuCloudDevice[]>([])
  const [selectedDevIds, setSelectedDevIds] = useState<string[]>([])
  const [loggingIn, setLoggingIn] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)

  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{
    scanned: number
    total: number
    found: number
    message?: string
  } | null>(null)
  const [lanHits, setLanHits] = useState<LanHit[]>([])

  useEffect(() => {
    if (!open) {
      if (isClientMode()) {
        void cancelLanDiscover().catch(() => undefined)
      } else {
        void window.electronAPI?.discover?.cancelLan()
      }
      setScanning(false)
      setScanProgress(null)
      return
    }
    if (isClientMode()) return
    const unsub = window.electronAPI?.discover?.onLanProgress((p) => {
      setScanProgress({
        scanned: p.scanned,
        total: p.total,
        found: p.found,
        message: p.message
      })
    })
    return () => {
      unsub?.()
    }
  }, [open])

  const scanBrands = useMemo(
    (): PrinterBrand[] =>
      tech === 'resin'
        ? ['creality', 'elegoo', 'anycubic']
        : ['klipper', 'creality', 'elegoo', 'anycubic', 'snapmaker', 'flashforge', 'qidi', 'bambu'],
    [tech]
  )

  const startLanScan = () => {
    void (async () => {
      setScanning(true)
      setLanHits([])
      setScanProgress({ scanned: 0, total: 0, found: 0, message: '准备扫描…' })
      if (isClientMode()) {
        try {
          await startLanDiscover(scanBrands)
          const final = await pollLanDiscover((p) => {
            setScanProgress({
              scanned: p.scanned,
              total: p.total,
              found: p.found,
              message: p.message
            })
          })
          setLanHits((final.hits || []) as LanHit[])
          if (final.phase === 'done') {
            message.success(final.message || `发现 ${final.hits?.length || 0} 台`)
          } else {
            message.warning(final.message || '扫描失败')
          }
        } catch (e) {
          message.error(e instanceof Error ? e.message : '扫描失败')
        } finally {
          setScanning(false)
        }
        return
      }
      const res = await window.electronAPI?.discover?.scanLan({ brands: scanBrands })
      setScanning(false)
      if (!res) {
        message.error('扫描接口不可用')
        return
      }
      setLanHits((res.hits || []) as LanHit[])
      if (res.ok) {
        message.success(res.message || `发现 ${res.hits?.length || 0} 台`)
      } else {
        message.warning(res.message || '扫描失败')
      }
    })()
  }

  const applyLanHit = (hit: LanHit) => {
    const host = hit.host
    const suggestedName = hit.name || `${hit.label} ${host}`
    form.setFieldsValue({
      brand: hit.brand,
      connectionMode: 'lan',
      name: form.getFieldValue('name') || suggestedName,
      baseUrl:
        hit.brand === 'bambu' || hit.brand === 'elegoo' || hit.brand === 'anycubic'
          ? host
          : hit.brand === 'flashforge' || hit.brand === 'snapmaker'
            ? host
            : hit.baseUrl || `http://${host}:${hit.port}`,
      bambuHost: hit.brand === 'bambu' ? host : undefined
    })
    message.success(
      hit.needsCredentials
        ? `已填入 ${hit.label}（${host}），请继续填写访问码/序列号等`
        : `已填入 ${hit.label}（${host}）`
    )
  }

  const reset = () => {
    form.resetFields()
    setNeedCode(false)
    setCodeVia('sms')
    setCodeCooldown(0)
    setCloudToken(null)
    setCloudUid(null)
    setCloudDevices([])
    setSelectedDevIds([])
    setLanHits([])
    setScanProgress(null)
    setScanning(false)
    void (isClientMode() ? cancelLanDiscover() : window.electronAPI?.discover?.cancelLan())
  }

  const startCooldown = () => {
    setCodeCooldown(60)
    const timer = window.setInterval(() => {
      setCodeCooldown((s) => {
        if (s <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  const parseTags = (tags?: string) =>
    tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined

  const modelOf = (values: FormValues) => values.model?.trim() || undefined

  const saveKlipper = async (values: FormValues) => {
    const id = newId()
    const secretKey = `klipper:${id}`
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'klipper',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: values.baseUrl?.trim(),
      secretKey,
      createdAt: new Date().toISOString()
    }

    if (values.baseUrl) {
      setProbing(true)
      const result = isClientMode()
        ? await onboard.probeMoonraker(values.baseUrl.trim(), values.apiKey)
        : await probeMoonraker(values.baseUrl.trim(), values.apiKey)
      setProbing(false)
      if (!result.ok) {
        message.error(`连接失败: ${result.message}`)
        return
      }
      message.success(result.message)
    }

    await addDevice(device, values.apiKey)
    message.success('设备已添加')
    reset()
    onClose()
  }

  const saveCreality = async (values: FormValues) => {
    const id = newId()
    const secretKey = `creality:${id}`
    setProbing(true)
    const result = isClientMode()
      ? await onboard.probeCreality(values.baseUrl!.trim(), {
          apiKey: values.apiKey,
          username: values.crealityUser,
          password: values.crealityPassword
        })
      : await probeCreality(values.baseUrl!.trim(), {
          apiKey: values.apiKey,
          username: values.crealityUser,
          password: values.crealityPassword
        })
    setProbing(false)
    if (!result.ok || !result.baseUrl) {
      message.error(`连接失败: ${result.message}`)
      return
    }
    message.success(result.message)

    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'creality',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: result.baseUrl,
      secretKey,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device, result.token || values.apiKey)
    message.success('创想三维设备已添加')
    reset()
    onClose()
  }

  const saveAnycubic = async (values: FormValues) => {
    const id = newId()
    const host = values.baseUrl!.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    setProbing(true)
    const probeId = `probe-anycubic-${id}`
    const res = isClientMode()
      ? await onboard.anycubicProbeLan(host)
      : await (async () => {
          const r = await window.electronAPI?.anycubic?.lan.connect({ connectionId: probeId, host })
          await window.electronAPI?.anycubic?.lan.disconnect(probeId)
          return r
        })()
    setProbing(false)
    if (!res?.ok) {
      message.error(`连接失败: ${res?.message || '局域网握手失败，请确认已开启 LAN Mode'}`)
      return
    }
    message.success('纵维立方局域网连接成功')
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'anycubic',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: `http://${host}`,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device)
    message.success('纵维立方设备已添加')
    reset()
    onClose()
  }

  const saveBambuLan = async (values: FormValues) => {
    const id = newId()
    const secretKey = `bambu:lan:${id}`
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'bambu',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      secretKey,
      connectionMode: 'lan',
      bambuDeviceId: values.bambuDeviceId?.trim(),
      bambuHost: values.bambuHost?.trim(),
      createdAt: new Date().toISOString()
    }

    setProbing(true)
    const probe = isClientMode()
      ? await onboard.bambuProbeLan(device.bambuDeviceId!, device.bambuHost!, values.bambuAccessCode!.trim())
      : await (async () => {
          const r = await window.electronAPI?.bambu.mqtt.connect({
            connectionId: `probe-${id}`,
            serial: device.bambuDeviceId!,
            mode: 'lan',
            host: device.bambuHost,
            password: values.bambuAccessCode!.trim()
          })
          await window.electronAPI?.bambu.mqtt.disconnect(`probe-${id}`)
          return r
        })()
    setProbing(false)

    if (!probe?.ok) {
      message.error(`局域网连接失败: ${probe?.message || '未知错误'}`)
      return
    }

    await addDevice(device, values.bambuAccessCode!.trim())
    message.success('Bambu 局域网设备已添加')
    reset()
    onClose()
  }

  const doSendCode = async () => {
    const values = await form.validateFields(['bambuRegion', 'bambuAccount'])
    setSendingCode(true)
    try {
      const res = isClientMode()
        ? await onboard.bambuSendCode(values.bambuRegion || 'china', values.bambuAccount!.trim())
        : await window.electronAPI?.bambu.sendCode({
            region: values.bambuRegion || 'china',
            account: values.bambuAccount!.trim()
          })
      if (!res) {
        message.error('发送接口不可用')
        return
      }
      if (res.ok) {
        setNeedCode(true)
        setCodeVia(res.via)
        startCooldown()
        message.success(res.message)
      } else {
        message.error(res.message)
      }
    } finally {
      setSendingCode(false)
    }
  }

  const doCloudLogin = async () => {
    const method = form.getFieldValue('bambuLoginMethod') as 'sms' | 'password'
    if (method === 'sms') {
      await doCloudCodeLogin()
      return
    }
    const values = await form.validateFields(['bambuRegion', 'bambuAccount', 'bambuPassword'])
    setLoggingIn(true)
    try {
      const res = isClientMode()
        ? await onboard.bambuLogin(
            values.bambuRegion || 'china',
            values.bambuAccount!.trim(),
            values.bambuPassword!
          )
        : await window.electronAPI?.bambu.login({
            region: values.bambuRegion || 'china',
            account: values.bambuAccount!.trim(),
            password: values.bambuPassword!
          })
      if (!res) {
        message.error('登录接口不可用')
        return
      }
      if (res.ok) {
        setNeedCode(false)
        await loadCloudDevices(values.bambuRegion || 'china', res.accessToken)
        return
      }
      if (res.needCode) {
        setNeedCode(true)
        setCodeVia(res.via)
        startCooldown()
        message.info(res.message)
        return
      }
      message.error(res.message)
    } finally {
      setLoggingIn(false)
    }
  }

  const doCloudCodeLogin = async () => {
    const values = await form.validateFields(['bambuRegion', 'bambuAccount', 'bambuCode'])
    setLoggingIn(true)
    try {
      const res = isClientMode()
        ? await onboard.bambuLoginWithCode(
            values.bambuRegion || 'china',
            values.bambuAccount!.trim(),
            values.bambuCode!.trim()
          )
        : await window.electronAPI?.bambu.loginWithCode({
            region: values.bambuRegion || 'china',
            account: values.bambuAccount!.trim(),
            code: values.bambuCode!.trim()
          })
      if (!res) {
        message.error('登录接口不可用')
        return
      }
      if (res.ok) {
        setNeedCode(false)
        await loadCloudDevices(values.bambuRegion || 'china', res.accessToken)
        return
      }
      message.error(res.message)
    } finally {
      setLoggingIn(false)
    }
  }

  const loadCloudDevices = async (region: BambuRegion, token: string) => {
    setCloudToken(token)
    const res = isClientMode()
      ? await onboard.bambuFetchDevices(region, token)
      : await window.electronAPI?.bambu.fetchDevices({ region, token })
    if (!res?.ok || !res.uid) {
      message.error(res?.message || '获取设备列表失败')
      return
    }
    setCloudUid(res.uid)
    setCloudDevices(res.devices)
    setSelectedDevIds(res.devices.filter((d) => d.online).map((d) => d.dev_id))
    message.success(`已登录，发现 ${res.devices.length} 台设备`)
  }

  const saveCloudDevices = async () => {
    if (!cloudToken || !cloudUid) {
      message.error('请先登录 Bambu 账号')
      return
    }
    if (!selectedDevIds.length) {
      message.error('请至少选择一台设备')
      return
    }
    const values = form.getFieldsValue()
    const region = (values.bambuRegion || 'china') as BambuRegion
    const tokenKey = `bambu:cloud:token:${region}`
    if (!isClientMode()) {
      await window.electronAPI?.secrets.set(tokenKey, cloudToken)
    }

    let added = 0
    for (const devId of selectedDevIds) {
      const cloudDev = cloudDevices.find((d) => d.dev_id === devId)
      if (!cloudDev) continue
      const id = newId()
      const device: DeviceConfig = {
        id,
        name: cloudDev.name || cloudDev.dev_product_name || cloudDev.dev_id,
        brand: 'bambu',
        model:
          cloudDev.dev_model_name ||
          cloudDev.dev_product_name ||
          modelOf(values) ||
          undefined,
        group: values.group?.trim() || undefined,
        tags: parseTags(values.tags),
        secretKey: tokenKey,
        connectionMode: 'cloud',
        bambuDeviceId: cloudDev.dev_id,
        bambuRegion: region,
        bambuUserId: cloudUid,
        createdAt: new Date().toISOString()
      }
      // token already stored under shared key; pass token so adapter can connect immediately
      await addDevice(device, cloudToken)
      added += 1
    }
    message.success(`已添加 ${added} 台云端设备`)
    reset()
    onClose()
  }

  const saveElegoo = async (values: FormValues) => {
    const id = newId()
    const host = values.baseUrl!.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    setProbing(true)
    const probeId = `probe-elegoo-${id}`
    const res = isClientMode()
      ? await onboard.elegooProbe(host)
      : await (async () => {
          const r = await window.electronAPI?.elegoo?.sdcp.connect({ connectionId: probeId, host })
          await window.electronAPI?.elegoo?.sdcp.disconnect(probeId)
          return r
        })()
    setProbing(false)
    if (!res?.ok) {
      message.error(`连接失败: ${res?.message || '无法连接爱乐库 SDCP (:3030)'}`)
      return
    }
    message.success('爱乐库局域网连接成功')
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'elegoo',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: `http://${host}`,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device)
    message.success('爱乐库设备已添加')
    reset()
    onClose()
  }

  const saveFlashforge = async (values: FormValues) => {
    const id = newId()
    const host = values.baseUrl!.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    const serial = values.flashforgeSerial!.trim()
    const checkCode = values.flashforgeCheckCode!.trim()
    setProbing(true)
    const probe = isClientMode()
      ? await onboard.flashforgeProbe(host, serial, checkCode)
      : await window.electronAPI?.flashforge?.lan.probe({ host, serial, checkCode })
    setProbing(false)
    if (!probe?.ok) {
      message.error(`连接失败: ${probe?.message || '无法连接闪铸 (:8898)'}`)
      return
    }
    const secretKey = `flashforge:${id}:checkCode`
    if (!isClientMode()) {
      await window.electronAPI?.secrets.set(secretKey, checkCode)
    }
    const device: DeviceConfig = {
      id,
      name: values.name.trim() || probe.name || '闪铸打印机',
      brand: 'flashforge',
      model: modelOf(values) || probe.name || undefined,
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: `http://${host}`,
      secretKey,
      flashforgeSerial: serial,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device, checkCode)
    message.success('闪铸设备已添加')
    reset()
    onClose()
  }

  const saveSnapmaker = async (values: FormValues) => {
    const id = newId()
    const host = values.baseUrl!.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    const token = values.snapmakerToken?.trim() || ''
    setProbing(true)
    const probe = isClientMode()
      ? await onboard.snapmakerProbe(host, token || undefined)
      : await window.electronAPI?.snapmaker?.lan.probe({
          host,
          token: token || undefined
        })
    setProbing(false)
    if (!probe?.ok) {
      message.error(`连接失败: ${probe?.message || '无法连接 Snapmaker (:8080)'}`)
      return
    }
    const secretKey = `snapmaker:${id}:token`
    if (probe.token && !isClientMode()) {
      await window.electronAPI?.secrets.set(secretKey, probe.token)
    }
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'snapmaker',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: `http://${host}`,
      secretKey,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device, probe.token || token)
    message.success('Snapmaker 设备已添加')
    reset()
    onClose()
  }

  const saveQidi = async (values: FormValues) => {
    const id = newId()
    const secretKey = `qidi:${id}`
    setProbing(true)
    const result = isClientMode()
      ? await onboard.probeQidi(values.baseUrl!.trim(), {
          apiKey: values.apiKey,
          username: values.qidiUser,
          password: values.qidiPassword
        })
      : await probeQidi(values.baseUrl!.trim(), {
          apiKey: values.apiKey,
          username: values.qidiUser,
          password: values.qidiPassword
        })
    setProbing(false)
    if (!result.ok || !result.baseUrl) {
      message.error(`连接失败: ${result.message}`)
      return
    }
    message.success(result.message)
    const device: DeviceConfig = {
      id,
      name: values.name.trim(),
      brand: 'qidi',
      model: modelOf(values),
      group: values.group?.trim() || undefined,
      tags: parseTags(values.tags),
      baseUrl: result.baseUrl,
      secretKey,
      connectionMode: 'lan',
      createdAt: new Date().toISOString()
    }
    await addDevice(device, result.token || values.apiKey)
    message.success('启迪设备已添加')
    reset()
    onClose()
  }

  const onOk = async () => {
    try {
      const values = await form.validateFields()
      const brandId = String(values.brand || '')

      // Plugin-registered brand: custom submit
      const pBrand = getHanyePlugin().getAddDeviceBrand(brandId)
      if (pBrand && typeof pBrand.submit === 'function') {
        setProbing(true)
        try {
          const ctx = buildAddDeviceFormCtx(form, tech, brandId, String(values.connectionMode || ''))
          const result = await pBrand.submit(ctx)
          if (!result?.device) {
            message.warning('插件未返回设备数据')
            return
          }
          const payload = { ...result.device, brand: result.device.brand || brandId, tech }
          const secret =
            result.secret ||
            (typeof payload.secret === 'string' ? payload.secret : undefined) ||
            (typeof payload.apiKey === 'string' ? payload.apiKey : undefined) ||
            (typeof payload.accessCode === 'string' ? payload.accessCode : undefined)
          const device = {
            ...payload,
            id: String(payload.id || newId()),
            name: String(payload.name || ''),
            brand: String(payload.brand || brandId),
            tech,
            createdAt: String(payload.createdAt || new Date().toISOString())
          } as DeviceConfig
          if (!device.name) {
            message.error('设备名称不能为空')
            return
          }
          await addDevice(device, secret)
          message.success(`已添加：${pBrand.label}`)
          reset()
          onClose()
        } finally {
          setProbing(false)
        }
        return
      }

      if (values.brand === 'klipper') {
        await saveKlipper(values)
        return
      }
      if (values.brand === 'creality') {
        await saveCreality(values)
        return
      }
      if (values.brand === 'elegoo') {
        await saveElegoo(values)
        return
      }
      if (values.brand === 'anycubic') {
        await saveAnycubic(values)
        return
      }
      if (values.brand === 'flashforge') {
        await saveFlashforge(values)
        return
      }
      if (values.brand === 'snapmaker') {
        await saveSnapmaker(values)
        return
      }
      if (values.brand === 'qidi') {
        await saveQidi(values)
        return
      }
      if (values.brand === 'bambu' && values.connectionMode === 'lan') {
        await saveBambuLan(values)
        return
      }
      // bambu cloud — require confirmation then save selected
      if (!cloudToken) {
        message.warning(
          pBrand
            ? '请实现插件 submit，或先完成内置品牌流程'
            : '请先登录 Bambu Lab 账号并选择设备'
        )
        return
      }
      setCloudConfirmOpen(true)
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(e instanceof Error ? e.message : '添加失败')
    }
  }

  const cloudColumns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        render: (_: unknown, r: BambuCloudDevice) =>
          r.name || r.dev_product_name || r.dev_id
      },
      {
        title: '型号',
        dataIndex: 'dev_product_name',
        width: 120,
        render: (v: string, r: BambuCloudDevice) => v || r.dev_model_name || '--'
      },
      {
        title: '序列号',
        dataIndex: 'dev_id',
        ellipsis: true
      },
      {
        title: '在线',
        dataIndex: 'online',
        width: 70,
        render: (v: boolean) => (v ? '是' : '否')
      }
    ],
    []
  )

  return (
    <>
      <Modal
        title={tech === 'resin' ? '添加光固化设备' : '添加 FDM 设备'}
        open={open}
        onCancel={() => {
          reset()
          onClose()
        }}
        onOk={() => void onOk()}
        confirmLoading={probing || loggingIn}
        destroyOnHidden
        okText={brand === 'bambu' && connectionMode === 'cloud' ? '添加所选设备' : '添加'}
        cancelText="取消"
        width={isMobile ? '100%' : 640}
        centered={!isMobile}
        style={isMobile ? { top: 8, maxWidth: '100vw', margin: 0, paddingBottom: 0 } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'min(72dvh, 72vh)' : 'min(62vh, 560px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            paddingRight: 4
          }
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            brand: tech === 'resin' ? 'elegoo' : 'klipper',
            connectionMode: 'lan',
            bambuRegion: 'china',
            bambuLoginMethod: 'sms'
          }}
        >
          <PluginSlot name="device.add" replace>
          <PluginSlot name="device.add.before" />
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={tech === 'resin' ? '光固化工作区' : 'FDM 工作区'}
            description={
              tech === 'resin'
                ? '添加的设备只会出现在「光固化」列表，与 FDM 功能隔离。'
                : '添加的设备只会出现在「FDM」列表，与光固化功能隔离。'
            }
          />

          <PluginSlot name="device.add.scan.before" />
          <div style={{ marginBottom: 16 }}>
            <Space wrap style={{ marginBottom: 8 }}>
              <Button
                type="default"
                icon={<SearchOutlined />}
                loading={scanning}
                onClick={startLanScan}
              >
                扫描局域网打印机
              </Button>
              {scanning ? (
                <Button
                  danger
                  onClick={() => {
                    void window.electronAPI?.discover?.cancelLan()
                  }}
                >
                  停止
                </Button>
              ) : null}
            </Space>
            {scanning || scanProgress ? (
              <div style={{ marginBottom: 8 }}>
                <Progress
                  percent={
                    scanProgress && scanProgress.total
                      ? Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100))
                      : scanning
                        ? 0
                        : 100
                  }
                  size="small"
                  status={scanning ? 'active' : 'normal'}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {scanProgress?.message ||
                    (scanProgress
                      ? `已扫描 ${scanProgress.scanned}/${scanProgress.total}，发现 ${scanProgress.found} 台`
                      : '')}
                </Typography.Text>
              </div>
            ) : null}
            {lanHits.length ? (
              <Table
                size="small"
                rowKey={(r) => `${r.host}:${r.port}:${r.brand}`}
                pagination={false}
                scroll={{ y: 160 }}
                dataSource={lanHits}
                columns={[
                  { title: 'IP', dataIndex: 'host', width: 120 },
                  { title: '类型', dataIndex: 'label', width: 130 },
                  {
                    title: '端口',
                    dataIndex: 'port',
                    width: 64
                  },
                  {
                    title: '备注',
                    dataIndex: 'detail',
                    ellipsis: true,
                    render: (v: string | undefined, r: LanHit) =>
                      v || (r.needsCredentials ? '需补充凭据' : r.name || '—')
                  },
                  {
                    title: '',
                    width: 72,
                    render: (_: unknown, r: LanHit) => (
                      <Button type="link" size="small" onClick={() => applyLanHit(r)}>
                        选用
                      </Button>
                    )
                  }
                ]}
              />
            ) : null}
            <PluginSlot name="device.add.scan.after" />
          </div>

          {brand === 'bambu' && connectionMode === 'cloud' ? null : (
            <Form.Item name="name" label="设备名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input
                placeholder={
                  tech === 'resin' ? '例如：Saturn 4 Ultra' : '例如：工作室 X1C / K1'
                }
              />
            </Form.Item>
          )}

          <PluginSlot name="device.add.brand.before" />
          <Form.Item name="brand" label="品牌" rules={[{ required: true }]}>
            <Radio.Group
              onChange={(e) => {
                setNeedCode(false)
                setCloudToken(null)
                setCloudDevices([])
                const nextBrand = String(e.target.value || '')
                const def = getHanyePlugin().getAddDeviceBrand(nextBrand)
                const defaultConn =
                  def?.connections?.find((c) => c.default)?.id ||
                  def?.connections?.[0]?.id ||
                  'lan'
                form.setFieldValue('connectionMode', defaultConn)
              }}
            >
              {tech === 'fdm' ? <Radio.Button value="klipper">Klipper</Radio.Button> : null}
              <Radio.Button value="creality">创想三维</Radio.Button>
              <Radio.Button value="elegoo">爱乐库</Radio.Button>
              <Radio.Button value="anycubic">纵维立方</Radio.Button>
              {tech === 'fdm' ? <Radio.Button value="snapmaker">Snapmaker</Radio.Button> : null}
              {tech === 'fdm' ? <Radio.Button value="flashforge">闪铸</Radio.Button> : null}
              {tech === 'fdm' ? <Radio.Button value="qidi">启迪</Radio.Button> : null}
              {tech === 'fdm' ? <Radio.Button value="bambu">Bambu Lab</Radio.Button> : null}
              {pluginBrands.map((b) => (
                <Radio.Button key={b.id} value={b.id}>
                  {b.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <PluginSlot name="device.add.brand.after" />

          {isPluginBrand && pluginBrandDef?.connections?.length ? (
            <>
              <Form.Item name="connectionMode" label="连接方式" rules={[{ required: true }]}>
                <Radio.Group>
                  {pluginBrandDef.connections.map((c) => (
                    <Radio.Button key={c.id} value={c.id}>
                      {c.label}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              </Form.Item>
              <PluginSlot name="device.add.mode.after" />
            </>
          ) : null}

          {isPluginBrand ? (
            <AddDeviceBrandPluginForm
              form={form}
              tech={tech}
              brand={String(brand || '')}
              connectionMode={connectionMode}
              brandDef={pluginBrandDef}
            />
          ) : null}

          <PluginSlot name="device.add.form.before" />
          <PluginSlot
            name="device.add.form"
            context={{ tech, brand: brand || '', connectionMode: connectionMode || '' }}
          />

          {isPluginBrand ? null : brand === 'klipper' ? (
            <>
              <Form.Item
                name="baseUrl"
                label="Moonraker API 地址"
                rules={[{ required: true, message: '请输入地址' }]}
                extra="例如 http://192.168.1.50:7125 ，勿直接暴露到公网"
              >
                <Input placeholder="http://host:7125" />
              </Form.Item>
              <Form.Item
                name="apiKey"
                label="API Key"
                extra="可在 Moonraker 配置或通过 /access/api_key 获取；将加密存储"
              >
                <Input.Password placeholder="可选，若启用鉴权则必填" />
              </Form.Item>
            </>
          ) : brand === 'creality' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="创想三维局域网"
                description="浏览器里 Fluidd 地址一般是 http://打印机IP:4408 。本应用会按 Moonraker 协议连接该地址（并自动尝试 7125）。若 Fluidd 需要登录，请填写下方账号密码。仅支持局域网，不提供创想云登录。"
              />
              <Form.Item name="connectionMode" hidden initialValue="lan">
                <Input />
              </Form.Item>
              <Form.Item
                name="baseUrl"
                label="Fluidd / 打印机地址"
                rules={[{ required: true, message: '请输入地址' }]}
                extra="支持 192.168.1.178 或 http://192.168.1.178:4408"
              >
                <Input placeholder="http://192.168.1.178:4408" />
              </Form.Item>
              <Form.Item name="crealityUser" label="Fluidd 用户名" extra="若网页要登录则填写">
                <Input placeholder="可选" autoComplete="username" />
              </Form.Item>
              <Form.Item name="crealityPassword" label="Fluidd 密码">
                <Input.Password placeholder="可选" autoComplete="current-password" />
              </Form.Item>
              <Form.Item name="apiKey" label="API Key" extra="也可用 Moonraker API Key 代替账号密码">
                <Input.Password placeholder="可选" />
              </Form.Item>
            </>
          ) : brand === 'elegoo' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="爱乐库局域网（SDCP）"
                description="适用于 Centauri Carbon / Mars / Saturn 等。请填写打印机局域网 IP。爱乐库暂无公开稳定的第三方云账号 API，请用局域网。"
              />
              <Form.Item
                name="baseUrl"
                label="打印机 IP"
                rules={[{ required: true, message: '请输入 IP' }]}
                extra="例如 192.168.1.50"
              >
                <Input placeholder="192.168.1.50" />
              </Form.Item>
            </>
          ) : brand === 'anycubic' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="纵维立方局域网模式"
                description="适用于 Kobra 3 / S1 / ACE 等。请先在打印机「设置 → 网络 → LAN Mode」开启局域网模式，再填写 IP。仅支持局域网，不提供纵维云登录。"
              />
              <Form.Item name="connectionMode" hidden initialValue="lan">
                <Input />
              </Form.Item>
              <Form.Item
                name="baseUrl"
                label="打印机 IP"
                rules={[{ required: true, message: '请输入 IP' }]}
                extra="例如 192.168.1.60"
              >
                <Input placeholder="192.168.1.60" />
              </Form.Item>
            </>
          ) : brand === 'flashforge' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="闪铸局域网"
                description="FlashCloud 暂无可用的第三方官方账号接口，请用局域网。在打印机屏幕开启局域网模式，填写 IP、序列号与 CheckCode（Printer ID / 校验码）。"
              />
              <Form.Item
                name="baseUrl"
                label="打印机 IP"
                rules={[{ required: true, message: '请输入 IP' }]}
                extra="HTTP 端口 8898"
              >
                <Input placeholder="192.168.1.80" />
              </Form.Item>
              <Form.Item
                name="flashforgeSerial"
                label="序列号"
                rules={[{ required: true, message: '请输入序列号' }]}
              >
                <Input placeholder="SN 序列号" />
              </Form.Item>
              <Form.Item
                name="flashforgeCheckCode"
                label="CheckCode"
                rules={[{ required: true, message: '请输入 CheckCode' }]}
                extra="屏幕局域网信息中的校验码，将加密存储"
              >
                <Input.Password placeholder="CheckCode" />
              </Form.Item>
            </>
          ) : brand === 'snapmaker' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Snapmaker 局域网"
                description="官方云账号暂无可用第三方 API，请用局域网（端口 8080）。首次连接若未填 Token，需在打印机触摸屏确认授权；成功后 Token 会自动保存。"
              />
              <Form.Item
                name="baseUrl"
                label="打印机 IP"
                rules={[{ required: true, message: '请输入 IP' }]}
              >
                <Input placeholder="192.168.1.90" />
              </Form.Item>
              <Form.Item
                name="snapmakerToken"
                label="Token（可选）"
                extra="已有授权 Token 可直接填写；留空则发起连接并在屏幕确认"
              >
                <Input.Password placeholder="可选" />
              </Form.Item>
            </>
          ) : brand === 'qidi' ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="启迪局域网（Fluidd / Moonraker）"
                description="QIDI Link 云账号暂无可用第三方 API，请用局域网。Fluidd 常见端口 10088（也可填 IP，会自动尝试 10088 / 7125）。若启用了 Fluidd 账号，请填 API Key 或用户名密码。"
              />
              <Form.Item
                name="baseUrl"
                label="打印机地址"
                rules={[{ required: true, message: '请输入地址' }]}
                extra="例如 192.168.1.50 或 http://192.168.1.50:10088"
              >
                <Input placeholder="192.168.1.50:10088" />
              </Form.Item>
              <Form.Item name="qidiUser" label="Fluidd 用户名">
                <Input placeholder="可选" autoComplete="username" />
              </Form.Item>
              <Form.Item name="qidiPassword" label="Fluidd 密码">
                <Input.Password placeholder="可选" autoComplete="current-password" />
              </Form.Item>
              <Form.Item
                name="apiKey"
                label="API Key"
                extra="Fluidd → 设置 → 身份验证；也可代替账号密码"
              >
                <Input.Password placeholder="可选" />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="connectionMode" label="网络模式" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'lan', label: '局域网 MQTT（推荐）' },
                    { value: 'cloud', label: 'Bambu 官方账号（云端）' }
                  ]}
                  onChange={() => {
                    setNeedCode(false)
                    setCloudToken(null)
                    setCloudDevices([])
                  }}
                />
              </Form.Item>
              <PluginSlot name="device.add.mode.after" />

              {connectionMode === 'lan' ? (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="新固件控制：仅局域网 + 开发者模式"
                    description={<BambuDevModeHelp />}
                  />
                  <Form.Item
                    name="bambuHost"
                    label="打印机 IP"
                    rules={[{ required: true, message: '请输入 IP' }]}
                  >
                    <Input placeholder="192.168.1.100" />
                  </Form.Item>
                  <Form.Item
                    name="bambuDeviceId"
                    label="设备序列号"
                    rules={[{ required: true, message: '请输入序列号' }]}
                    extra="打印机屏幕或 Bambu Handy 中可查看"
                  >
                    <Input placeholder="例如 01P00A000000000" />
                  </Form.Item>
                  <Form.Item
                    name="bambuAccessCode"
                    label="局域网访问码"
                    rules={[{ required: true, message: '请输入访问码' }]}
                  >
                    <Input.Password placeholder="Access Code" />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="云端模式"
                    description={
                      <div>
                        <div>中国区推荐手机号短信验证码登录；国际区可用邮箱+密码。令牌加密保存在本机。</div>
                        <div style={{ marginTop: 8 }}>
                          新固件下云端第三方<strong>写控制</strong>通常仍会被 ACS
                          拦截；若要风扇/加热/速度等控制，请改用「局域网 MQTT」并开启「仅局域网 +
                          开发者模式」。
                        </div>
                      </div>
                    }
                  />
                  <Form.Item name="bambuRegion" label="账号区域" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'china', label: '中国区（bambulab.cn）' },
                        { value: 'global', label: '国际区（bambulab.com）' }
                      ]}
                      onChange={(v) => {
                        form.setFieldValue('bambuLoginMethod', v === 'china' ? 'sms' : 'password')
                        setNeedCode(false)
                        setCloudToken(null)
                        setCloudDevices([])
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="bambuLoginMethod" label="登录方式" rules={[{ required: true }]}>
                    <Radio.Group
                      onChange={() => {
                        setNeedCode(false)
                        form.setFieldValue('bambuCode', undefined)
                      }}
                    >
                      <Radio.Button value="sms">手机短信</Radio.Button>
                      <Radio.Button value="password">账号密码</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item
                    name="bambuAccount"
                    label={loginMethod === 'sms' ? '手机号' : '手机号 / 邮箱'}
                    rules={[
                      { required: true, message: '请输入账号' },
                      ...(loginMethod === 'sms'
                        ? [
                            {
                              pattern: /^(\+?86)?1\d{10}$/,
                              message: '请输入有效的中国大陆手机号'
                            }
                          ]
                        : [])
                    ]}
                  >
                    <Input
                      placeholder={loginMethod === 'sms' ? '13800138000' : '手机号或邮箱'}
                      autoComplete="username"
                    />
                  </Form.Item>

                  {loginMethod === 'password' && !needCode ? (
                    <Form.Item
                      name="bambuPassword"
                      label="密码"
                      rules={[{ required: !cloudToken, message: '请输入密码' }]}
                    >
                      <Input.Password placeholder="账号密码" autoComplete="current-password" />
                    </Form.Item>
                  ) : null}

                  {(loginMethod === 'sms' || needCode) && (
                    <Form.Item
                      label={codeVia === 'sms' || loginMethod === 'sms' ? '短信验证码' : '邮箱验证码'}
                      required
                      extra={
                        loginMethod === 'sms'
                          ? '点击「获取验证码」后查收手机短信'
                          : '官方已要求二次验证，请填写收到的验证码'
                      }
                    >
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item
                          name="bambuCode"
                          noStyle
                          rules={[{ required: true, message: '请输入验证码' }]}
                        >
                          <Input placeholder="6 位验证码" maxLength={8} />
                        </Form.Item>
                        <Button
                          loading={sendingCode}
                          disabled={codeCooldown > 0}
                          onClick={() => void doSendCode()}
                        >
                          {codeCooldown > 0 ? `${codeCooldown}s` : '获取验证码'}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                  )}

                  <Space style={{ marginBottom: 16 }} wrap>
                    {loginMethod === 'sms' || needCode ? (
                      <>
                        <Button type="primary" loading={loggingIn} onClick={() => void doCloudCodeLogin()}>
                          {cloudToken ? '重新登录' : '验证并登录'}
                        </Button>
                        {needCode && loginMethod === 'password' ? (
                          <Button
                            type="link"
                            onClick={() => {
                              setNeedCode(false)
                              form.setFieldValue('bambuCode', undefined)
                            }}
                          >
                            返回密码登录
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button type="primary" loading={loggingIn} onClick={() => void doCloudLogin()}>
                        {cloudToken ? '重新登录' : '登录并拉取设备'}
                      </Button>
                    )}
                  </Space>

                  {cloudDevices.length > 0 ? (
                    <>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                        选择要添加的设备（可多选）
                      </Typography.Text>
                      <Table
                        size="small"
                        rowKey="dev_id"
                        pagination={false}
                        dataSource={cloudDevices}
                        columns={cloudColumns}
                        scroll={{ y: 220 }}
                        rowSelection={{
                          selectedRowKeys: selectedDevIds,
                          onChange: (keys) => setSelectedDevIds(keys as string[])
                        }}
                        style={{ marginBottom: 16 }}
                      />
                      <Checkbox
                        checked={selectedDevIds.length === cloudDevices.length}
                        indeterminate={
                          selectedDevIds.length > 0 && selectedDevIds.length < cloudDevices.length
                        }
                        onChange={(e) => {
                          setSelectedDevIds(
                            e.target.checked ? cloudDevices.map((d) => d.dev_id) : []
                          )
                        }}
                      >
                        全选
                      </Checkbox>
                    </>
                  ) : null}
                </>
              )}
            </>
          )}
          <PluginSlot name="device.add.form.after" />

          <Form.Item
            name="model"
            label="机型"
            extra="批量导入打印要求同品牌同机型；例如 X1C、K1 Max、Ender-3 V3"
          >
            <Input placeholder="例如：K1 Max / X1C / Voron 2.4" />
          </Form.Item>
          <Form.Item name="group" label="分组">
            <Input placeholder="例如：一楼工作室" />
          </Form.Item>
          <Form.Item name="tags" label="标签" extra="多个标签用英文逗号分隔">
            <Input placeholder="PLA, 高速" />
          </Form.Item>

          <PluginSlot name="device.add.fields" />
          <AddDevicePluginFields
            form={form}
            tech={tech}
            brand={String(brand || '')}
            connectionMode={connectionMode}
          />
          <PluginSlot name="device.add.actions" />
          <PluginSlot name="device.add.footer" />
          <PluginSlot name="device.add.after" />
          </PluginSlot>
        </Form>
      </Modal>

      <Modal
        title="确认开启云端模式"
        open={cloudConfirmOpen}
        okText="确认添加"
        okButtonProps={{ danger: true }}
        onCancel={() => setCloudConfirmOpen(false)}
        onOk={() => {
          setCloudConfirmOpen(false)
          void saveCloudDevices()
        }}
      >
        <Space direction="vertical">
          <Typography.Text>
            云端模式会使用 Bambu Lab 官方账号令牌连接 MQTT，状态经公网同步。请确认你信任本机存储的加密令牌。
          </Typography.Text>
          <Typography.Text type="secondary">
            将添加 {selectedDevIds.length} 台设备，是否继续？
          </Typography.Text>
        </Space>
      </Modal>
    </>
  )
}
