// Local-only browser verification with synthetic API responses. No provider calls.
// node scripts/check-annual-report.mjs http://127.0.0.1:5199
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { annualReportFixture } from '../src/lib/annualReport.fixture.js'

const base = process.argv[2] || 'http://127.0.0.1:5199'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local verification only')
const out = new URL('../.checks/annual-report/', import.meta.url)
await mkdir(out, { recursive: true })
const envelope = JSON.parse(await readFile(new URL('../src/mocks/msft-live.json', import.meta.url), 'utf8'))
envelope.analysis.status = 'APPLIED'
envelope.analysis.annual_report = annualReportFixture
const profile = await mkdtemp(join(tmpdir(), 'dcflens-report-check-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let ws
try {
  let port
  for (let i = 0; i < 100 && !port; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] }
    catch { await pause(100) }
  }
  assert(port, 'Chrome debugging port unavailable')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let sequence = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const handler = pending.get(message.id)
      pending.delete(message.id)
      if (handler) {
        if (message.error) handler.reject(message.error)
        else handler.resolve(message.result)
      }
    } else if (message.method === 'Runtime.exceptionThrown'
      || (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')) {
      errors.push(message.params)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => String(input).startsWith('/api/analyze/')
      ? Promise.resolve(new Response(JSON.stringify(${JSON.stringify(envelope)}), {status:200,headers:{'Content-Type':'application/json'}}))
      : originalFetch(input, options);
  ` })
  for (const [name, width, height, reduced] of [['desktop', 1440, 1100, false], ['mobile-reduced-motion', 390, 844, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] })
    await send('Page.navigate', { url: `${base}/?view=app&ticker=MSFT` })
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await evaluate("document.querySelectorAll('.annual-topic').length === 4")
      if (!ready) await pause(100)
    }
    assert(ready, 'Four annual-report topics must render')
    await evaluate('document.fonts.ready.then(() => true)')
    await pause(2200)
    assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page has horizontal overflow')
    assert.equal(await evaluate("document.querySelectorAll('.annual-topic details[open]').length"), 0)
    await evaluate("document.querySelector('.annual-review').scrollIntoView(); document.querySelector('.annual-topic summary').focus()")
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    assert.equal(await evaluate("document.querySelector('.annual-topic details').open"), true, 'Keyboard disclosure must open')
    assert(await evaluate("document.querySelector('.annual-excerpt blockquote').getBoundingClientRect().height > 0"))
    const fonts = await evaluate(`JSON.stringify({
      heading:getComputedStyle(document.querySelector('.annual-review h2')).fontFamily,
      body:getComputedStyle(document.querySelector('.annual-intro')).fontFamily,
      label:getComputedStyle(document.querySelector('.annual-label')).fontFamily,
      opacity:getComputedStyle(document.querySelector('.annual-review')).opacity
    })`)
    assert.equal(JSON.parse(fonts).opacity, '1')
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(new URL(`${name}.png`, out), Buffer.from(shot.data, 'base64'))
    console.log(`${name}: four topics, no overflow, keyboard evidence disclosure, visible text; fonts ${fonts}`)
  }
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('Browser verification passed with synthetic API responses; no live analysis was requested.')
} finally {
  ws?.close()
  const exited = new Promise((resolve) => chrome.once('exit', resolve))
  chrome.kill('SIGTERM')
  await Promise.race([exited, pause(2000)])
  await rm(profile, { recursive: true, force: true })
}
