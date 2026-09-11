// A fixture precondition must fail at runtime as well as narrow its type.
export function required<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('Required fixture value is missing')
  return value
}
