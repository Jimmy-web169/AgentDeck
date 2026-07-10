// Minimal ttyd stand-in for platforms where ttyd doesn't work (native Windows:
// ttyd 1.7.7 crashes at child spawn — tsl0922/ttyd#1292). Runs as a child
// process with the same contract terminal.js expects from ttyd: serve a
// browser terminal for one command on a localhost port, exit non-zero if the
// port can't be bound.
//
//   node webterm.js -p <port> [-O] [-t <title>] -- <command> [args...]
//
// One pty runs <command>, shared by every websocket client (iframe, popped-out
// tab, reconnects) — clients multiplex onto it rather than each spawning their
// own like ttyd does. That per-client model breaks with psmux (the Windows tmux
// stand-in): hard-killing one attached psmux client via ConPTY teardown can take
// down the sibling client or the whole session, so pop-out (new tab connects,
// then the iframe disconnects) would drop the new tab. The pty spawns on the
// first client and lives until it exits or this process is killed; a client
// closing never touches it. -O rejects cross-origin websocket connects (ttyd's
// --check-origin).

import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { WebSocketServer } from 'ws'
import * as pty from '@lydell/node-pty'

const argv = process.argv.slice(2)
let port = null
let title = 'terminal'
let checkOrigin = false
let command = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-p') port = Number(argv[++i])
  else if (argv[i] === '-t') title = argv[++i]
  else if (argv[i] === '-O') checkOrigin = true
  else if (argv[i] === '--') {
    command = argv.slice(i + 1)
    break
  }
}
if (!port || !command.length) {
  console.error('usage: webterm.js -p <port> [-O] [-t <title>] -- <command> [args...]')
  process.exit(2)
}

// xterm.js assets served from this project's node_modules (resolved relative to
// this file, so the monitored project's cwd doesn't matter)
const require_ = createRequire(import.meta.url)
const ASSETS = {
  '/xterm.js': [require_.resolve('@xterm/xterm/lib/xterm.js'), 'text/javascript'],
  '/xterm.css': [require_.resolve('@xterm/xterm/css/xterm.css'), 'text/css'],
  '/addon-fit.js': [require_.resolve('@xterm/addon-fit/lib/addon-fit.js'), 'text/javascript'],
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const PAGE = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="xterm.css">
<style>
  html, body { height: 100%; margin: 0; background: #000; }
  #term { height: 100%; }
  #dead { display: none; position: fixed; inset: 0; align-items: center; justify-content: center;
          color: #888; font: 13px monospace; background: rgba(0,0,0,.85); }
</style>
</head><body>
<div id="term"></div><div id="dead">disconnected — reload to reconnect</div>
<script src="xterm.js"></script>
<script src="addon-fit.js"></script>
<script>
  const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000,
    fontFamily: 'Menlo, Consolas, "Cascadia Mono", monospace', theme: { background: '#000000' } })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(document.getElementById('term'))
  fit.fit()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(proto + '://' + location.host + '/ws')
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 's', c: term.cols, r: term.rows }))
    term.focus()
  }
  ws.onmessage = (e) => term.write(new Uint8Array(e.data))
  ws.onclose = () => { document.getElementById('dead').style.display = 'flex' }
  term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d })) })
  term.onResize(({ cols, rows }) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'r', c: cols, r: rows })) })
  new ResizeObserver(() => { try { fit.fit() } catch {} }).observe(document.getElementById('term'))
</script>
</body></html>`

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(PAGE)
  }
  const asset = ASSETS[url]
  if (asset) {
    res.writeHead(200, { 'content-type': asset[1] })
    return res.end(fs.readFileSync(asset[0]))
  }
  res.writeHead(404)
  res.end('not found')
})

const wss = new WebSocketServer({ server, path: '/ws' })

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true // non-browser clients (no Origin header) are local tools
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// The shared pty and its viewers. `scroll` keeps the recent output (capped) so a
// late-joining client can replay what's on screen; the resize jiggle after replay
// makes full-screen TUIs (claude under psmux) repaint at the client's real size.
let proc = null
const clients = new Set()
const scroll = { chunks: [], bytes: 0 }
const SCROLL_MAX = 256 * 1024

function pushScroll(buf) {
  scroll.chunks.push(buf)
  scroll.bytes += buf.length
  while (scroll.bytes > SCROLL_MAX && scroll.chunks.length > 1) {
    scroll.bytes -= scroll.chunks.shift().length
  }
}

function spawnPty(cols, rows, ws) {
  // .cmd/.bat launchers (npm shims like codex.cmd) can't be CreateProcess'd
  // directly — run them through cmd.exe. Only relevant on the no-tmux fallback
  // path; with psmux the outer command is its tmux.exe.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command[0])) command = ['cmd.exe', '/c', ...command]
  try {
    proc = pty.spawn(command[0], command.slice(1), {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env,
    })
  } catch (e) {
    ws.send(Buffer.from(`\r\nfailed to start: ${e.message}\r\n`))
    ws.close(1011, 'spawn failed')
    return
  }
  proc.onData((d) => {
    const buf = Buffer.from(d, 'utf8')
    pushScroll(buf)
    for (const c of clients) if (c.readyState === 1) c.send(buf)
  })
  proc.onExit(() => {
    // command over -> this terminal is over; exit so the pool slot frees up
    for (const c of clients) {
      try {
        c.close(1000, 'process exited')
      } catch {}
    }
    process.exit(0)
  })
}

function resizeTo(cols, rows) {
  try {
    proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
  } catch {}
}

wss.on('connection', (ws, req) => {
  if (checkOrigin && !sameOrigin(req)) return ws.close(1008, 'origin not allowed')
  clients.add(ws)
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.t === 's') {
      const cols = Math.max(2, msg.c | 0) || 80
      const rows = Math.max(2, msg.r | 0) || 24
      if (!proc) return spawnPty(cols, rows, ws)
      // joining an already-running pty: replay recent output, then jiggle the
      // size so alt-screen TUIs do a full repaint at this client's dimensions
      for (const buf of scroll.chunks) if (ws.readyState === 1) ws.send(buf)
      resizeTo(cols, rows > 2 ? rows - 1 : rows + 1)
      setTimeout(() => proc && resizeTo(cols, rows), 60)
    } else if (msg.t === 'i' && proc) {
      proc.write(msg.d)
    } else if (msg.t === 'r' && proc) {
      resizeTo(msg.c, msg.r)
    }
  })
  // NB: a closing client must NOT kill the pty — the iframe disconnects on
  // pop-out / hide while another tab is (or will be) viewing the same terminal.
  ws.on('close', () => clients.delete(ws))
})

wss.on('error', () => {}) // ws re-emits server errors; server.on('error') below does the loud exit
server.on('error', (e) => {
  console.error(`webterm: ${e.message}`)
  process.exit(1)
})
server.listen(port, '127.0.0.1')
