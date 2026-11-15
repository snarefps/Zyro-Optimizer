import type { ItemResult } from '../../shared/types'
import { zy } from '../api'

export async function switchTweak(id: string, on: boolean): Promise<ItemResult> {
  const res = await (on ? zy.tweaks.apply([id]) : zy.tweaks.revert(id))
  return Array.isArray(res) ? res[0] : res
}

export const PRESETS = [
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'The safe settings most people want: less tracking and ads, a snappier interface',
    ids: ['ad-id-off', 'tailored-off', 'suggestions-off', 'bing-search-off', 'activity-history-off', 'telemetry-off', 'game-dvr-off', 'game-mode-on', 'show-extensions', 'transparency-off', 'fast-shutdown']
  },
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Game Mode, no background recording, the fast power plan and lower latency',
    ids: ['game-mode-on', 'game-dvr-off', 'plan-high', 'hags-on', 'net-throttle-off', 'system-responsiveness', 'transparency-off', 'visual-fx-perf']
  },
  {
    id: 'privacy',
    name: 'Privacy',
    description: 'Turns off telemetry, the advertising ID, activity history, Copilot and web search in Start',
    ids: ['ad-id-off', 'tailored-off', 'suggestions-off', 'telemetry-off', 'activity-history-off', 'bing-search-off', 'copilot-off']
  },
  {
    id: 'lowend',
    name: 'Low-end PC',
    description: 'Removes animations and transparency so an older PC feels lighter',
    ids: ['visual-fx-perf', 'transparency-off', 'list-effects-off', 'fast-shutdown', 'plan-high', 'widgets-off']
  }
]
