declare global {
  interface Window {
    /** Legacy desktop bridge; absent in web builds */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electronAPI?: any
  }
}

declare module '*.png' {
  const src: string
  export default src
}

export {}
