import fs from 'node:fs'
import chokidar, { type ChokidarOptions } from 'chokidar'
import type { ChangeEvent, Root } from '../../shared/types.d.ts'
import { invalidate } from './parseCache.ts'

// A controller owns one active generation. Await close attempts before replacing
// it; rejected closes remain best-effort, as in the original host. Chokidar caches
// its close promise, so retrying a rejected promise cannot restore monitoring.
export interface WatchProvider {
  id: string
  loadRoots(): Root[]
  watch?: {
    watchDir(root: string): string
    ignored?(root: string, absolute: string): boolean
    toEvent(rootId: string, root: string, absolute: string): ChangeEvent | null
  }
}
export interface WatchHandle {
  on(event: 'add' | 'change' | 'unlink', listener: (path: string) => void): WatchHandle
  on(event: 'error', listener: (error: unknown) => void): WatchHandle
  close(): Promise<unknown>
}
interface WatchOptions {
  watch?: (path: string, options: Partial<ChokidarOptions>) => WatchHandle
  exists?: (path: string) => boolean
  log?: Pick<Console, 'log' | 'warn'>
}
export function createWatchers(
  providers: Record<string, WatchProvider>,
  onEvent: (event: ChangeEvent) => void,
  { watch = chokidar.watch, exists = fs.existsSync, log = console }: WatchOptions = {}
) {
  let handles: WatchHandle[] = []
  let tail = Promise.resolve()
  let disposed = false
  let generation = 0
  function serialize(operation: () => Promise<void>) {
    const result = tail.then(operation)
    tail = result.catch(() => {}) // caller still receives the failure
    return result
  }
  async function stopGeneration() {
    const closing = handles
    handles = []
    generation++
    const results = await Promise.allSettled(closing.map((handle) => Promise.resolve().then(() => handle.close())))
    for (const result of results) {
      if (result.status === 'rejected') log.warn(`[watch] close failed; continuing with a fresh generation: ${result.reason?.message || result.reason}`)
    }
  }
  function start() {
    return serialize(async () => {
      await stopGeneration()
      if (disposed) return
      const currentGeneration = generation
      for (const provider of Object.values(providers)) {
        const spec = provider.watch
        if (!spec) continue
        for (const root of provider.loadRoots()) {
          const dir = spec.watchDir(root.dir)
          if (!exists(dir)) continue
          try {
            const options: Partial<ChokidarOptions> = { ignoreInitial: true, persistent: true, ignorePermissionErrors: true }
            const ignored = spec.ignored
            if (ignored) options.ignored = (absolute) => ignored(root.dir, absolute)
            const handle = watch(dir, options)
            handles.push(handle)
            const onFile = (absolute: string, removed = false) => {
              if (disposed || generation !== currentGeneration) return
              if (removed) invalidate(absolute)
              const event = spec.toEvent(root.id, root.dir, absolute)
              if (event) onEvent(event)
            }
            handle
              .on('add', (absolute) => onFile(absolute))
              .on('change', (absolute) => onFile(absolute))
              .on('unlink', (absolute) => onFile(absolute, true))
            handle.on('error', (error) => log.warn(`[watch] failed for ${dir}: ${error instanceof Error ? error.message : error}`))
            log.log(`[watch] ${provider.id}:${root.label} -> ${dir}`)
          } catch (error) {
            log.warn(`[watch] failed for ${dir}: ${error instanceof Error ? error.message : error}`)
          }
        }
      }
    })
  }
  return {
    start,
    stop: () => serialize(stopGeneration),
    close: () => {
      disposed = true
      return serialize(stopGeneration)
    },
  }
}
