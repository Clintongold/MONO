import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient.js'

const AuthContext = createContext(null)

// session:  undefined = still checking, null = signed out, object = signed in
// isExecutive: null = still checking, true / false once the database has answered
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [isExecutive, setIsExecutive] = useState(null)
  const [accessError, setAccessError] = useState(null)

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
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
