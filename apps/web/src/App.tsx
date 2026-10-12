import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { hasPassedEntry, rememberEntryTarget } from './lib/entry'
import { GateScreen } from './screens/GateScreen'
import { AuthScreen } from './screens/AuthScreen'

const Shell = lazy(() => import('./screens/Shell').then((mod) => ({ default: mod.Shell })))
const AdminConsole = lazy(() => import('./screens/AdminConsole').then((mod) => ({ default: mod.AdminConsole })))
const InvitePage = lazy(() => import('./screens/InvitePage').then((mod) => ({ default: mod.InvitePage })))

function EntryGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const passed = hasPassedEntry()
  useEffect(() => {
    if (hasPassedEntry()) return
    rememberEntryTarget(`${location.pathname}${location.search}`)
    navigate('/', { replace: true })
  }, [location.pathname, location.search, navigate])
  if (!passed) return <main className="gate" />
  return children
}

export function App() {
  return (
    <Suspense fallback={<main className="gate" />}>
      <Routes>
        <Route path="/" element={<GateScreen />} />
        <Route path="/auth" element={<EntryGate><AuthScreen /></EntryGate>} />
        <Route path="/app" element={<EntryGate><Shell /></EntryGate>} />
        <Route path="/invite/:token" element={<EntryGate><InvitePage /></EntryGate>} />
        <Route path="/console" element={<EntryGate><AdminConsole /></EntryGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
