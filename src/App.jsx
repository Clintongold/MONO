import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Overview from './pages/Overview.jsx'
import Mandates from './pages/Mandates.jsx'
import CollectionSchedule from './pages/CollectionSchedule.jsx'
import Reconciliation from './pages/Reconciliation.jsx'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/mandates" element={<Mandates />} />
        <Route path="/collection" element={<CollectionSchedule />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
      </Routes>
    </Layout>
  )
}
