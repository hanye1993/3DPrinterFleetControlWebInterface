/** Minimal window surface used by printer protocol bridges (webContents.send). */
export type BridgeWindow = {
  webContents: {
    send: (channel: string, data: unknown) => void
  }
}

export type BridgeWindowGetter = () => BridgeWindow | null
