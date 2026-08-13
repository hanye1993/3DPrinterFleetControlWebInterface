import type { DeviceConfig } from '../types/printer'
import type { PrinterAdapter } from './base'
import { AnycubicAdapter } from './anycubic'
import { BambuAdapter } from './bambu'
import { CrealityAdapter } from './creality'
import { ElegooAdapter } from './elegoo'
import { FlashforgeAdapter } from './flashforge'
import { MoonrakerAdapter } from './moonraker'
import { SnapmakerAdapter } from './snapmaker'

export { emptyStatus } from './base'
export type { PrinterAdapter, StatusListener } from './base'
export {
  probeMoonraker,
  probeCreality,
  probeQidi,
  normalizeCrealityUrl,
  normalizeQidiUrl,
  moonrakerLogin
} from './moonraker'

export function createAdapter(config: DeviceConfig, apiKey?: string | null): PrinterAdapter {
  if (config.brand === 'bambu') {
    return new BambuAdapter(config, apiKey ?? '')
  }
  // Creality cloud stays on official API; LAN is plain Moonraker like Klipper
  if (config.brand === 'creality' && config.connectionMode === 'cloud') {
    return new CrealityAdapter(config, apiKey ?? '')
  }
  if (config.brand === 'elegoo') {
    return new ElegooAdapter(config, apiKey ?? '')
  }
  if (config.brand === 'anycubic') {
    return new AnycubicAdapter(config, apiKey ?? '')
  }
  if (config.brand === 'flashforge') {
    return new FlashforgeAdapter(config, apiKey ?? '')
  }
  if (config.brand === 'snapmaker') {
    return new SnapmakerAdapter(config, apiKey ?? '')
  }
  // klipper / creality LAN / qidi — Moonraker / Fluidd
  return new MoonrakerAdapter(config, apiKey ?? '')
}
