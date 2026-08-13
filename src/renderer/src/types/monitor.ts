export type ZoneCamera = {
  id: string
  name: string
  /**
   * HTTP snapshot / MJPEG URL, or placeholder for plugin sources
   * (e.g. `plugin://demo_vendor/...`). Optional when `sourceType` is a plugin id.
   */
  url: string
  snapshotUrl?: string
  /** `http` (default) or plugin-registered source id */
  sourceType?: string
  /** Free-form plugin payload (credentials, channel, cloud device id, …) */
  pluginData?: Record<string, unknown>
  [key: string]: unknown
}

export type MonitorZone = {
  id: string
  name: string
  cameras: ZoneCamera[]
  createdAt: string
  updatedAt?: string
}
