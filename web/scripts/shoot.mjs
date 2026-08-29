/* Load a URL in headless Chrome, fail on any console error, write a PNG.
 *
 * Why not `--headless=new --screenshot`: that works for the picture, but this
 * Chrome build logs console.error, console.warn, console.log and uncaught
 * exceptions all at INFO:CONSOLE severity on stderr, so the "console must be
 * clean" half of the gate cannot be implemented from the log. The DevTools
 * Protocol reports the real level, so we drive Chrome over CDP instead.
 *
 * Usage: node scripts/shoot.mjs <url> <out.png> [settleMs]
 * Exit 0 = clean. Exit 1 = console errors (listed on stderr) or a failure.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [url, out, settleArg] = process.argv.slice(2)
const SETTLE = Number(settleArg || 4000)

if (!url || !out) {
  console.error('usage: shoot.mjs <url> <out.png> [settleMs]')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = await mkdtemp(join(tmpdir(), 'dcflens-shoot-'))

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--window-size=1440,1100',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let chromeStderr = ''
chrome.stderr.on('data', (d) => { chromeStderr += d })

async function shutdown(code) {
  try { chrome.kill('SIGTERM') } catch { /* already gone */ }
  await rm(profile, { recursive: true, force: true }).catch(() => {})
  process.exit(code)
}

function fail(msg) {
  console.error(msg)
  if (chromeStderr.trim()) console.error(chromeStderr.trim().split('\n').slice(-5).join('\n'))
  return shutdown(1)
}

// Chrome writes the chosen debugging port here once it is listening.
const portFile = join(profile, 'DevToolsActivePort')
let port = null
for (let i = 0; i < 100; i++) {
  if (existsSync(portFile)) {
    const first = (await readFile(portFile, 'utf8')).split('\n')[0].trim()
    if (first) { port = first; break }
  }
  await sleep(100)
}
if (!port) await fail('chrome never opened a debugging port')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) await fail('no page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('devtools websocket failed'))
}).catch(async (e) => fail(e.message))

let nextId = 1
const pending = new Map()
const errors = []

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    return
  }
  // Uncaught exceptions and rejected promises.
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    errors.push(d.exception?.description || d.text || 'uncaught exception')
  }
  // console.error / console.assert only — warn and log are not failures.
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
  // Network failures and CSP/parse errors the page reports.
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(`${msg.params.entry.source}: ${msg.params.entry.text}`)
  }
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

try {
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
  })
  await send('Page.navigate', { url })

  // Wait for load, then let fonts, GSAP and the data hook settle.
  await Promise.race([
    new Promise((res) => {
      const prev = ws.onmessage
      ws.onmessage = (ev) => {
        prev(ev)
        if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.onmessage = prev; res() }
      }
    }),
    sleep(15000),
  ])
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  await sleep(SETTLE)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(out, Buffer.from(shot.data, 'base64'))
} catch (e) {
  await fail(`shoot failed: ${e.message}`)
}

if (errors.length) {
  console.error(`console errors (${errors.length}):`)
  for (const e of errors) console.error(`    ${e}`)
  await shutdown(1)
}

await shutdown(0)
