import { ActivityIcon } from './icons.jsx'
import { PanelLeftIcon, SearchIcon } from './shellIcons.jsx'

// The collapsed sidebar: a thin rail that keeps the three things you still
// need reachable — home, search (Ctrl+K), and "bring the sidebar back".
export default function SidebarRail({ onHome, onSearch, onExpand }) {
  const btn = 'w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-700 transition-colors'
  return (
    <div className="w-11 h-full shrink-0 flex flex-col items-center py-2 gap-1 bg-ink-900 border-r border-zinc-800">
      <button onClick={onHome} title="Home" className={`${btn} text-emerald-400 hover:text-emerald-300`}>
        <ActivityIcon className="w-5 h-5" />
      </button>
      <button onClick={onSearch} title="Search projects & sessions  (Ctrl+K)" className={btn}>
        <SearchIcon />
      </button>
      <button onClick={onExpand} title="Show sidebar  (Ctrl+B)" className={btn}>
        <PanelLeftIcon />
      </button>
    </div>
  )
}
