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
  { id: 'tidy', label: 'Tidy Up', icon: 'maintenance', group: 'Clean', keywords: 'empty folders broken shortcuts leftovers clean up' },
  { id: 'disk', label: 'Disk Analyzer', icon: 'hdd', group: 'Clean', keywords: 'disk space large files duplicates treemap storage' },
  { id: 'uninstaller', label: 'Uninstaller', icon: 'package', group: 'Clean', keywords: 'uninstall remove programs apps leftovers' },
  { id: 'shredder', label: 'File Shredder', icon: 'recycle-bin', group: 'Clean', keywords: 'shred secure delete overwrite wipe file' },
  { id: 'startup', label: 'Startup Manager', icon: 'rocket', group: 'Speed up', keywords: 'startup boot services tasks autorun' },
  { id: 'gamebooster', label: 'Game Booster', icon: 'controller', group: 'Speed up', keywords: 'game gaming boost fps performance' },
  { id: 'processes', label: 'Processes & RAM', icon: 'speed', group: 'Speed up', keywords: 'processes ram memory cpu task manager end' },
  { id: 'health', label: 'Health', icon: 'ssd', group: 'Speed up', keywords: 'health drive disk ssd smart temperature battery wear capacity' },
  { id: 'tweaks', label: 'Tweaks', icon: 'control-panel', group: 'Tune', keywords: 'tweaks privacy telemetry performance registry network windows 11' },
  { id: 'privacy', label: 'Privacy', icon: 'privacy', group: 'Tune', keywords: 'privacy camera microphone location telemetry advertising permissions' },
  { id: 'debloat', label: 'Debloater', icon: 'cut', group: 'Tune', keywords: 'debloat bloatware remove apps preinstalled' },
  { id: 'updates', label: 'Updates & Drivers', icon: 'available-updates', group: 'Tune', keywords: 'update upgrade winget drivers' },
  { id: 'apps', label: 'Install Apps', icon: 'software-installer', group: 'Tune', keywords: 'install apps software download browser chrome firefox download manager vlc player winrar 7zip telegram discord winget' },
  { id: 'dns', label: 'DNS Changer', icon: 'wifi', group: 'Tune', keywords: 'dns changer google cloudflare shecan radar electro 403 begzar iran game gaming network' },
  { id: 'network', label: 'Network Tools', icon: 'monitor', group: 'Tune', keywords: 'network ping latency hosts file flush dns game servers' },
  { id: 'scheduler', label: 'Scheduler', icon: 'alarm-clock', group: 'Automate', keywords: 'schedule automatic tray timer' },
  { id: 'history', label: 'Restore & History', icon: 'time-machine', group: 'Automate', keywords: 'undo restore history revert log restore point' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'App', keywords: 'settings theme dark light appearance about startup tray' }
]

export const go = (id: string) => { window.location.hash = `#/${id}` }
