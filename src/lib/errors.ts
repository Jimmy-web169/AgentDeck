// Errors from native APIs, promises and provider responses need not be Error objects.
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message ?? '')
  return error == null ? '' : String(error)
}
