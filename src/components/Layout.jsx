import { useState } from 'react'
import Sidebar from './Sidebar.jsx'

export default function Layout({ children }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-navy-950 text-white flex items-center justify-between px-4 z-30">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-1.5 -ml-1.5 rounded-md hover:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="font-display font-bold text-sm tracking-tight">OGFZA Payments</span>
        <span className="w-8" />
      </div>

      {/* Backdrop, mobile only, when sidebar is open */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-30"
        />
      )}

      <Sidebar mobileOpen={open} onNavigate={() => setOpen(false)} />

      <main className="flex-1 min-w-0 md:ml-0 mt-14 md:mt-0">{children}</main>
    </div>
  )
}
