import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const version = conf.version
const installerName = 'Zyro-Optimizer-x64-setup.exe'

const built = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${conf.productName}_${version}_x64-setup.exe`)
const outDir = join(resolve(root, process.env.RELEASE_DIR ?? '../release'), `v${version}`)

if (!process.argv.includes('--skip-build')) {
  execSync('npx tauri build', { cwd: root, stdio: 'inherit' })
}
if (!existsSync(built)) {
  console.error(`Installer not found: ${built}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, installerName)
copyFileSync(built, target)

const hash = createHash('sha256').update(readFileSync(target)).digest('hex').toUpperCase()
const size = (statSync(target).size / 1048576).toFixed(1)
writeFileSync(join(outDir, 'SHA256.txt'), `${hash}  ${installerName}\n`)

for (const f of ['LICENSE', 'NOTICE', 'TRADEMARKS.md']) {
  copyFileSync(join(root, f), join(outDir, f))
}

const notes = join(outDir, 'RELEASE_NOTES.md')
if (existsSync(notes)) {
  let text = readFileSync(notes, 'utf8')
  text = text.replace(/\b[0-9A-F]{64}\b/g, hash)
  text = text.replace(/(setup\.exe`? \| [^|]+\| )[\d.]+ MB/, `$1${size} MB`)
  writeFileSync(notes, text)
} else {
  writeFileSync(
    notes,
    `# Zyro Optimizer ${version}

## Download

| File | Platform | Size | SHA-256 |
| --- | --- | --- | --- |
| \`${installerName}\` | Windows 10 / 11, 64-bit | ${size} MB | \`${hash}\` |

## What's new

-
`
  )
  console.log('Wrote a new RELEASE_NOTES.md, fill in what changed.')
}

console.log(`\n${installerName}  ${size} MB\nSHA-256 ${hash}\n-> ${outDir}`)
