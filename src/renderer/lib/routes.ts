interface RouteMeta {
  id: string
  label: string
  icon: string
  group: string
  keywords: string
}

export const ROUTES: RouteMeta[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard-layout', group: 'Overview', keywords: 'home overview health score status' },
  { id: 'cleaner', label: 'Junk Cleaner', icon: 'broom', group: 'Clean', keywords: 'clean temp cache junk free space browser recycle' },
  { id: 'disk', label: 'Disk Analyzer', icon: 'hdd', group: 'Clean', keywords: 'disk space large files duplicates treemap storage' },
  { id: 'uninstaller', label: 'Uninstaller', icon: 'package', group: 'Clean', keywords: 'uninstall remove programs apps leftovers' },
  { id: 'startup', label: 'Startup Manager', icon: 'rocket', group: 'Speed up', keywords: 'startup boot services tasks autorun' },
  { id: 'gamebooster', label: 'Game Booster', icon: 'controller', group: 'Speed up', keywords: 'game gaming boost fps performance' },
  { id: 'processes', label: 'Processes & RAM', icon: 'speed', group: 'Speed up', keywords: 'processes ram memory cpu task manager end' },
  { id: 'tweaks', label: 'Tweaks', icon: 'control-panel', group: 'Tune', keywords: 'tweaks privacy telemetry performance registry network windows 11' },
  { id: 'debloat', label: 'Debloater', icon: 'cut', group: 'Tune', keywords: 'debloat bloatware remove apps preinstalled' },
  { id: 'updates', label: 'Updates & Drivers', icon: 'available-updates', group: 'Tune', keywords: 'update upgrade winget drivers' },
  { id: 'scheduler', label: 'Scheduler', icon: 'alarm-clock', group: 'Automate', keywords: 'schedule automatic tray timer' },
  { id: 'history', label: 'Restore & History', icon: 'time-machine', group: 'Automate', keywords: 'undo restore history revert log restore point' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'App', keywords: 'settings theme dark light appearance about startup tray' }
]

export const go = (id: string) => { window.location.hash = `#/${id}` }
