import { useEffect, useState } from 'react'
import { BorderOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.electronAPI?.window?.isMaximized().then(setMaximized)
  }, [])

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control-btn"
        title="最小化"
        onClick={() => void window.electronAPI?.window?.minimize()}
      >
        <MinusOutlined />
      </button>
      <button
        type="button"
        className="window-control-btn"
        title={maximized ? '还原' : '最大化'}
        onClick={async () => {
          const next = await window.electronAPI?.window?.maximize()
          setMaximized(!!next)
        }}
      >
        <BorderOutlined />
      </button>
      <button
        type="button"
        className="window-control-btn window-control-close"
        title="关闭"
        onClick={() => void window.electronAPI?.window?.close()}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}
