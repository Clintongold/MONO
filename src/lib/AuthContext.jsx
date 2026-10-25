import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from './supabaseClient.js'

const AuthContext = createContext(null)

// Inactivity sign-out. Signed in and idle for IDLE_LIMIT_MS means signed out.
// A warning appears WARN_BEFORE_MS earlier and must be clicked to stay signed in.
// Idle time is measured with clock timestamps (not a countdown timer), so a
// phone that sleeps or a laptop that is closed is still signed out when it wakes.
const IDLE_LIMIT_MS = 15 * 60 * 1000
const WARN_BEFORE_MS = 60 * 1000
const ACTIVITY_KEY = 'ogfza_last_activity' // shared across tabs of this browser
const NOTICE_KEY = 'ogfza_signed_out_notice'
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

function readLast() {
  try {
    const v = Number(localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch (_) {
    return 0
  }
}
function writeLast(t) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t))
  } catch (_) { /* storage blocked: the in-memory value still works for this tab */ }
}
export function takeSignedOutNotice() {
  try {
    const v = sessionStorage.getItem(NOTICE_KEY)
    sessionStorage.removeItem(NOTICE_KEY)
    return v
  } catch (_) {
    return null
  }
}

// session:  undefined = still checking, null = signed out, object = signed in
// isExecutive: null = still checking, true / false once the database has answered
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [isExecutive, setIsExecutive] = useState(null)
  const [accessError, setAccessError] = useState(null)
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(null) // null = no warning showing
  const lastActivity = useRef(Date.now())
  const warningShown = useRef(false)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Ask the database whether this signed-in person is on the executives list.
  // (Done in its own effect, not inside the auth callback, to avoid a known
  // deadlock when calling Supabase from onAuthStateChange.)
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (session === undefined) return
    if (!userId) {
      setIsExecutive(false)
      setAccessError(null)
      return
    }
    let active = true
    setIsExecutive(null)
    setAccessError(null)
    supabase.rpc('is_executive').then(({ data, error }) => {
      if (!active) return
      if (error) {
        setAccessError(error.message)
        setIsExecutive(false)
      } else {
        setIsExecutive(data === true)
      }
    })
    return () => {
      active = false
    }
  }, [session, userId])

  // Idle watcher: runs only while someone is signed in.
  useEffect(() => {
    if (!userId) {
      setIdleSecondsLeft(null)
      warningShown.current = false
      return
    }
    lastActivity.current = Date.now()
    writeLast(lastActivity.current)

    let lastWrite = 0
    const onActivity = () => {
      if (warningShown.current) return // once the warning is up, only its button counts
      const now = Date.now()
      lastActivity.current = now
      if (now - lastWrite > 1000) {
        lastWrite = now
        writeLast(now)
      }
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    const check = () => {
      // Another tab may have been used more recently.
      const last = Math.max(lastActivity.current, readLast())
      const idle = Date.now() - last
      if (idle >= IDLE_LIMIT_MS) {
        try {
          sessionStorage.setItem(NOTICE_KEY, 'You were signed out after 15 minutes of inactivity.')
        } catch (_) { /* ignore */ }
        warningShown.current = false
        setIdleSecondsLeft(null)
        supabase.auth.signOut()
      } else if (idle >= IDLE_LIMIT_MS - WARN_BEFORE_MS) {
        warningShown.current = true
        setIdleSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idle) / 1000))
      } else {
        warningShown.current = false
        setIdleSecondsLeft(null)
      }
    }
    const timer = setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [userId])

  const stayActive = useCallback(() => {
    warningShown.current = false
    lastActivity.current = Date.now()
    writeLast(lastActivity.current)
    setIdleSecondsLeft(null)
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    isExecutive,
    accessError,
    signIn,
    signOut,
    idleSecondsLeft,
    stayActive,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
