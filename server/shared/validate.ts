import type { Readable } from 'node:stream'

export const badRequest = (message: string, status = 400) => Object.assign(new Error(message), { status })
export function requireFields(body: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('expected JSON object')
  const record = body as Record<string, unknown>
  for (const field of fields) {
    if (record[field] == null || record[field] === '') throw badRequest(`missing ${field}`)
    if (typeof record[field] !== 'string') throw badRequest(`invalid ${field}: expected string`)
  }
  return record
}
export function requireQuery(query: URLSearchParams, fields: readonly string[]) {
  for (const field of fields) if (!query.get(field)) throw badRequest(`missing ${field}`)
  return query
}
type FieldType = 'string' | 'object' | 'strings'
export interface InputPolicy {
  query?: readonly string[]
  required?: readonly string[]
  optional?: Record<string, FieldType>
}
export type Handler = (query: URLSearchParams, body: unknown) => unknown

export function validated(handler: Handler, policy: InputPolicy): Handler {
  return (query, body) => {
    requireQuery(query, policy.query || [])
    if (policy.required || policy.optional) {
      const record = requireFields(body, policy.required || [])
      for (const [field, type] of Object.entries(policy.optional || {})) {
        const value = record[field]
        if (value == null) continue
        const valid =
          type === 'strings'
            ? Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
            : type === 'object'
              ? typeof value === 'object' && !Array.isArray(value)
              : typeof value === 'string'
        if (!valid) throw badRequest(`invalid ${field}: expected ${type}`)
      }
    }
    return handler(query, body)
  }
}

// Count bytes, preserve split UTF-8, and drain rejected bodies so a client can
// receive its response instead of having the socket destroyed underneath it.
export function readJsonBody(request: Readable, { limit = 5_000_000 } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0,
      settled = false
    const fail = (error: Error) => {
      if (!settled) {
        settled = true
        chunks.length = 0
        reject(error)
      }
    }
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > limit) {
        fail(badRequest('request body too large', 413))
        return
      }
      chunks.push(bytes)
    })
    request.once('end', () => {
      if (settled) return
      try {
        const value: unknown = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        settled = true
        resolve(value)
      } catch {
        fail(badRequest('invalid JSON body'))
      }
      chunks.length = 0
    })
    request.once('error', fail)
    request.once('aborted', () => fail(badRequest('request body aborted')))
  })
}
