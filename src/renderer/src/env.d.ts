declare global {
  interface Window {
    /** Legacy desktop bridge; absent in web builds */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electronAPI?: any
  }
}

declare const __APP_VERSION__: string

declare module '*.png' {
  const src: string
  export default src
}

export {}
