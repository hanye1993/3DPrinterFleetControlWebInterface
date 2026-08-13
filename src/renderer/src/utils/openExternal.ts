import { isWebBrowser } from '@shared/platform'

/** Open URL in system browser (Electron) or new tab (web). */
export function openExternal(url: string): void {
  if (isWebBrowser()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  void window.electronAPI?.shell?.openExternal(url)
}

/** Trigger browser download from binary data. */
export function downloadBlob(data: ArrayBuffer | Uint8Array, fileName: string): void {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const blob = new Blob([copy])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
