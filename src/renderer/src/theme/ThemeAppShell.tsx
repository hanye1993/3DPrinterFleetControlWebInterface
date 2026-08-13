import type { ReactNode } from 'react'
import type { ThemeLayoutId } from '@shared/themePack'

/**
 * Built-in shell layout engines — themes pick one via theme.json `layout`.
 * This is structural (DOM order), not color overrides.
 */
export function ThemeAppShell({
  layout,
  mobile,
  header,
  nav,
  main,
  footer,
  mobileToolbar
}: {
  layout: ThemeLayoutId
  mobile: boolean
  header: ReactNode
  nav: ReactNode
  main: ReactNode
  footer: ReactNode
  mobileToolbar?: ReactNode
}) {
  const shellClass = [
    'app-shell',
    mobile ? 'app-shell-mobile' : '',
    `app-shell-layout-${layout}`
  ]
    .filter(Boolean)
    .join(' ')

  if (mobile) {
    return (
      <div className={shellClass} data-layout={layout}>
        {header}
        {mobileToolbar}
        <div className="app-body app-body-mobile">
          <main className="app-main">{main}</main>
        </div>
      </div>
    )
  }

  if (layout === 'topnav') {
    return (
      <div className={shellClass} data-layout="topnav">
        {header}
        <nav className="app-topnav" aria-label="主导航">
          {nav}
        </nav>
        <main className="app-main">{main}</main>
      </div>
    )
  }

  if (layout === 'workspace') {
    return (
      <div className={shellClass} data-layout="workspace">
        <aside className="app-rail" aria-label="功能轨">
          {nav}
        </aside>
        <div className="app-workspace">
          <div className="app-workspace-chrome">{header}</div>
          <main className="app-main">{main}</main>
        </div>
      </div>
    )
  }

  // classic (+ custom falls back to classic chrome; custom HTML may replace via ThemeSlot)
  return (
    <div className={shellClass} data-layout={layout === 'custom' ? 'custom' : 'classic'}>
      {header}
      <div className="app-body">
        <aside className="app-sidebar">{nav}</aside>
        <main className="app-main">{main}</main>
      </div>
      {footer}
    </div>
  )
}
