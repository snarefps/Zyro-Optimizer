# Changelog

## 1.3.0 - 2026-11-15

- Update check can download the installer, compare its SHA-256 with the one in the release notes and start it
- Start-up time of the last restarts on the Startup page, drive and battery health page
- Tweak presets (Balanced, Gaming, Privacy, Low-end PC) and four new tweaks: camera, microphone and location access, list animations
- Privacy page with the apps that used the camera, microphone and location lately
- Game Booster starts by itself when a chosen game launches, can set process priorities, and checks Game Mode, power plan, GPU scheduling and refresh rate
- Automatic RAM trim, alerts for new startup items, weekly summary, notification when a long job finishes
- Tidy Up for empty folders and broken shortcuts, file shredder, app cache cleaners (Discord, Teams, Spotify, Steam, VS Code, npm, pip, NuGet), removal of the previous Windows installation
- Network tools: connection time to DNS and game servers, DNS cache flush, hosts file editor with backups and undo
- Quick panel on the tray icon, size map in the Uninstaller, PC report, backup and restore of settings, error log, keyboard shortcuts (Ctrl+1 to 9, Ctrl+,), first-run introduction
- Jobs can be cancelled from the Action Center. A cancel stops before the next step starts, so nothing is left half done
- The start-up card on the Startup page now shows real starts from the Windows System log when Windows' own timing is not readable, and can ask for permission to read it
- The bundled IDM helper was removed

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
