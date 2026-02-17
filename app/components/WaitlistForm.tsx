'use client'

import { useState, useRef, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<{
          PlaceAutocompleteElement?: new (opts?: object) => HTMLElement & {
            addEventListener: (event: string, handler: (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => void) => void
          }
        }>
      }
    }
  }
}

interface PlaceLike {
  fetchFields: (opts: { fields: string[] }) => Promise<void>
  addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>
  formattedAddress?: string
}

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const placeContainerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const autocompleteElementRef = useRef<HTMLElement | null>(null)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (!apiKey || !placeContainerRef.current) return

    const bootstrap = () => {
      if (window.google?.maps?.importLibrary) {
        initPlaceAutocomplete()
        return
      }
      ;(window as unknown as Record<string, string>)['__FIKA_GMAP_KEY'] = apiKey
      const script = document.createElement('script')
      script.innerHTML = `(function(g){var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=function(){return h||(h=new Promise(function(f,n){a=m.createElement("script");e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,function(t){return"_"+t[0].toLowerCase()}),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=function(){h=n(Error(p+" could not load."));};a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));};d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=function(f,n){r.add(f);return u().then(function(){return d[l](f,n);});};})({key:window.__FIKA_GMAP_KEY||"",v:"weekly"});`
      document.head.appendChild(script)
      const t = setInterval(function(){
        if (window.google&&window.google.maps&&window.google.maps.importLibrary) { clearInterval(t); initPlaceAutocomplete(); }
      }, 100)
    }

    async function initPlaceAutocomplete() {
      const container = placeContainerRef.current
      if (!container || !window.google?.maps?.importLibrary) return
      try {
        const places = await window.google.maps.importLibrary('places') as { PlaceAutocompleteElement?: new (opts?: object) => HTMLElement & { addEventListener: (ev: string, cb: (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => void) => void } }
        const El = places?.PlaceAutocompleteElement
        if (!El) return
        const el = new El({})
        el.setAttribute('placeholder', 'City, State')
        container.appendChild(el)
        autocompleteElementRef.current = el
        const elAny = el as unknown as { addEventListener: (ev: string, cb: (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => void) => void }
        elAny.addEventListener('gmp-select', async (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => {
          const placePrediction = e.placePrediction
          if (!placePrediction) return
          try {
            const place = await placePrediction.toPlace()
            await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] })
            const comps = place.addressComponents
            let cityVal = ''
            let stateVal = ''
            if (comps) {
              for (const c of comps) {
                if (c.types?.includes('locality')) cityVal = c.longText ?? ''
                if (c.types?.includes('administrative_area_level_1')) stateVal = c.shortText ?? ''
              }
            }
            if (!cityVal && place.formattedAddress) cityVal = place.formattedAddress
            setCity(cityVal)
            setState(stateVal)
          } catch (_) {
            // ignore
          }
        })
      } catch (_) {
        // If new API fails, fallback input is still visible
      }
    }

    bootstrap()
  }, [apiKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage('')

    let cityVal = city.trim()
    let stateVal = state.trim()
    const fallbackEl = fallbackInputRef.current
    if (!cityVal && fallbackEl?.value) {
      const parts = fallbackEl.value.split(',').map((s) => s.trim())
      cityVal = parts[0] ?? ''
      stateVal = parts[1] ?? stateVal
    }

    const { error } = await getSupabase().from('waitlist').insert({
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
    if (fallbackEl) fallbackEl.value = ''
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
        <div className="cta-place-wrapper" ref={placeContainerRef}>
          <input
            ref={fallbackInputRef}
            type="text"
            name="city_state"
            placeholder="City, State"
            className="cta-input"
            defaultValue=""
            disabled={status === 'loading'}
            style={apiKey ? { position: 'absolute' as const, left: '-9999px', width: 1, height: 1, opacity: 0, pointerEvents: 'none' as const } : undefined}
          />
        </div>
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
