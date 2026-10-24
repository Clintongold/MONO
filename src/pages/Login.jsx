import { useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    if (err) {
      // One generic message: do not reveal whether the email exists.
      setError('Incorrect email or password.')
      setSubmitting(false)
    }
    // On success the auth listener swaps this screen out.
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-display font-extrabold text-2xl text-white tracking-tight">OGFZA</p>
          <p className="text-sm text-navy-100/70 mt-1">Payment Operations</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-md border-t-2 border-gold-500 px-6 py-7"
        >
          <h1 className="font-display font-bold text-lg text-navy-950 mb-1">Executive sign in</h1>
          <p className="text-xs text-navy-950/60 mb-5">
            Access is limited to authorised cooperative executives.
          </p>

          {error && (
            <div role="alert" className="mb-4 rounded-md bg-bad/10 text-bad text-sm px-3 py-2">
              {error}
            </div>
          )}

          <label htmlFor="email" className="block text-sm text-navy-950/70 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-navy-950/15 rounded-md text-sm px-3 py-2.5 mb-4 bg-white"
          />

          <label htmlFor="password" className="block text-sm text-navy-950/70 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-navy-950/15 rounded-md text-sm px-3 py-2.5 mb-5 bg-white"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full text-sm font-medium px-3 py-2.5 rounded-md bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
