import fs from 'node:fs'
import path from 'node:path'

const FRONTEND_DEPS = [
  'vite',
  'next',
  'nuxt',
  'vue',
  'react',
  'svelte',
  '@angular/core',
  '@vue/cli-service',
  'react-scripts',
  'astro',
  'gatsby',
  'parcel',
  'webpack-dev-server',
]

const BACKEND_DEPS = [
  'express',
  'koa',
  'fastify',
  '@nestjs/core',
  'hapi',
  '@hapi/hapi',
  'egg',
]

const FRAMEWORK_PORT = [
  ['vite', 5173],
  ['next', 3000],
  ['nuxt', 3000],
  ['react-scripts', 3000],
  ['@vue/cli-service', 8080],
  ['@angular/core', 4200],
  ['astro', 4321],
  ['svelte', 5173],
]

const VITE_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
]

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function detectVitePort(dir) {
  for (const name of VITE_CONFIG_FILES) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      const match = text.match(/\bport\s*:\s*(\d{2,5})/)
      if (match) {
        const port = Number(match[1])
        if (port > 0 && port <= 65535) return port
      }
    } catch {
      /* 忽略不存在的配置文件 */
    }
  }
  return null
}

function detectScriptPort(scripts = {}) {
  for (const value of Object.values(scripts)) {
    const match = String(value || '').match(/--port[=\s]+(\d{2,5})/)
    if (match) {
      const port = Number(match[1])
      if (port > 0 && port <= 65535) return port
    }
  }
  return null
}

/** 根据 package.json / 常见配置文件推断项目类型和启动方式 */
export function detectProjectProfile(dir) {
  const pkg = dir ? readJson(path.join(dir, 'package.json')) : null
  const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  const deps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  }
  const frontend = FRONTEND_DEPS.some((name) => Boolean(deps[name]))
  const backend = BACKEND_DEPS.some((name) => Boolean(deps[name]))

  let type = 'backend'
  if (frontend) type = 'frontend'
  else if (!backend && pkg) type = 'backend'

  let startCommand = ''
  if (type === 'frontend') {
    if (scripts.dev) startCommand = 'npm run dev'
    else if (scripts.start) startCommand = 'npm start'
    else if (scripts.serve) startCommand = 'npm run serve'
    else if (scripts.preview) startCommand = 'npm run preview'
  }

  let previewUrl = ''
  if (type === 'frontend') {
    let port = null
    if (deps.vite) port = detectVitePort(dir)
    if (!port) port = detectScriptPort(scripts)
    if (!port) {
      for (const [dep, fallback] of FRAMEWORK_PORT) {
        if (deps[dep]) {
          port = fallback
          break
        }
      }
    }
    previewUrl = `http://localhost:${port || 5173}/`
  }

  return {
    packageName: typeof pkg?.name === 'string' ? pkg.name : '',
    type,
    startCommand,
    previewUrl,
    scripts: Object.keys(scripts),
    hasPackageJson: Boolean(pkg),
  }
}
