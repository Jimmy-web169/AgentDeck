// Per-provider accent used by the shell chrome (tab dots, the active tab's top
// bar, quick-switcher rows). Providers name a color in their config (`color`);
// the classes are spelled out here so Tailwind's scanner sees them.
const COLORS = {
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', bar: 'rgb(var(--emerald-400))' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', bar: 'rgb(var(--sky-400))' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', bar: 'rgb(var(--violet-400))' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', bar: 'rgb(var(--amber-400))' },
  zinc: { dot: 'bg-zinc-500', text: 'text-zinc-400', bar: 'rgb(var(--zinc-500))' },
}

export function providerColor(providers, id) {
  const name = providers?.find((p) => p.id === id)?.color
  return COLORS[name] || COLORS.zinc
}

export function providerLabel(providers, id) {
  return providers?.find((p) => p.id === id)?.label || id || ''
}
