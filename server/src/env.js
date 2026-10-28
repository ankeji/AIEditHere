import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const candidates = [path.join(root, '.env'), path.join(root, 'server', '.env')]

function parseLines(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const hash = value.search(/\s+#/)
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

for (const file of candidates) {
  try {
    if (!fs.existsSync(file)) continue
    parseLines(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.warn(`[env] 读取 ${file} 失败：${err?.message || err}`)
  }
}
