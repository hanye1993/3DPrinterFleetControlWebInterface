import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Modal, Space, Typography, message } from 'antd'
import { CloudDownloadOutlined, GithubOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { openExternal } from '../../utils/openExternal'
import { PluginSlot } from '../../plugins/PluginSlot'
import { useAuthStore, apiFetch } from '../../stores/authStore'

const LS_LAST = 'hanye_update_last_check_at'
const LS_HINT = 'hanye_update_pending_hint'
const DAY_MS = 24 * 60 * 60 * 1000
const REPO_URL = 'https://github.com/hanye1993/3DPrinterFleetControlWebInterface'
/** Build-time version from package.json — always available without API */
const BUILTIN_VERSION = String(
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.4.1'
).replace(/^v/i, '') || '1.4.1'

export type UpdateCheckPayload = {
  ok: boolean
  reachable: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  releaseUrl: string | null
  message: string
  checkedAt?: string
  cached?: boolean
  deployMode?: 'docker' | 'source'
  canApplyUpdate?: boolean
}

async function fetchLocalAppVersion(): Promise<string> {
  const { serverUrl } = useAuthStore.getState()
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`)
    const j = (await res.json()) as { version?: string }
    const v = String(j.version || '').trim().replace(/^v/i, '')
    return v || BUILTIN_VERSION
  } catch {
    return BUILTIN_VERSION
  }
}

export async function fetchUpdateCheck(force = false): Promise<UpdateCheckPayload> {
  const { serverUrl, token } = useAuthStore.getState()
  const path = force ? '/api/v1/update/check?force=1' : '/api/v1/update/check'
  const localVersion = await fetchLocalAppVersion()
  const res = await apiFetch(serverUrl, path, { token: token || undefined })
  let j: Partial<UpdateCheckPayload> & { message?: string } = {}
  try {
    j = (await res.json()) as Partial<UpdateCheckPayload> & { message?: string }
  } catch {
    j = {}
  }
  if (!res.ok || typeof j.reachable !== 'boolean') {
    return {
      ok: false,
      reachable: false,
      updateAvailable: false,
      currentVersion: localVersion,
      latestVersion: null,
      latestTag: null,
      releaseUrl: REPO_URL,
      message:
        res.status === 401
          ? '未登录或登录已失效，请重新登录后再检查更新'
          : j.message ||
            '检查不到更新：服务器无法访问 github.com（git / 网页均可）。浏览器能打开不等于服务器能连通。'
    }
  }
  return {
    ok: Boolean(j.ok),
    reachable: j.reachable,
    updateAvailable: Boolean(j.updateAvailable),
    currentVersion: j.currentVersion || localVersion,
    latestVersion: j.latestVersion ?? null,
    latestTag: j.latestTag ?? null,
    releaseUrl: j.releaseUrl || REPO_URL,
    message: j.message || '',
    checkedAt: j.checkedAt,
    cached: j.cached,
    deployMode: j.deployMode === 'docker' ? 'docker' : j.deployMode === 'source' ? 'source' : undefined,
    canApplyUpdate: j.canApplyUpdate
  }
}

/** 登录后每 24h 自动检查一次；有更新则提示，连不上 GitHub 则提示网络 */
export function usePeriodicUpdateCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      try {
        const last = Number(localStorage.getItem(LS_LAST) || 0)
        if (Date.now() - last < DAY_MS) {
          const pending = localStorage.getItem(LS_HINT)
          if (pending === '1') {
            message.info({
              content: '检测到有新版本，可到「软件设置 → 关于」检查并更新',
              key: 'hanye-update-hint',
              duration: 6
            })
          }
          return
        }
        const r = await fetchUpdateCheck(false)
        if (cancelled) return
        localStorage.setItem(LS_LAST, String(Date.now()))
        if (!r.reachable) {
          localStorage.removeItem(LS_HINT)
          message.warning({
            content:
              r.message ||
              '检查不到更新：请确认运行监控台的服务器能访问 github.com',
            key: 'hanye-update-unreachable',
            duration: 8
          })
          return
        }
        if (r.updateAvailable) {
          localStorage.setItem(LS_HINT, '1')
          message.info({
            content: `${r.message || '发现新版本'}。请到「软件设置 → 关于」点击更新。`,
            key: 'hanye-update-available',
            duration: 8
          })
        } else {
          localStorage.removeItem(LS_HINT)
        }
      } catch {
        if (!cancelled) {
          localStorage.setItem(LS_LAST, String(Date.now()))
          message.warning({
            content: '检查不到更新：请确认运行监控台的服务器能访问 github.com',
            key: 'hanye-update-unreachable',
            duration: 8
          })
        }
      }
    }
    const t = window.setTimeout(() => void run(), 2500)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [enabled])
}

export function SoftSettingsAbout() {
  const token = useAuthStore((s) => s.token)
  const serverUrl = useAuthStore((s) => s.serverUrl)
  const user = useAuthStore((s) => s.user)
  const isAdmin = !user || user.level === 'admin'
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [status, setStatus] = useState<UpdateCheckPayload | null>(null)
  const [localVersion, setLocalVersion] = useState<string>(BUILTIN_VERSION)

  const doCheck = useCallback(
    async (force: boolean) => {
      setChecking(true)
      try {
        const r = await fetchUpdateCheck(force)
        setStatus(r)
        localStorage.setItem(LS_LAST, String(Date.now()))
        if (!r.reachable) {
          localStorage.removeItem(LS_HINT)
          message.warning(r.message || '检查不到更新，请确认能否访问 GitHub')
        } else if (r.updateAvailable) {
          localStorage.setItem(LS_HINT, '1')
          message.info(r.message)
        } else {
          localStorage.removeItem(LS_HINT)
          message.success(r.message || '已是最新版本')
        }
      } catch (e) {
        const localVersion = await fetchLocalAppVersion()
        const msg = e instanceof Error ? e.message : '检查失败'
        setStatus({
          ok: false,
          reachable: false,
          updateAvailable: false,
          currentVersion: localVersion,
          latestVersion: null,
          latestTag: null,
          releaseUrl: REPO_URL,
          message:
            '检查不到更新：服务器无法访问 github.com（git / 网页均可）。浏览器能打开不等于服务器能连通。'
        })
        message.warning(
          msg.includes('Failed') || msg.includes('fetch')
            ? '检查不到更新：请确认运行监控台的那台机器能访问 github.com'
            : msg
        )
      } finally {
        setChecking(false)
      }
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    void fetchLocalAppVersion().then((v) => {
      if (!cancelled) setLocalVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  useEffect(() => {
    void doCheck(false)
  }, [doCheck, serverUrl, token])

  const onUpdateClick = () => {
    const docker = status?.deployMode === 'docker'
    Modal.confirm({
      title: docker ? '确认更新（Docker）？' : '确认更新源码？',
      icon: <GithubOutlined />,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            更新由<strong>服务器</strong>执行：优先 git，否则下载 GitHub 源码包。需该机器能访问{' '}
            <Typography.Link href={REPO_URL} target="_blank" rel="noreferrer">
              github.com
            </Typography.Link>
            。
          </p>
          {docker ? (
            <p style={{ marginBottom: 0, color: 'rgba(0,0,0,.45)' }}>
              Docker 只会更新宿主机上的源码目录；成功后请到飞牛 Docker 项目点「重新构建并启动」，新版本才会进容器。
            </p>
          ) : (
            <p style={{ marginBottom: 0, color: 'rgba(0,0,0,.45)' }}>
              完成后请自行 npm run build 并重启服务。
            </p>
          )}
        </div>
      ),
      okText: docker ? '下载源码并更新' : '服务器可访问，开始更新',
      cancelText: '取消',
      onOk: async () => {
        setApplying(true)
        try {
          const probe = await fetchUpdateCheck(true)
          if (!probe.reachable) {
            message.error(probe.message || '无法连接 GitHub，请检查网络后再试')
            setStatus(probe)
            return
          }
          if (probe.canApplyUpdate === false) {
            message.error(
              probe.message ||
                '当前 Docker 未挂载宿主机源码目录，无法在设置里更新。请先按文档更新 compose 并重建。'
            )
            setStatus(probe)
            return
          }
          const res = await apiFetch(serverUrl, '/api/v1/update/apply', {
            method: 'POST',
            token: token || undefined
          })
          const j = (await res.json()) as {
            ok?: boolean
            reachable?: boolean
            message?: string
            needsRebuild?: boolean
            deployMode?: string
          }
          if (!j.reachable) {
            message.error(j.message || '无法连接 GitHub，请检查网络后再试')
            return
          }
          if (!j.ok) {
            message.error(j.message || '更新失败')
            return
          }
          localStorage.removeItem(LS_HINT)
          message.success(j.message || '源码已更新')
          if (j.needsRebuild || j.deployMode === 'docker') {
            Modal.info({
              title: '还差一步：重建 Docker 镜像',
              content:
                '源码已更新到宿主机。请到飞牛 → Docker → 本项目 →「重新构建并启动」。完成后刷新网页查看新版本号。'
            })
          }
          await doCheck(true)
        } catch (e) {
          message.error(e instanceof Error ? e.message : '更新失败')
        } finally {
          setApplying(false)
        }
      }
    })
  }

  const ver = status?.currentVersion || localVersion

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.about.content.before" />
      <Card className="settings-card" title="关于">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div className="settings-row">
            <div className="settings-row-label">
              <Typography.Text strong>hanye-3D打印机监控台</Typography.Text>
              <Typography.Text type="secondary">版本 v{ver}</Typography.Text>
            </div>
            <InfoCircleOutlined style={{ fontSize: 18, opacity: 0.55 }} />
          </div>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              检查更新
            </Typography.Text>
            {status && !status.reachable ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="检查不到更新"
                description={
                  status.message ||
                  '请确认运行监控台的服务器能否访问 github.com（可用 git / 网页）。浏览器能打开不等于服务器能连通。网络恢复后可再点「检查更新」。'
                }
              />
            ) : null}
            {status?.reachable && status.updateAvailable ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10 }}
                message={`发现新版本 v${status.latestVersion}`}
                description={status.message}
              />
            ) : null}
            {status?.reachable && !status.updateAvailable ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 10 }}
                message={status.message || '已是最新版本'}
              />
            ) : null}
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                loading={checking}
                onClick={() => void doCheck(true)}
              >
                检查更新
              </Button>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                loading={applying}
                disabled={!isAdmin}
                onClick={onUpdateClick}
              >
                更新
              </Button>
              <Button
                icon={<GithubOutlined />}
                onClick={() => openExternal(status?.releaseUrl || REPO_URL)}
              >
                打开 GitHub
              </Button>
            </Space>
            {!isAdmin ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                仅管理员可执行源码更新。
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {status?.deployMode === 'docker'
                  ? 'Docker 模式：更新会把新源码写到宿主机目录（需挂载 /host-repo），然后请重新构建镜像。自动每 24 小时检查一次。'
                  : '自动每 24 小时检查一次。更新会拉取仓库源码（git 或 ZIP），完成后请重新构建并重启。'}
              </Typography.Text>
            )}
          </div>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              介绍
            </Typography.Text>
            <Typography.Text>
              纯网页版监控台：电脑与手机浏览器打开同一地址即可使用（手机自适应布局）。统一管理
              Klipper / 拓竹 / 创想等设备与耗材；可通过「主题」换排版与配色，通过「插件」扩展功能。
            </Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              开发者
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              B站：
              <Typography.Link
                onClick={() =>
                  openExternal(
                    'https://search.bilibili.com/all?keyword=%E5%B0%8F%E6%B1%89%E6%95%85%E4%BA%8B'
                  )
                }
              >
                @小汉故事
              </Typography.Link>
              <br />
              QQ：
              <Typography.Text copyable={{ text: '2500689358' }}>2500689358</Typography.Text>
              <br />
              群号：
              <Typography.Text copyable={{ text: '1053838529' }}>1053838529</Typography.Text>
            </Typography.Paragraph>
            <PluginSlot name="settings.about.links.after" />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              感谢
            </Typography.Text>
            <Typography.Text>时空之树测试反馈</Typography.Text>
          </div>
          <PluginSlot name="settings.about.footer" />
        </Space>
      </Card>
      <PluginSlot name="settings.about.content.after" />
    </Space>
  )
}
