import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

const getSession = vi.fn()
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession(), onAuthStateChange: () => onAuthStateChange() } },
}))

vi.mock('../offline/cache', () => ({
  setOfflineUserId: vi.fn(),
  setOfflineAccessToken: vi.fn(),
}))

const CACHED_USER = { id: 'user-1', email: 'cook@example.com' }

function Probe() {
  const { loading, signedOut, user } = useAuth()
  return (
    <ul>
      <li>loading:{String(loading)}</li>
      <li>signedOut:{String(signedOut)}</li>
      <li>user:{user?.id ?? 'none'}</li>
    </ul>
  )
}

function renderProbe() {
  return render(<AuthProvider><Probe /></AuthProvider>)
}

beforeEach(() => {
  localStorage.setItem('kitchen-offline-user-v1', JSON.stringify(CACHED_USER))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AuthProvider', () => {
  it('signs out a remembered user once the server reports no session', async () => {
    // The exact shape of an expired refresh token: the client still remembers who
    // they are, but the session it was holding is gone.
    getSession.mockResolvedValue({ data: { session: null } })
    renderProbe()

    await waitFor(() => expect(screen.getByText('loading:false')).toBeInTheDocument())
    expect(screen.getByText('signedOut:true')).toBeInTheDocument()
  })

  it('keeps a remembered user signed in when the session check fails', async () => {
    // A failed request is not evidence of being signed out, so offline access holds.
    getSession.mockRejectedValue(new Error('Failed to fetch'))
    renderProbe()

    await waitFor(() => expect(screen.getByText('loading:false')).toBeInTheDocument())
    expect(screen.getByText('signedOut:false')).toBeInTheDocument()
    expect(screen.getByText('user:user-1')).toBeInTheDocument()
  })

  it('stops loading even when the session check never comes back', async () => {
    vi.useFakeTimers()
    getSession.mockReturnValue(new Promise(() => {}))
    renderProbe()

    expect(screen.getByText('loading:true')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(screen.getByText('loading:false')).toBeInTheDocument()
  })

  it('leaves a live session signed in', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'token', user: { id: 'user-1' } } },
    })
    renderProbe()

    await waitFor(() => expect(screen.getByText('loading:false')).toBeInTheDocument())
    expect(screen.getByText('signedOut:false')).toBeInTheDocument()
  })
})
