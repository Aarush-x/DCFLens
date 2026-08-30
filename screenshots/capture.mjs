/* Showcase capture for DCFLens — retina PNGs of the surfaces worth showing.
 *
 * A sibling of web/scripts/shoot.mjs, and deliberately not a replacement for it.
 * shoot.mjs is the GATE: 1x, viewport-only, and it fails the run on a console
 * error. This one is the CAMERA: 2x device scale, and it can scroll or click
 * before it shoots — because the states worth showing (the Why drawer) are
 * behind an interaction. Console errors are reported but do not fail a shot;
 * check.sh already owns the clean-console assertion.
 *
 * ── Why there is no full-page capture ───────────────────────────────────────
 * The obvious approach — captureBeyondViewport with a clip the height of the
 * document — produces a WRONG picture of this app, not merely a tall one. The
 * layout is viewport-anchored: `.rail` is `height: 100vh`, and `#wipe` is
 * `position: fixed; inset: 0` parked at `translateY(100%)`, exactly one viewport
 * below the fold. captureBeyondViewport resizes the layout viewport, so the rail
 * stops partway down and the green wipe panel lands across the middle of the
 * image. Instead each shot declares its own viewport HEIGHT and is framed by
 * scrolling to a real element — every 100vh box and the wipe then agree with the
 * frame. Keep it that way.
 *
 * Usage: node capture.mjs <shot-name>|all
 * Shots are declared in SHOTS below. PNGs land beside this file.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* Beside the script, deliberately: the repo's .gitignore has a build-artifact
   rule for `out/` that matches at any depth, and screenshots committed as
   showcase assets are not build artifacts. A nested out/ dir here is silently
   untracked. */
const OUT = HERE
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE || 'http://127.0.0.1:5199'

/* 1440x900 is the laptop a judge will open this on, and it is the frame for
   every shot unless one declares its own `h` — see the note above on why the
   viewport, not a clip, is what sets the frame. */
const W = 1440
const H = 900

const SHOTS = [
  {
    name: '01-landing',
    url: '/',
    settle: 3500,
    note: 'Landing hero — the animated first surface.',
  },
  {
    /* Cut from the showcase set, kept runnable: `node capture.mjs search`.
       It is the most generic screen in the product — a field on black — and the
       verdict shot already carries the search bar. Not worth one of five slots. */
    name: 'search',
    extra: true,
    url: '/?view=app',
    settle: 2500,
    note: 'Search-first entry: type a company, nothing is assumed for you.',
  },
  {
    name: '02-verdict',
    url: '/?view=app&mock=aapl',
    settle: 4500,
    note: 'The answer first — verdict, then price against the estimated range.',
  },
  {
    name: '03-reasoning',
    url: '/?view=app&mock=aapl',
    settle: 4500,
    /* The four blocks start partway down the left pane. Framed on the element
       rather than a magic offset, so it survives copy changes. */
    scrollToSelector: '.panes',
    scrollOffset: 24,
    note: 'Why we think so — what must be true, what supports it, what weakens it.',
  },
  {
    name: '04-why-math',
    url: '/?view=app&mock=aapl',
    settle: 4500,
    h: 1500,               // the open drawer is ~1400px; a 900 frame would cut it
    click: 'button.why',
    afterClick: 1600,
    scrollToSelector: '.whydrawer',
    scrollOffset: 40,
    /* The right pane has run out of content by this scroll depth, so the full
       1440 frame would be 40% dead black. Crop to rail + drawer (measured: the
       drawer spans x 278-888) and it reads as a deliberate detail shot. */
    clip: { x: 0, width: 940 },
    note: 'The second layer: the only place jargon is allowed, always glossed.',
  },
  {
    name: '05-cannot-value',
    url: '/?view=app&mock=novalue',
    settle: 3000,
    note: 'Refuse rather than guess — a designed state, not an error page.',
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'dcflens-capture-'))
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--window-size=${W},${H}`,
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const portFile = join(profile, 'DevToolsActivePort')
  let port = null
  for (let i = 0; i < 100; i++) {
    if (existsSync(portFile)) {
      const first = (await readFile(portFile, 'utf8')).split('\n')[0].trim()
      if (first) { port = first; break }
    }
    await sleep(100)
  }
  if (!port) throw new Error('chrome never opened a debugging port')
  return { chrome, profile, port }
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('devtools websocket failed'))
  })

  let nextId = 1
  const pending = new Map()
  const errors = []
  let onLoad = null

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      return
    }
    if (msg.method === 'Page.loadEventFired' && onLoad) { onLoad(); onLoad = null }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push(d.exception?.description || d.text || 'uncaught exception')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
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

  const waitForLoad = () => Promise.race([
    new Promise((res) => { onLoad = res }),
    sleep(15000),
  ])

  return { send, errors, waitForLoad }
}

async function shoot(cdp, shot) {
  const { send, errors, waitForLoad } = cdp
  errors.length = 0
  const h = shot.h ?? H

  /* Metrics BEFORE navigate: `.rail` at 100vh and the hero's 100vh box lay out
     against whatever the viewport is at first paint, so setting the frame after
     load would photograph a layout sized for a frame we are not using. */
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: h, deviceScaleFactor: 2, mobile: false,
  })
  await send('Page.navigate', { url: BASE + shot.url })
  await waitForLoad()
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  await sleep(shot.settle ?? 3000)

  if (shot.click) {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(shot.click)})
        if (!el) return 'missing'; el.click(); return 'clicked' })()`,
      returnByValue: true,
    })
    if (result.value === 'missing') throw new Error(`click target not found: ${shot.click}`)
    await sleep(shot.afterClick ?? 1200)
  }

  /* Frame on an element, not a pixel offset — the offsets move whenever copy or
     the open drawer's height changes, and a shot framed on a stale number is a
     shot of the wrong thing that still exits 0. */
  if (shot.scrollToSelector) {
    const { result } = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => { const el = document.querySelector(${JSON.stringify(shot.scrollToSelector)})
        if (!el) return null
        const top = el.getBoundingClientRect().top + window.scrollY - ${shot.scrollOffset ?? 0}
        window.scrollTo({ top, behavior: 'instant' })
        return Math.round(window.scrollY) })()`,
    })
    if (result.value === null) throw new Error(`scroll target not found: ${shot.scrollToSelector}`)
    await sleep(shot.afterScroll ?? 1200)
  } else if (shot.scrollTo != null) {
    await send('Runtime.evaluate', {
      expression: `window.scrollTo({ top: ${shot.scrollTo}, behavior: 'instant' })`,
    })
    await sleep(shot.afterScroll ?? 1200)
  }

  /* Cropping, with two traps worth naming because both fail silently.
     1. clip.y is DOCUMENT space, not viewport space. After a scroll, y:0 points
        at a band above the viewport that was never rasterized, and Chrome hands
        back a solid black image rather than an error — so offset by scrollY.
     2. clip.scale MULTIPLIES with deviceScaleFactor. Asking for scale 2 here on
        top of the 2x metrics gives a 4x image. Leave it at 1; the metrics
        already carry retina.
     No captureBeyondViewport, for the reason in the header note. */
  const params = { format: 'png' }
  if (shot.clip) {
    const { result: sy } = await send('Runtime.evaluate', {
      expression: 'Math.round(window.scrollY)', returnByValue: true,
    })
    params.clip = {
      x: shot.clip.x ?? 0,
      y: sy.value + (shot.clip.y ?? 0),
      width: shot.clip.width ?? W,
      height: shot.clip.height ?? h,
      scale: 1,
    }
  }
  const png = await send('Page.captureScreenshot', params)
  const file = join(OUT, `${shot.name}.png`)
  await writeFile(file, Buffer.from(png.data, 'base64'))
  return { file, errors: [...errors] }
}

const wanted = process.argv[2] && process.argv[2] !== 'all'
  ? SHOTS.filter((s) => s.name === process.argv[2] || s.name.includes(process.argv[2]))
  : SHOTS.filter((s) => !s.extra)
if (!wanted.length) {
  console.error(`no shot matches "${process.argv[2]}" — have: ${SHOTS.map((s) => s.name).join(', ')}`)
  process.exit(2)
}

await mkdir(OUT, { recursive: true })
const { chrome, profile, port } = await launch()
let code = 0
try {
  const cdp = await connect(port)
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.enable')
  for (const shot of wanted) {
    try {
      const { file, errors } = await shoot(cdp, shot)
      const kb = Math.round((await readFile(file)).length / 1024)
      console.log(`✓ ${shot.name} → ${file} (${kb} kB)`)
      if (errors.length) {
        code = 1
        console.log(`  ! console errors (${errors.length}):`)
        for (const e of errors) console.log(`      ${e}`)
      }
    } catch (e) {
      code = 1
      console.error(`✗ ${shot.name}: ${e.message}`)
    }
  }
} catch (e) {
  code = 1
  console.error(`capture failed: ${e.message}`)
} finally {
  try { chrome.kill('SIGTERM') } catch { /* already gone */ }
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
process.exit(code)
