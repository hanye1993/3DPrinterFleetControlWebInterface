import type {
  CallbackRegisterOpts,
  ContextFactory,
  HostCapabilities,
  HookBus,
  PluginCapability,
  PluginContext,
  PluginManifestV2,
  TemplateEngine
} from '../../../shared/pluginKernel'
import { KERNEL_VERSION, signHmacSha256, verifyHmacSha256 } from '../../../shared/pluginKernel'
import { createDisabledExtensionDbApi } from '../extensionDb'

function hasCap(manifest: PluginManifestV2, cap: PluginCapability): boolean {
  const caps = manifest.capabilities
  if (!caps || !caps.length) {
    return manifest.apiVersion === '1'
  }
  return caps.includes(cap)
}

export class DefaultContextFactory implements ContextFactory {
  create(
    plugin: {
      id: string
      version: string
      manifest: PluginManifestV2
      vars: Record<string, string>
    },
    caps: HostCapabilities,
    hooks: HookBus,
    templates: TemplateEngine
  ): PluginContext {
    const { id, version, manifest, vars } = plugin
    const logPrefix = `[plugin:${id}]`

    const deny = (cap: string) => {
      throw new Error(`插件 ${id} 未声明 capability: ${cap}`)
    }

    const registerCallback = (opts: CallbackRegisterOpts) => {
      if (!hasCap(manifest, 'http.callback') && !hasCap(manifest, 'http.route')) {
        deny('http.callback')
      }
      const method = (opts.method || 'POST').toUpperCase()
      const verify = opts.verify || (opts.secretVar || opts.secret ? 'hmac-sha256' : 'none')
      const sigHeader = (opts.signatureHeader || 'x-hanye-signature').toLowerCase()
      caps.registerHttpRoute(
        method,
        opts.path,
        async (req, api) => {
          if (verify === 'hmac-sha256') {
            const secret =
              (opts.secretVar ? String((caps.getPluginVars?.(id) || vars)[opts.secretVar] || '') : '') ||
              String(opts.secret || '')
            if (!secret) {
              return {
                __pluginHttp: {
                  status: 500,
                  json: { ok: false, message: 'callback secret 未配置' }
                }
              }
            }
            const r = req as {
              headers?: Record<string, string | string[] | undefined>
              body?: unknown
              rawBody?: string
            }
            const hdr = r.headers?.[sigHeader] || r.headers?.['x-hub-signature-256']
            const sig = Array.isArray(hdr) ? hdr[0] : hdr || ''
            const raw =
              typeof r.rawBody === 'string'
                ? r.rawBody
                : typeof r.body === 'string'
                  ? r.body
                  : JSON.stringify(r.body ?? {})
            if (!verifyHmacSha256(raw, String(sig), secret)) {
              return {
                __pluginHttp: {
                  status: 401,
                  json: { ok: false, message: 'invalid signature' }
                }
              }
            }
          }
          return opts.handler(req, api)
        },
        { public: opts.public !== false }
      )
    }

    const ctx: PluginContext = {
      pluginId: id,
      version,
      manifest,
      log: {
        info: (...args) => {
          if (!hasCap(manifest, 'log')) return
          console.log(logPrefix, ...args)
          caps.appendLog?.({
            type: 'plugin',
            plugin: id,
            message: args.map(String).join(' '),
            at: new Date().toISOString()
          })
        },
        warn: (...args) => {
          if (!hasCap(manifest, 'log')) return
          console.warn(logPrefix, ...args)
        },
        error: (...args) => {
          if (!hasCap(manifest, 'log')) return
          console.error(logPrefix, ...args)
        }
      },
      vars: {
        get: (key, fallback = '') => {
          if (!hasCap(manifest, 'config.vars')) deny('config.vars')
          const all = caps.getPluginVars?.(id) || vars
          return all[key] != null ? String(all[key]) : fallback
        },
        set: async (key, value) => {
          if (!hasCap(manifest, 'config.vars')) deny('config.vars')
          await caps.setPluginVar?.(id, key, value)
          vars[key] = value
        },
        all: () => {
          if (!hasCap(manifest, 'config.vars')) deny('config.vars')
          return { ...(caps.getPluginVars?.(id) || vars) }
        }
      },
      storage: {
        readJson: <T = unknown>(rel: string, fallback?: T): T => {
          if (!hasCap(manifest, 'storage.json')) deny('storage.json')
          return (caps.readPluginJson?.(id, rel, fallback) ?? fallback) as T
        },
        writeJson: (rel, data) => {
          if (!hasCap(manifest, 'storage.json')) deny('storage.json')
          caps.writePluginJson?.(id, rel, data)
        }
      },
      http: {
        registerRoute: (method, pathPattern, handler, opts) => {
          if (!hasCap(manifest, 'http.route')) deny('http.route')
          caps.registerHttpRoute(method, pathPattern, handler, opts)
        },
        fetch: hasCap(manifest, 'http.fetch')
          ? async (input, init) => {
              const f = caps.fetch || globalThis.fetch
              if (!f) throw new Error('fetch 不可用')
              return f(input as never, init as never)
            }
          : undefined
      },
      settings: {
        get: () => {
          if (!hasCap(manifest, 'settings.read')) deny('settings.read')
          return caps.getSettings()
        },
        patch: hasCap(manifest, 'settings.patch')
          ? async (patch) => {
              if (!caps.patchSettings) return { ok: false, message: 'settings.patch 不可用' }
              return caps.patchSettings(patch)
            }
          : undefined
      },
      devices: {
        list: () => {
          if (!hasCap(manifest, 'devices.read')) deny('devices.read')
          return caps.getDevices()
        },
        statuses: () => {
          if (!hasCap(manifest, 'devices.read')) deny('devices.read')
          return caps.getStatuses()
        },
        control: hasCap(manifest, 'devices.control')
          ? async (deviceId, payload) => {
              if (!caps.controlDevice) return { ok: false, message: 'control 不可用' }
              return caps.controlDevice(deviceId, payload)
            }
          : undefined,
        save: hasCap(manifest, 'devices.control')
          ? async (devices) => {
              if (!caps.saveDevices) throw new Error('devices.save 不可用')
              await caps.saveDevices(devices)
              return caps.getDevices()
            }
          : undefined
      },
      hooks: {
        on: (name, fn, opts) => {
          if (!hasCap(manifest, 'hooks')) deny('hooks')
          return hooks.on(name, fn, { ...opts, pluginId: id })
        },
        apply: (name, value, hostCtx) => {
          if (!hasCap(manifest, 'hooks')) deny('hooks')
          return hooks.apply(name, value, hostCtx)
        },
        emit: (name, payload, hostCtx) => {
          if (!hasCap(manifest, 'hooks')) deny('hooks')
          return hooks.emit(name, payload, hostCtx)
        }
      },
      templates: {
        render: (name, data) => {
          if (!hasCap(manifest, 'templates')) deny('templates')
          return templates.render(name, data)
        },
        has: (name) => {
          if (!hasCap(manifest, 'templates')) deny('templates')
          return templates.has(name)
        }
      },
      meta: {
        appVersion: caps.appVersion,
        kernelVersion: KERNEL_VERSION
      }
    }

    if (hasCap(manifest, 'http.callback') || hasCap(manifest, 'http.route')) {
      ctx.callbacks = {
        register: registerCallback,
        verifyHmac: verifyHmacSha256,
        signHmac: signHmacSha256
      }
    }

    if (hasCap(manifest, 'alert.dispatch')) {
      ctx.alert = {
        dispatch: async (payload) => {
          if (!caps.dispatchAlert) throw new Error('alert.dispatch 不可用')
          return caps.dispatchAlert(payload)
        }
      }
    }

    if (hasCap(manifest, 'users.read') || hasCap(manifest, 'users.write')) {
      ctx.users = {
        find: (query) => {
          if (!hasCap(manifest, 'users.read')) deny('users.read')
          return caps.findUser?.(query) ?? null
        },
        create: hasCap(manifest, 'users.write')
          ? async (input) => {
              if (!caps.createUser) throw new Error('users.create 不可用')
              return caps.createUser(input)
            }
          : undefined
      }
    }

    if (hasCap(manifest, 'auth.login')) {
      ctx.auth = {
        issueLoginToken: (userId) => {
          if (!caps.issueLoginToken) throw new Error('auth.issueLoginToken 不可用')
          return caps.issueLoginToken(userId)
        },
        createLoginGrant: (userId, opts) => {
          if (!caps.createLoginGrant) throw new Error('auth.createLoginGrant 不可用')
          return caps.createLoginGrant(userId, opts)
        }
      }
    }

    if (hasCap(manifest, 'plugins.call') || hasCap(manifest, 'hooks')) {
      ctx.plugins = {
        call: async (pluginId, method, args) => {
          if (!hasCap(manifest, 'plugins.call')) deny('plugins.call')
          if (!caps.callPlugin) throw new Error('plugins.call 不可用')
          return caps.callPlugin(id, pluginId, method, args)
        },
        list: () => caps.listPlugins?.() || [],
        get: (pluginId) => caps.getPluginInfo?.(pluginId) || null,
        registerMethod: (name, fn) => {
          caps.registerPluginMethod?.(id, name, fn)
        }
      }
    }

    ctx.notices = {
      push: (input) => {
        if (!caps.pushNotice) throw new Error('notices 不可用')
        return caps.pushNotice({
          pluginId: id,
          level: input.level,
          title: input.title,
          body: input.body,
          userId: input.userId
        })
      }
    }

    if (hasCap(manifest, 'cache')) {
      ctx.cache = {
        get: async (key) => {
          const hooked = await hooks.apply(
            'filter:cache.get',
            { key, value: undefined as unknown },
            { pluginId: id }
          )
          if (hooked && 'value' in (hooked as object) && (hooked as { value: unknown }).value !== undefined) {
            return (hooked as { value: unknown }).value as never
          }
          return (await caps.cacheGet?.(id, key)) as never
        },
        set: async (key, value, ttlMs) => {
          const hooked = await hooks.apply(
            'filter:cache.set',
            { key, value, ttlMs, proceed: true },
            { pluginId: id }
          )
          if (hooked && (hooked as { proceed?: boolean }).proceed === false) return
          await caps.cacheSet?.(
            id,
            key,
            (hooked as { value?: unknown }).value !== undefined
              ? (hooked as { value: unknown }).value
              : value,
            (hooked as { ttlMs?: number }).ttlMs ?? ttlMs
          )
        },
        delete: async (key) => {
          const hooked = await hooks.apply(
            'filter:cache.delete',
            { key, proceed: true },
            { pluginId: id }
          )
          if (hooked && (hooked as { proceed?: boolean }).proceed === false) return
          await caps.cacheDelete?.(id, key)
        }
      }
    }

    if (hasCap(manifest, 'i18n')) {
      ctx.i18n = {
        t: (key, fallback) => caps.i18nGet?.(id, key, fallback) ?? fallback ?? key,
        locale: () => caps.i18nLocale?.() || 'zh-CN'
      }
    }

    if (hasCap(manifest, 'db.scoped')) {
      ctx.db = caps.getDbApi?.(id) || createDisabledExtensionDbApi('plugin', id)
    }

    return ctx
  }
}
