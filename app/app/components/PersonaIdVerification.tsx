'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { VerifiedBadge } from '@/app/app/components/VerifiedBadge'

type PersonaClientLike = {
  open: () => void
  destroy?: () => void
}

type PersonaConstructor = new (opts: {
  templateId: string
  environmentId: string
  referenceId: string
  /** Required when our page is nested in iframes; also helps Persona match the allowlisted origin (include https://). */
  frameAncestors?: string[]
  messageTargetOrigin?: string
  onReady?: () => void
  onComplete: (args: { inquiryId: string; status?: string }) => void | Promise<void>
  onCancel?: () => void
  onError?: (e: unknown) => void
}) => PersonaClientLike

const PERSONA_SCRIPT_SRC = 'https://cdn.withpersona.com/dist/persona-v5.5.0.js'

type PersonaIdVerificationProps = {
  userId: string
  idVerifiedAt: string | null
  onVerified: () => void | Promise<void>
  /** Primary = blue CTA; muted = gray (secondary). */
  buttonVariant?: 'primary' | 'muted'
  /** Optional line under the button (e.g. on pages without intro copy above). Omit to hide. */
  hint?: string | null
}

export function PersonaIdVerification({
  userId,
  idVerifiedAt,
  onVerified,
  buttonVariant = 'primary',
  hint,
}: PersonaIdVerificationProps) {
  const [scriptReady, setScriptReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef<PersonaClientLike | null>(null)
  const onVerifiedRef = useRef(onVerified)
  onVerifiedRef.current = onVerified

  const templateId = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID?.trim()
  const environmentId = process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID?.trim()
  const configured = Boolean(templateId && environmentId)
  /** Embedded JS SDK loads /widget with an inquiry template. vtmpl_ = verification template → Persona returns 404. */
  const templateIdLooksWrong = Boolean(templateId?.startsWith('vtmpl_'))

  const destroyClient = useCallback(() => {
    try {
      clientRef.current?.destroy?.()
    } catch {
      /* ignore */
    }
    clientRef.current = null
  }, [])

  useEffect(() => {
    return () => destroyClient()
  }, [destroyClient])

  const ensureClient = useCallback(() => {
    if (typeof window === 'undefined' || !templateId || !environmentId) return null
    const w = window as unknown as { Persona?: { Client: PersonaConstructor } }
    const Ctor = w.Persona?.Client
    if (!Ctor) {
      setLoadError('Persona failed to load. Disable ad blockers or try another browser.')
      return null
    }
    if (clientRef.current) return clientRef.current

    const iframeOrigin =
      process.env.NEXT_PUBLIC_PERSONA_IFRAME_ORIGIN?.trim() || window.location.origin

    const client = new Ctor({
      templateId,
      environmentId,
      referenceId: userId,
      frameAncestors: [iframeOrigin],
      messageTargetOrigin: iframeOrigin,
      onComplete: async ({ inquiryId }) => {
        setBusy(true)
        setError(null)
        try {
          const supabase = getSupabase()
          const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
          if (!session?.access_token) {
            setError('Session expired. Sign in again and retry.')
            return
          }
          const res = await fetch('/api/persona/complete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ inquiryId }),
          })
          const payload = await res.json().catch(() => ({}))
          if (!res.ok) {
            setError(typeof payload?.error === 'string' ? payload.error : 'Verification could not be saved.')
            return
          }
          await onVerifiedRef.current()
        } catch {
          setError('Something went wrong. Try again.')
        } finally {
          setBusy(false)
        }
      },
      onCancel: () => setBusy(false),
      onError: () => {
        setBusy(false)
        setError('Persona could not start. Check your connection and try again.')
      },
    })
    clientRef.current = client
    return client
  }, [templateId, environmentId, userId])

  useEffect(() => {
    if (idVerifiedAt) destroyClient()
  }, [idVerifiedAt, destroyClient])

  /** Next.js Script onLoad often does not run when the file is already cached or deduped (SPA nav); Persona is still on window. */
  useEffect(() => {
    if (!configured || idVerifiedAt) return
    const hasPersona = () => {
      const w = typeof window !== 'undefined' ? (window as unknown as { Persona?: { Client?: unknown } }) : null
      return Boolean(w?.Persona?.Client)
    }
    if (hasPersona()) {
      setScriptReady(true)
      setLoadError(null)
      return
    }
    let attempts = 0
    const maxAttempts = 80
    const t = window.setInterval(() => {
      attempts += 1
      if (hasPersona()) {
        setScriptReady(true)
        setLoadError(null)
        window.clearInterval(t)
      } else if (attempts >= maxAttempts) {
        window.clearInterval(t)
      }
    }, 100)
    return () => window.clearInterval(t)
  }, [configured, idVerifiedAt])

  const markScriptReady = useCallback(() => {
    setScriptReady(true)
    setLoadError(null)
  }, [])

  if (!configured) {
    return (
      <p className="profile-persona-unconfigured" style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem' }}>
        ID verification is not configured for this environment.
      </p>
    )
  }

  if (templateIdLooksWrong) {
    return (
      <div className="profile-persona-actions">
        <p className="onboarding-error" role="alert">
          <strong>Wrong template type.</strong> This value starts with <code>vtmpl_</code> (a{' '}
          <strong>Verification</strong> template). The embedded flow needs an <strong>Inquiry</strong> template ID
          starting with <code>itmpl_</code>. In Persona Dashboard open <strong>Inquiry Templates</strong>, pick or
          create a flow that includes your ID check, copy its template ID, and set{' '}
          <code>NEXT_PUBLIC_PERSONA_TEMPLATE_ID</code> to that <code>itmpl_…</code> value (same environment as{' '}
          <code>NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID</code>).
        </p>
      </div>
    )
  }

  if (idVerifiedAt) {
    return (
      <div className="profile-persona-verified">
        <VerifiedBadge />
        <span>Your government ID is verified.</span>
      </div>
    )
  }

  return (
    <>
      <Script
        src={PERSONA_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={markScriptReady}
        onReady={markScriptReady}
        onError={() => {
          setLoadError('Could not load Persona. Check your network or try again.')
        }}
      />
      <div className="profile-persona-actions">
        <button
          type="button"
          className={buttonVariant === 'muted' ? 'btn btn-primary-muted' : 'btn btn-primary'}
          disabled={!scriptReady || busy}
          onClick={() => {
            setError(null)
            setLoadError(null)
            try {
              const client = ensureClient()
              if (!client) return
              // Defer open so clientRef is assigned; Persona may need a tick after construction.
              queueMicrotask(() => {
                try {
                  clientRef.current?.open()
                } catch {
                  setError('Could not open verification.')
                }
              })
            } catch {
              setError('Could not open verification.')
            }
          }}
        >
          {!scriptReady ? 'Loading…' : busy ? 'Saving…' : 'Get ID verified'}
        </button>
        {loadError && (
          <p className="onboarding-error" role="alert" style={{ marginTop: '0.5rem' }}>
            {loadError}
          </p>
        )}
        {error && <p className="onboarding-error" role="alert" style={{ marginTop: '0.5rem' }}>{error}</p>}
        {hint != null && hint !== '' ? (
          <p className="profile-persona-hint" style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--color-textSecondary)' }}>
            {hint}
          </p>
        ) : null}
      </div>
    </>
  )
}
