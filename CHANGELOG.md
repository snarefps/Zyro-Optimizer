# Changelog

## 1.2.0 - 2026-10-14

- Install Apps: 42 apps installed through winget, with versions, details, checksum and a save-installer-only option
- DNS Changer: Google, Cloudflare, Shecan, Iranian game DNS and custom servers, with a speed test
- Update check against the GitHub releases: quiet check at startup, a notice bar and a "Check for updates" row in Settings
- Junk Cleaner rows expand to show the largest files and folders inside
- New interface that follows the Windows 11 Settings app, in dark and light, with a rebuilt Dashboard
- Restore points are manual; the automatic one before Tune changes is gone, old restore points can be deleted in Settings
- App updates use the same winget workflow as installs (version read before and after, old version put back on failure) and can be undone, DNS changes can be undone too
- Space map in Windows accent colors, Action Center notice can be closed
- Admin check, network speed and service start types no longer start helper programs
- Zyro's own processes are protected in the process list, extended-length paths are protected, leftover removal only accepts folders the scan offered

## 1.0.0 - 2026-10-12

First release.

- Junk cleaner, disk analyzer, uninstaller
- Startup manager, game booster, process list and RAM trimmer
- 24 reversible tweaks, debloater, winget app updates, driver age check
- Automatic restore point before changes in the Tune section
- Scheduled cleaning from the tray
- History page with undo
- Action Center with per-step progress, command palette (Ctrl+K)
- Dark (black), light and system themes
- Link to the Telegram channel in Settings
- Installer is now named Zyro-Optimizer-x64-setup.exe, `npm run release` files it under a version folder
