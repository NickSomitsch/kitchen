import { ArrowLeft, Eye, EyeOff, Leaf, LockKeyhole, Mail } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, FieldError } from '../components/ui'
import { getErrorMessage } from '../lib/errors'
import { getAppUrl, supabase } from '../lib/supabase'

type AuthMode = 'sign-in' | 'sign-up' | 'forgot' | 'update-password'

export function AuthPage() {
  const { user, loading, signedOut, passwordRecovery, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const activeMode: AuthMode = passwordRecovery ? 'update-password' : mode

  // `signedOut` matters here: the remembered user outlives the session, and without
  // this check the guard sends them to sign in and this line sends them straight back.
  if (!loading && user && !signedOut && activeMode !== 'update-password') return <Navigate to="/" replace />

  function switchMode(nextMode: AuthMode) {
    if (passwordRecovery) clearPasswordRecovery()
    setMode(nextMode)
    setError('')
    setNotice('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (activeMode === 'forgot') {
        if (!email.includes('@')) throw new Error('Enter a valid email address.')
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: getAppUrl(),
        })
        if (resetError) throw resetError
        setNotice('Check your inbox for a password-reset link.')
      } else if (activeMode === 'update-password') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.')
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        clearPasswordRecovery()
        navigate('/', { replace: true })
      } else if (activeMode === 'sign-up') {
        if (!displayName.trim()) throw new Error('Enter your name.')
        if (!email.includes('@')) throw new Error('Enter a valid email address.')
        if (password.length < 8) throw new Error('Password must be at least 8 characters.')
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: getAppUrl(),
          },
        })
        if (signUpError) throw signUpError
        if (data.session) navigate('/onboarding', { replace: true })
        else setNotice('Check your inbox to verify your email, then sign in.')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
        navigate('/', { replace: true })
      }
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<AuthMode, { eyebrow: string; title: string; description: string }> = {
    'sign-in': {
      eyebrow: 'Welcome back',
      title: 'Your kitchen, in order.',
      description: 'Sign in to see what your household has on hand.',
    },
    'sign-up': {
      eyebrow: 'Create an account',
      title: 'Waste less. Cook more.',
      description: 'Start a household inventory or join one with a code.',
    },
    forgot: {
      eyebrow: 'Password help',
      title: 'Reset your password.',
      description: 'We’ll send a secure reset link to your email.',
    },
    'update-password': {
      eyebrow: 'Choose a password',
      title: 'Set a new password.',
      description: 'Use at least eight characters for your new password.',
    },
  }

  const copy = titles[activeMode]
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Kitchen inventory introduction">
        <div className="auth-brand"><div className="brand-mark light"><span>K</span></div> Kitchen</div>
        <div className="story-content">
          <span className="story-icon"><Leaf size={23} /></span>
          <blockquote>“The easiest ingredient to use is the one you remember you have.”</blockquote>
          <p>One calm place for everything in your fridge, freezer, and pantry.</p>
        </div>
        <div className="story-orbits" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {(activeMode === 'forgot' || activeMode === 'update-password') && (
            <button className="back-link" onClick={() => switchMode('sign-in')}>
              <ArrowLeft size={17} /> Back to sign in
            </button>
          )}
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="auth-description">{copy.description}</p>
          <form onSubmit={submit} className="auth-form">
            {activeMode === 'sign-up' ? (
              <label>
                <span>Your name</span>
                <div className="input-with-icon"><Leaf size={18} /><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Alex" /></div>
              </label>
            ) : null}
            {activeMode !== 'update-password' ? (
              <label>
                <span>Email address</span>
                <div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></div>
              </label>
            ) : null}
            {activeMode !== 'forgot' ? (
              <label>
                <span>{activeMode === 'update-password' ? 'New password' : 'Password'}</span>
                <div className="input-with-icon"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={activeMode === 'sign-up' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </label>
            ) : null}
            {activeMode === 'sign-in' ? <button type="button" className="forgot-link" onClick={() => switchMode('forgot')}>Forgot password?</button> : null}
            <FieldError message={error} />
            {notice ? <div className="notice notice-success" role="status">{notice}</div> : null}
            <Button type="submit" busy={busy} className="auth-submit">
              {activeMode === 'sign-in' ? 'Sign in' : activeMode === 'sign-up' ? 'Create account' : activeMode === 'forgot' ? 'Send reset link' : 'Save password'}
            </Button>
          </form>
          {activeMode === 'sign-in' ? <p className="auth-switch">New to Kitchen? <button onClick={() => switchMode('sign-up')}>Create an account</button></p> : null}
          {activeMode === 'sign-up' ? <p className="auth-switch">Already have an account? <button onClick={() => switchMode('sign-in')}>Sign in</button></p> : null}
        </div>
      </section>
    </main>
  )
}
