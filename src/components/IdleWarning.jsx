import { useAuth } from '../lib/AuthContext.jsx'

// Shown for the last minute before the inactivity sign-out.
export default function IdleWarning() {
  const { idleSecondsLeft, stayActive, signOut } = useAuth()
  if (idleSecondsLeft === null) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" role="alertdialog" aria-modal="true">
      <div className="bg-white rounded-md max-w-sm w-full p-6 text-center">
        <h2 className="font-display font-bold text-lg text-navy-950 mb-2">Still there?</h2>
        <p className="text-sm text-navy-950/70 mb-5">
          For security you will be signed out in <b>{idleSecondsLeft}</b> second{idleSecondsLeft === 1 ? '' : 's'} because there has been no activity.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={stayActive} className="text-sm font-medium px-4 py-2 rounded-md bg-gold-500 text-white hover:bg-gold-600">
            Stay signed in
          </button>
          <button onClick={signOut} className="text-sm px-4 py-2 rounded-md border border-navy-950/20">
            Sign out now
          </button>
        </div>
      </div>
    </div>
  )
}
