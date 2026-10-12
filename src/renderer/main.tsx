import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { initTheme } from './lib/theme'

// every backend call goes through one command
window.zyro = {
  invoke: (module, method, ...args) => invoke('call', { module, method, args }),
  on: (channel, cb) => {
    let off: (() => void) | null = null
    let dead = false
    listen(channel, (e) => cb(e.payload)).then((un) => (dead ? un() : (off = un)))
    return () => {
      dead = true
      off?.()
    }
  }
}

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
