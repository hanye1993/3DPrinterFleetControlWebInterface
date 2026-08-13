/** Running inside Electron desktop shell */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { electronAPI?: unknown }).electronAPI)
}

/** Running in a normal browser (HTML / PWA) */
export function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && !isElectron()
}
