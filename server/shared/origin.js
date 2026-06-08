// Origin allow-listing. The server binds 127.0.0.1, but "localhost-only" does NOT
// protect against the user's own browser: any web page the user visits could,
// without this guard, POST to our API or open the /chat WebSocket (WebSockets
// aren't subject to the same-origin policy) and drive the real CLI agent. So we
// only accept browser requests whose Origin is the monitor's own UI.
//
// Requests with no Origin header (curl, server-to-server, same-origin GETs that
// omit it) are allowed — the attack vector is specifically a cross-origin page.

const API_PORT = String(Number(process.env.AGENTDECK_PORT || 47841))
const WEB_PORT = '47842' // the Vite dev server (proxies to the API)
const ALLOWED_PORTS = new Set([API_PORT, WEB_PORT])

export function isAllowedOrigin(origin, host) {
  if (!origin) return true // non-browser / same-origin without an Origin header
  let u
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  // Same-origin: the Origin matches the Host it's hitting — the user's own UI on
  // whatever host:port they reached it at (localhost, a WSL IP, a LAN address…).
  // Always safe; never a cross-origin page.
  if (host && u.host === host) return true
  // Otherwise allow only our known UI ports (the API + the Vite dev server),
  // regardless of hostname, so access via WSL / host port-forwarding still works.
  // A cross-origin page (e.g. https://evil.com on :443) is not on these ports.
  return ALLOWED_PORTS.has(u.port || (u.protocol === 'https:' ? '443' : '80'))
}
