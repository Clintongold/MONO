import { supabase } from './supabaseClient.js'

// Calls an Edge Function with a fresh sign-in token. On a phone the browser can pause the
// page, so the token may have expired without refreshing: getSession() refreshes it, and a
// 401 triggers one more refresh and a single retry before the user is asked to sign in again.
export async function invokeFn(name, body) {
  await supabase.auth.getSession()
  let res = await supabase.functions.invoke(name, { body })
  if (res.error?.context?.status === 401) {
    const { error: refreshErr } = await supabase.auth.refreshSession()
    if (!refreshErr) res = await supabase.functions.invoke(name, { body })
  }
  return res
}

export const SESSION_EXPIRED_TEXT = 'Your sign-in has expired. Sign out, sign in again, then try again. Nothing was created.'
