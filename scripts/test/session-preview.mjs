// Build a standalone browser regression fixture. All API calls are in-memory;
// no real terminals/accounts or localhost listener are needed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { generateFixture } from '../demo/make-fixture.mjs'

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-session-preview-'))
generateFixture({ out: path.join(out, 'data'), scenario: 'single-project', seed: 42 })
process.env.AGENTDECK_CONFIG_DIR = path.join(out, 'data')
const { PROVIDERS } = await import('../../server/registry.js')
const responses = {}
const live = []
const save = async (provider, route, params = {}) => {
  const q = new URLSearchParams(params)
  const res = await PROVIDERS[provider].dispatch('GET', '/api/' + route, q)
  q.sort()
  responses[`/api/${provider}/${route}?${q}`] = res.body
  return res.body
}
for (const provider of Object.keys(PROVIDERS)) {
  const roots = await save(provider, 'roots')
  for (const root of roots.roots) {
    const { projects } = await save(provider, 'projects', { root: root.id })
    for (const route of ['stats', 'activity', 'history', 'usage', 'plugins']) await save(provider, route, { root: root.id })
    for (const p of projects) {
      const { sessions } = await save(provider, 'sessions', { root: root.id, slug: p.slug })
      for (const s of sessions) await save(provider, 'session', { root: root.id, ...(provider === 'claude' ? { slug: p.slug } : {}), id: s.id })
      if (sessions[0]) live.push({ provider, root: root.id, slug: p.slug, cwd: p.cwd || p.slug, id: sessions[0].id, title: sessions[0].title, key: `${provider}|${root.id}|session|${sessions[0].id}`, tmuxName: 'fixture-only', startedAt: Date.now() })
    }
  }
}
const result = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } })
const css = fs.readdirSync('dist/assets').find((f) => f.endsWith('.css'))
const shim = `
const responses=${JSON.stringify(responses)};
let live=${JSON.stringify(live)};
const events=[];
window.EventSource=class { constructor(){events.push(this);setTimeout(()=>this.onopen?.(),10)} close(){const i=events.indexOf(this);if(i>=0)events.splice(i,1)} };
window.fetch=async(input,options={})=>{
 const url=new URL(input,'http://fixture'); const bits=url.pathname.split('/'); const provider=bits[2],route=bits[3];
 let data={};let status=200;
 if(route==='active-sessions')data={tmux:live};
 else if(route==='terminals')data={terminals:live};
 else if(route==='terminal'&&options.method==='POST'){
  const b=JSON.parse(options.body);let t=live.find(t=>t.provider===provider&&t.root===b.root&&(b.terminalKey?t.key===b.terminalKey:b.launchId?t.launchId===b.launchId:b.id&&t.id===b.id));
  if(!t&&b.terminalKey){status=410;data={error:'This terminal has ended.'}}
  else { if(!t){t={...b,provider,key:provider+'|'+b.root+'|launch|'+b.launchId,startedAt:Date.now(),tmuxName:'fixture-only'};live.push(t)}data={...t,url:'about:blank',ok:true} }
 } else if(route==='terminal'&&options.method==='DELETE'){live=live.filter(t=>t.key!==url.searchParams.get('key'));data={stopped:true}}
 else {url.searchParams.sort(); data=responses[url.pathname+'?'+url.searchParams]||responses[url.pathname+'?root='+url.searchParams.get('root')]||{roots:[],projects:[],sessions:[],items:[]};}
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
setInterval(()=>{for(const e of events)e.onmessage?.({data:JSON.stringify({type:'change',changes:live.filter(t=>t.id).map(t=>({provider:t.provider,root:t.root,slug:t.slug,id:t.id}))})})},350);
`
const html = `<!doctype html><html><head><meta charset="utf-8"><title>AgentDeck session regression preview</title><style>${fs.readFileSync('dist/assets/' + css, 'utf8')}</style></head><body><div id="root"></div><script>${shim.replaceAll('</script', '<\\/script')}</script><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
const file = path.join(out, 'index.html')
fs.writeFileSync(file, html)
console.log(file)
