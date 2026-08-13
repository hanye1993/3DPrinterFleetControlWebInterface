import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { defaultNavConfig, normalizeNavConfig, type NavConfig } from '../../shared/navConfig'

export type NavConfigPersistence = {
  load: () => unknown | null
  save: (data: unknown) => void
}

export class NavConfigStore {
  private path: string
  private data: NavConfig
  private persistence: NavConfigPersistence | null

  constructor(dataRoot: string, persistence?: NavConfigPersistence | null) {
    this.path = join(dataRoot, 'nav-config.json')
    this.persistence = persistence || null
    this.data = this.load()
  }

  private load(): NavConfig {
    try {
      if (this.persistence) {
        const raw = this.persistence.load()
        if (raw != null) return normalizeNavConfig(raw)
        const d = defaultNavConfig()
        this.persist(d)
        return d
      }
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8'))
        return normalizeNavConfig(raw)
      }
    } catch {
      /* recreate */
    }
    const d = defaultNavConfig()
    this.persist(d)
    return d
  }

  private persist(data: NavConfig = this.data): void {
    this.data = data
    if (this.persistence) {
      this.persistence.save(data)
      return
    }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf8')
  }

  get(): NavConfig {
    return normalizeNavConfig(this.data)
  }

  save(next: unknown): NavConfig {
    const normalized = normalizeNavConfig(next)
    this.persist(normalized)
    return normalized
  }
}
