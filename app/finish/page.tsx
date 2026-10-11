'use client'

import { Suspense, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { checkProfilePhotoSingleFace } from '@/lib/avatar-face-check'

const CONCIERGE_NUMBER = process.env.NEXT_PUBLIC_SENDBLUE_CONCIERGE_NUMBER?.trim() || '+13102102404'

type Step = 'photo' | 'otp' | 'done'

function FinishContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [faceChecking, setFaceChecking] = useState(false)
  const [faceError, setFaceError] = useState<string | null>(null)
  const [confirmedIntent, setConfirmedIntent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [step, setStep] = useState<Step>('photo')
  const [phoneLast4, setPhoneLast4] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const otpRef = useRef<HTMLInputElement>(null)

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

  function startResendCooldown() {
    setResendCooldown(30)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function uploadPhoto(): Promise<boolean> {
    if (!avatarFile) return false
    setUploading(true)
    const form = new FormData()
    form.set('file', avatarFile)
    const res = await fetch(`/api/avatar-upload-sms?token=${encodeURIComponent(token)}&confirm_intent=1`, {
      method: 'POST',
      body: form,
    })
    setUploading(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError((data as { error?: string }).error ?? 'Photo upload failed.')
      return false
    }
    return true
  }

  async function handleSendCode() {
    if (!avatarFile) { setError('Please add a profile photo before continuing.'); return }
    if (!confirmedIntent) { setError('Please confirm the commitments above before continuing.'); return }
    setError(null)
    setSending(true)
    try {
      const uploaded = await uploadPhoto()
      if (!uploaded) return
      const res = await fetch('/api/send-finish-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to send code.')
      setPhoneLast4((data as { phoneLast4?: string }).phoneLast4 ?? '')
      setStep('otp')
      startResendCooldown()
      setTimeout(() => otpRef.current?.focus(), 100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/send-finish-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to resend.')
      startResendCooldown()
      setOtpCode('')
      setTimeout(() => otpRef.current?.focus(), 100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend.')
    } finally {
      setSending(false)
    }
  }

  async function handleVerify() {
    if (otpCode.length !== 6) { setError('Enter the 6-digit code from your texts.'); return }
    setError(null)
    setVerifying(true)
    try {
      const res = await fetch('/api/verify-finish-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, code: otpCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Verification failed.')
      const magicLink = (data as { magic_link?: string | null }).magic_link
      if (magicLink) {
        window.location.href = magicLink
      } else {
        setStep('done')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.')
      setVerifying(false)
    }
  }

  if (!token) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-textSecondary)' }}>Invalid link. Please text Fika to get a new one.</p>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '3rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', textAlign: 'center' }}>
        <span style={{ fontSize: '3rem' }}>☕</span>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>You&apos;re in ☕</h1>
        <p style={{ color: 'var(--color-textSecondary)', margin: 0, lineHeight: 1.5 }}>
          Check your texts — Jay will reach out shortly to set up a quick chat before your first Fika.
        </p>
        <a
          href={`sms:${CONCIERGE_NUMBER}`}
          className="btn btn-primary"
          style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
        >
          Open messages
        </a>
      </div>
    )
  }

  if (step === 'otp') {
    const busy = sending || verifying
    return (
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '2.5rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', margin: 0 }}>
          Check your texts 📱
        </h1>
        <p style={{ color: 'var(--color-textSecondary)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          We sent a 6-digit code to the number ending in <strong>…{phoneLast4}</strong>.
        </p>

        <input
          ref={otpRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          className="auth-input"
          placeholder="123456"
          maxLength={6}
          value={otpCode}
          onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '')); setError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && !busy && handleVerify()}
          disabled={busy}
          style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.3em', width: '100%' }}
        />

        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', textAlign: 'center', margin: 0 }} role="alert">
            {error}
          </p>
        )}

        <button
          className="btn btn-primary"
          onClick={handleVerify}
          disabled={busy || otpCode.length !== 6}
          style={{ width: '100%' }}
        >
          {verifying ? (
            <><span className="spinner" aria-hidden /> Verifying…</>
          ) : 'Verify & finish'}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={busy || resendCooldown > 0}
          style={{
            background: 'none',
            border: 'none',
            color: resendCooldown > 0 ? 'var(--color-textSecondary)' : 'var(--color-primary)',
            cursor: busy || resendCooldown > 0 ? 'default' : 'pointer',
            fontSize: '0.875rem',
            padding: 0,
          }}
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : sending ? 'Sending…' : 'Resend code'}
        </button>
      </div>
    )
  }

  const busy = faceChecking || uploading || sending

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', padding: '2.5rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', margin: 0 }}>
        Almost there ☕
      </h1>
      <p style={{ color: 'var(--color-textSecondary)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        Add a photo so people know who to look for, then verify with a quick code to your phone.
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

      {/* Safety commitment */}
      <div style={{
        background: 'var(--color-bg-soft)',
        borderRadius: 12,
        padding: '1.25rem',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}>
        <p style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>Before your first Fika</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-textSecondary)', margin: 0, lineHeight: 1.5 }}>
          Fika sets you up 1-on-1 with a real person for in-person coffee. They'll show up having agreed to the same things you're about to.
        </p>
        <ul style={{ fontSize: '0.85rem', color: 'var(--color-textSecondary)', margin: 0, paddingLeft: '1.25rem', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <li>Your photo is recent and actually you. Your name and answers are accurate.</li>
          <li>You're 18 or older.</li>
          <li>You're here to genuinely connect — not to recruit, sell, or solicit.</li>
          <li>You'll show up when you confirm a time. If plans change, you'll let us know rather than ghosting.</li>
          <li>You'll treat your match with respect — no harassment, no sharing their info or photos.</li>
          <li>You'll meet at the venue Fika suggests (always a public spot).</li>
          <li>Fika reserves the right to remove or block any member at any time for behavior that makes others feel unsafe.</li>
          <li>If something feels off, text us at +1 (310) 210-2404. We take reports seriously and respond quickly.</li>
        </ul>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: busy ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmedIntent}
            onChange={(e) => !busy && setConfirmedIntent(e.target.checked)}
            disabled={busy}
            style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--color-primary)', width: 16, height: 16 }}
          />
          <span style={{ fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text)' }}>
            I confirm all of the above — I'm here to make a genuine in-person connection.
          </span>
        </label>
      </div>

      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: '0.875rem', textAlign: 'center', margin: 0 }}>
          {error}
        </p>
      )}

      <button
        className="btn btn-primary"
        onClick={handleSendCode}
        disabled={busy || !avatarFile || !confirmedIntent}
        style={{ width: '100%', marginTop: '0.5rem' }}
      >
        {uploading ? (
          <><span className="spinner" aria-hidden /> Uploading photo…</>
        ) : sending ? (
          <><span className="spinner" aria-hidden /> Sending code…</>
        ) : (
          'Send verification code'
        )}
      </button>

      <p style={{ fontSize: '0.8rem', color: 'var(--color-textSecondary)', textAlign: 'center', margin: 0 }}>
        We'll text a 6-digit code to the number you signed up with.
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
