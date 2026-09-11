import { providerColor, providerLabel } from '../../lib/providerColors.ts'

export const homeSourceLinkClass = 'text-sky-400 hover:underline text-left break-words'

export function HomeSourceLabel({
  source,
  providers,
}: {
  source: { provider?: string; root?: string; rootLabel?: string }
  providers: readonly import('../../lib/providerColors.ts').ColorProvider[]
}) {
  return (
    <span className={`text-xs ${providerColor(providers, source.provider).text}`}>
      {providerLabel(providers, source.provider)} <span className="text-zinc-500">/ {source.rootLabel || source.root}</span>
    </span>
  )
}
