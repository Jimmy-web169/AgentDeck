// Native JSON stays unknown. These shape guards are shared primitives, not a
// guessed schema for provider-owned formats. Raw payloads remain untouched.
export function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
export function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
export function optionalTimestamp(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}
export function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
