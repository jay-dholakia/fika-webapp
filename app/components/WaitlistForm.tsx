'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

declare global {
  interface Window {
    google?: typeof google
    initPlacesAutocomplete?: () => void
  }
}

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const cityStateInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (!apiKey) return

    const loadScript = () => {
      if (window.google?.maps?.places) {
        initAutocomplete()
        return
      }
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
      script.async = true
      script.defer = true
      script.onload = () => {
        window.initPlacesAutocomplete = initAutocomplete
        initAutocomplete()
      }
      document.head.appendChild(script)
    }

    const initAutocomplete = () => {
      const el = cityStateInputRef.current
      if (!el || !window.google?.maps?.places) return
      const autocomplete = new window.google.maps.places.Autocomplete(
        el,
        { types: ['(regions)'], fields: ['address_components', 'formatted_address'] }
      )
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const components = place.address_components
        if (!components) return
        let cityVal = ''
        let stateVal = ''
        for (const c of components) {
          if (c.types.includes('locality')) cityVal = c.long_name
          if (c.types.includes('administrative_area_level_1')) stateVal = c.short_name
        }
        setCity(cityVal)
        setState(stateVal)
      })
      autocompleteRef.current = autocomplete
    }

    loadScript()
  }, [apiKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage('')

    let cityVal = city.trim()
    let stateVal = state.trim()
    if (!cityVal && cityStateInputRef.current?.value) {
      const parts = cityStateInputRef.current.value.split(',').map((s) => s.trim())
      cityVal = parts[0] ?? ''
      stateVal = parts[1] ?? stateVal
    }

    const { error } = await supabase.from('waitlist').insert({
      email: email.trim(),
      city: cityVal || null,
      state: stateVal || null,
    })

    if (error) {
      setStatus('error')
      setMessage(error.code === '23505' ? 'This email is already on the list.' : 'Something went wrong. Please try again.')
      return
    }

    setStatus('success')
    setMessage("You're on the list. We'll be in touch.")
    setEmail('')
    setCity('')
    setState('')
    if (cityStateInputRef.current) cityStateInputRef.current.value = ''
  }

  if (status === 'success') {
    return (
      <p className="cta-success" role="status">
        {message}
      </p>
    )
  }

  return (
    <form className="cta-form" onSubmit={handleSubmit}>
      <div className="cta-form-row">
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          className="cta-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={status === 'loading'}
        />
        <input
          ref={cityStateInputRef}
          type="text"
          name="city_state"
          placeholder="City, State"
          className="cta-input"
          defaultValue=""
          disabled={status === 'loading'}
        />
      </div>
      {message && (
        <p className={`cta-message ${status === 'error' ? 'cta-message-error' : ''}`} role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={status === 'loading'}>
        {status === 'loading' ? 'Adding…' : 'Notify me'}
      </button>
    </form>
  )
}
