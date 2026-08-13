/** Fake BrowserWindow — captures bridge IPC events in Node server mode */
import type { BridgeWindow } from '../../shared/bridgeWindow'

export type IpcHandler = (channel: string, data: unknown) => void

export function createBridgeWindow(onIpc: IpcHandler): () => BridgeWindow | null {
  return () => ({
    webContents: {
      send: (channel: string, data: unknown) => onIpc(channel, data)
    }
  })
}
