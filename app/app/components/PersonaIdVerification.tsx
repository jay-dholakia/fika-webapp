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
}

export function PersonaIdVerification({ userId, idVerifiedAt, onVerified }: PersonaIdVerificationProps) {
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

    const client = new Ctor({
      templateId,
      environmentId,
      referenceId: userId,
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

  if (!configured) {
    return (
      <p className="profile-persona-unconfigured" style={{ color: 'var(--color-textSecondary)', fontSize: '0.9rem' }}>
        ID verification is not configured for this environment.
      </p>
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
        onLoad={() => {
          setScriptReady(true)
          setLoadError(null)
        }}
        onError={() => {
          setLoadError('Could not load Persona. Check your network or try again.')
        }}
      />
      <div className="profile-persona-actions">
        <button
          type="button"
          className="btn btn-primary-muted"
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
        <p className="profile-persona-hint" style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--color-textSecondary)' }}>
          Verifying adds a blue check on your name so matches know you&apos;ve confirmed your identity with Persona.
        </p>
      </div>
    </>
  )
}
