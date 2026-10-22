import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SERVER_DIR = path.resolve(__dirname, '..')
export const ROOT_DIR = path.resolve(SERVER_DIR, '..')
export const DATA_DIR = process.env.AUTOCODE_DATA
  ? path.resolve(process.env.AUTOCODE_DATA)
  : path.join(SERVER_DIR, 'data')
export const WEB_DIST = path.join(ROOT_DIR, 'web', 'dist')

fs.mkdirSync(DATA_DIR, { recursive: true })
