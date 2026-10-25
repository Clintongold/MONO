import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

const links = [
  { to: '/', label: 'Overview', end: true },
  { to: '/mandates', label: 'Mandates' },
  { to: '/schedule', label: 'Monthly schedule' },
  { to: '/collection', label: 'Collection schedule' },
  { to: '/collected', label: 'Successful collections' },
  { to: '/reconciliation', label: 'Reconciliation' },
]

export default function Sidebar({ mobileOpen, onNavigate }) {
  const { user, signOut } = useAuth()
  return (
    <aside
      className={`
        w-64 shrink-0 bg-navy-950 text-navy-100 flex flex-col
        fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
        md:static md:translate-x-0
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
    >
      <div className="px-6 py-7 border-b border-white/10">
        <p className="font-display font-extrabold text-lg text-white tracking-tight">
          OGFZA
        </p>
        <p className="text-xs text-navy-100/70 mt-0.5">Payment Operations</p>
      </div>
      <nav className="flex-1 px-3 py-5 space-y-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-gold-400'
                  : 'text-navy-100/80 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-6 py-5 border-t border-white/10 text-xs text-navy-100/50">
        <p className="truncate" title={user?.email}>
          {user?.email}
        </p>
        <button
          onClick={signOut}
          className="mt-2 text-navy-100/80 hover:text-white underline underline-offset-2"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
