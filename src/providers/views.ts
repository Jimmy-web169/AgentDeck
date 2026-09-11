export function rawRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
import type { ComponentType, ReactNode } from 'react'
import type { Target } from '../../shared/types.d.ts'
import type { SessionProvider } from '../SessionApp.tsx'

export interface HomePageProps {
  root: string
  focus?: Target['focus']
  onOpen?: (target: Target) => void
  initialProject?: string | null
  breadcrumbPrefix?: ReactNode
  embedded?: boolean
}
export interface UIProvider extends SessionProvider {
  label: string
  vendor?: string
  homeHint?: string
  color?: string
  accent?: string
  rootStatusField?: string
  docsMap?: Record<string, string>
  homePages: Record<string, ComponentType<HomePageProps>>
}
