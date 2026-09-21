import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and fill in your project URL and anon/publishable key.'
  )
}

// This is the anon/publishable key only - safe for client-side code.
// Access is governed by Row Level Security policies on the database,
// not by keeping this key secret. The service_role key must never
// appear in this app.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
