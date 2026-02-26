'use client'

import { useState, useRef, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'
import { toE164, isValidPhone } from '@/lib/phone'

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
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const placeContainerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const autocompleteElementRef = useRef<HTMLElement | null>(null)
  const [usePlainCityInput, setUsePlainCityInput] = useState(true)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    const update = () => {
      const plain = !apiKey || (typeof window !== 'undefined' && window.innerWidth <= 768)
      setUsePlainCityInput(plain)
      if (plain && autocompleteElementRef.current && placeContainerRef.current) {
        placeContainerRef.current.removeChild(autocompleteElementRef.current)
        autocompleteElementRef.current = null
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [apiKey])

  useEffect(() => {
    if (usePlainCityInput || !apiKey || !placeContainerRef.current) return

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
      if (autocompleteElementRef.current && container.contains(autocompleteElementRef.current)) return
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
  }, [apiKey, usePlainCityInput])

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

    const supabase = getSupabase()
    if (!supabase) {
      setStatus('error')
      setMessage('Unable to submit. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.')
      return
    }
    const phoneTrim = phone.trim()
    const emailTrim = email.trim()
    if (!phoneTrim && !emailTrim) {
      setStatus('error')
      setMessage('Enter your phone number or email.')
      return
    }
    if (phoneTrim && !isValidPhone(phoneTrim)) {
      setStatus('error')
      setMessage('Enter a valid phone number (at least 10 digits).')
      return
    }
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setStatus('error')
      setMessage('Enter a valid email address.')
      return
    }
    const { error } = await supabase.from('waitlist').insert({
      phone: phoneTrim ? toE164(phoneTrim) : null,
      email: emailTrim || null,
      city: cityVal || null,
      state: stateVal || null,
      marketing_consent_at: new Date().toISOString(),
    })

    if (error) {
      setStatus('error')
      setMessage(error.code === '23505' ? 'This phone number or email is already on the list.' : 'Something went wrong. Please try again.')
      return
    }

    setStatus('success')
    setMessage("You're on the list. We'll be in touch.")
    setPhone('')
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
          id="waitlist-phone"
          name="phone"
          type="tel"
          placeholder="Phone (optional)"
          className="cta-input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={status === 'loading'}
          autoComplete="tel"
        />
        <div className="cta-place-wrapper" ref={placeContainerRef}>
          {(usePlainCityInput || !apiKey) && (
            <input
              ref={fallbackInputRef}
              id="waitlist-city"
              name="city_state"
              type="text"
              placeholder="City, State"
              className="cta-input"
              defaultValue=""
              disabled={status === 'loading'}
              autoComplete="address-level2"
            />
          )}
        </div>
      </div>
      <div className="cta-form-row cta-form-row-single">
        <input
          id="waitlist-email"
          name="email"
          type="email"
          placeholder="Email (optional)"
          className="cta-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'loading'}
          autoComplete="email"
        />
      </div>
      <label className="cta-consent">
        <input
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          disabled={status === 'loading'}
          aria-describedby="waitlist-consent-text"
        />
        <span id="waitlist-consent-text" className="cta-consent-text">
          By clicking Notify me, you agree to receive SMS and/or email from Fika about when we launch in your city. Message &amp; data rates may apply for SMS. Reply STOP to opt out of SMS, HELP for help.
        </span>
      </label>
      {message && (
        <p className={`cta-message ${status === 'error' ? 'cta-message-error' : ''}`} role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={status === 'loading' || !marketingConsent}>
        {status === 'loading' ? 'Adding…' : 'Notify me'}
      </button>
    </form>
  )
}
