'use client'

import { Suspense, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { GoogleIcon } from '@/app/app/components/GoogleIcon'
import { checkProfilePhotoSingleFace } from '@/lib/avatar-face-check'

function FinishContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [faceChecking, setFaceChecking] = useState(false)
  const [faceError, setFaceError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const input = e.currentTarget
    if (!file) return
    setFaceError(null)
    setError(null)
    setFaceChecking(true)
    try {
      const result = await checkProfilePhotoSingleFace(file)
      if (!result.ok) {
        setFaceError(result.message)
        input.value = ''
        return
      }
      setAvatarFile(file)
      setAvatarSrc((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
    } finally {
      setFaceChecking(false)
    }
  }

  async function handleSignIn() {
    if (!avatarFile) {
      setError('Please add a profile photo before continuing.')
      return
    }
    setError(null)
    setSigningIn(true)
    try {
      setUploading(true)
      const form = new FormData()
      form.set('file', avatarFile)
      const res = await fetch(`/api/avatar-upload-sms?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: form,
      })
      setUploading(false)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Photo upload failed.')
      }

      const supabase = getSupabase()
      if (!supabase) throw new Error('App not configured.')
      const origin = window.location.origin
      const redirectTo = `${origin}/auth/exchange?next=/app/how-it-works&sms_token=${encodeURIComponent(token)}`
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSigningIn(false)
      setUploading(false)
    }
  }

  if (!token) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Invalid link. Please text Fika to get a new one.</p>
      </div>
    )
  }

  const busy = faceChecking || uploading || signingIn

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', padding: '2.5rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', margin: 0 }}>
        One last step ☕
      </h1>
      <p style={{ color: 'var(--color-textSecondary)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        Add a photo so your match knows who to look for, then sign in with Google to verify your account.
      </p>

      {/* Avatar picker */}
      <div
        onClick={() => !busy && fileRef.current?.click()}
        style={{
          width: 110,
          height: 110,
          borderRadius: '50%',
          background: avatarSrc ? 'transparent' : 'var(--color-bg-soft)',
          border: faceError
            ? '2px solid var(--color-error)'
            : avatarSrc
            ? '2px solid var(--color-primary)'
            : '2px dashed var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: busy ? 'default' : 'pointer',
          overflow: 'hidden',
          flexShrink: 0,
        }}
        role="button"
        aria-label="Upload profile photo"
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="Your photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : faceChecking ? (
          <span className="spinner" style={{ width: 24, height: 24 }} aria-hidden />
        ) : (
          <span style={{ fontSize: '2rem' }}>📷</span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', marginTop: -8 }}>
        <button
          onClick={() => !busy && fileRef.current?.click()}
          disabled={busy}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-primary)',
            cursor: busy ? 'default' : 'pointer',
            fontSize: '0.9rem',
            padding: 0,
          }}
        >
          {faceChecking ? 'Checking photo…' : avatarSrc ? 'Change photo' : 'Add your photo'}
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-textSecondary)' }}>
          Must show your face clearly — one person only
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {faceError && (
        <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          {faceError}
        </p>
      )}

      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', textAlign: 'center', margin: 0 }}>
          {error}
        </p>
      )}

      <button
        className="btn-google"
        onClick={handleSignIn}
        disabled={busy}
        style={{ marginTop: '0.5rem' }}
      >
        {uploading ? (
          <>
            <span className="spinner spinner-dark" aria-hidden />
            Uploading photo…
          </>
        ) : signingIn ? (
          <>
            <span className="spinner spinner-dark" aria-hidden />
            Signing in…
          </>
        ) : (
          <>
            <GoogleIcon className="auth-google-icon" />
            Continue with Google
          </>
        )}
      </button>

      <p style={{ fontSize: '0.8rem', color: 'var(--color-textSecondary)', textAlign: 'center', margin: 0 }}>
        We use Google to verify your identity. We won't post anything.
      </p>
    </div>
  )
}

export default function FinishPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Loading…</p>
      </div>
    }>
      <FinishContent />
    </Suspense>
  )
}
