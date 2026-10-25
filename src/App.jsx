import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Overview from './pages/Overview.jsx'
import Mandates from './pages/Mandates.jsx'
import CollectionSchedule from './pages/CollectionSchedule.jsx'
import CollectionsReport from './pages/CollectionsReport.jsx'
import Reconciliation from './pages/Reconciliation.jsx'
import MonthlySchedule from './pages/MonthlySchedule.jsx'
import Login from './pages/Login.jsx'
import IdleWarning from './components/IdleWarning.jsx'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'

function FullScreenMessage({ children }) {
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center text-navy-100">{children}</div>
    </div>
  )
}

function Gate() {
  const { session, isExecutive, accessError, user, signOut } = useAuth()

  // Still checking the saved session, or still asking the database.
  if (session === undefined || (session && isExecutive === null)) {
    return (
      <FullScreenMessage>
        <p className="text-sm text-navy-100/70">Loading…</p>
      </FullScreenMessage>
    )
  }

  if (!session) return <Login />

  // Signed in, but not on the executives list: show nothing from the database.
  if (!isExecutive) {
    return (
      <FullScreenMessage>
        <h1 className="font-display font-bold text-lg text-white mb-2">Not authorised</h1>
        <p className="text-sm text-navy-100/80 mb-1">
          {user?.email} is signed in but is not on the executives list.
        </p>
        <p className="text-sm text-navy-100/60 mb-5">
          Ask the secretariat to add you, then sign in again.
        </p>
        {accessError && <p className="text-xs text-bad mb-4">{accessError}</p>}
        <button
          onClick={signOut}
          className="text-sm font-medium px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20"
        >
          Sign out
        </button>
      </FullScreenMessage>
    )
  }

  return (
    <Layout>
      <IdleWarning />
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/mandates" element={<Mandates />} />
        <Route path="/collection" element={<CollectionSchedule />} />
        <Route path="/collected" element={<CollectionsReport />} />
        <Route path="/schedule" element={<MonthlySchedule />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
