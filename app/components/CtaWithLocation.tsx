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

const LA_CITY_NAMES = [
  'los angeles', 'la', 'l.a.', 'l.a',
  'santa monica', 'pasadena', 'long beach', 'burbank', 'glendale',
  'west hollywood', 'culver city', 'inglewood', 'el segundo', 'torrance',
  'redondo beach', 'manhattan beach', 'marina del rey', 'venice',
  'hawthorne', 'gardena', 'santa clarita', 'palmdale', 'lancaster',
  'pomona', 'whittier', 'lakewood', 'downey', 'norwalk', 'compton',
  'carson', 'alhambra', 'monrovia', 'arcadia', 'glendora',
]
function isInLaunchArea(city: string, state: string, rawInput: string): boolean {
  const c = city.trim().toLowerCase()
  const s = state.trim().toLowerCase()
  const raw = rawInput.trim().toLowerCase()
  if (!c && !raw) return false
  if (s && s !== 'ca' && s !== 'california') return false
  const toCheck = [c, raw].filter(Boolean)
  return LA_CITY_NAMES.some((name) =>
    toCheck.some((t) => t === name || t.startsWith(name + ',') || t.includes(name))
  )
}

type CtaWithLocationProps = {
  /** When true, skip location step and show only waitlist form (for home page; no login/signup flow) */
  waitlistOnly?: boolean
}

export default function CtaWithLocation({ waitlistOnly = false }: CtaWithLocationProps) {
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [locationStatus, setLocationStatus] = useState<'idle' | 'checking' | 'la' | 'not_la'>('idle')
  const [email, setEmail] = useState('')
  const [emailConsent, setEmailConsent] = useState(false)
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [waitlistMessage, setWaitlistMessage] = useState('')

  const placeContainerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const autocompleteElementRef = useRef<HTMLElement | null>(null)
  const [usePlainCityInput, setUsePlainCityInput] = useState(true)
  const [cityInputValue, setCityInputValue] = useState('')
  const [geoStatus, setGeoStatus] = useState<'idle' | 'getting' | 'error'>('idle')
  const [geoErrorMessage, setGeoErrorMessage] = useState('')
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    const update = () => {
      const plain = !apiKey || (typeof window !== 'undefined' && window.innerWidth <= 768)
      setUsePlainCityInput(plain)
      if (plain && autocompleteElementRef.current && placeContainerRef.current?.contains(autocompleteElementRef.current)) {
        placeContainerRef.current.removeChild(autocompleteElementRef.current)
        autocompleteElementRef.current = null
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [apiKey])

  useEffect(() => {
    if (locationStatus !== 'idle' || usePlainCityInput || !apiKey || !placeContainerRef.current) return
    const bootstrap = () => {
      if (window.google?.maps?.importLibrary) {
        initPlaceAutocomplete()
        return
      }
      ;(window as unknown as Record<string, string>)['__FIKA_GMAP_KEY'] = apiKey
      const script = document.createElement('script')
      script.innerHTML = `(function(g){var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=function(){return h||(h=new Promise(function(f,n){a=m.createElement("script");e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,function(t){return"_"+t[0].toLowerCase()}),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=function(){h=n(Error(p+" could not load."));};a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));};d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=function(f,n){r.add(f);return u().then(function(){return d[l](f,n);});};})({key:window.__FIKA_GMAP_KEY||"",v:"weekly"});`
      document.head.appendChild(script)
      const t = setInterval(function () {
        if (window.google?.maps?.importLibrary) { clearInterval(t); initPlaceAutocomplete() }
      }, 100)
    }
    async function initPlaceAutocomplete() {
      const container = placeContainerRef.current
      if (!container || !window.google?.maps?.importLibrary) return
      if (autocompleteElementRef.current && container.contains(autocompleteElementRef.current)) return
      try {
        const places = (await window.google.maps.importLibrary('places')) as {
          PlaceAutocompleteElement?: new (opts?: object) => HTMLElement & {
            addEventListener: (ev: string, cb: (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => void) => void
          }
        }
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
          } catch (_) {}
        })
      } catch (_) {}
    }
    bootstrap()
  }, [apiKey, usePlainCityInput, locationStatus])

  function getLocationFromInput() {
    if (usePlainCityInput && cityInputValue.trim()) {
      const parts = cityInputValue.trim().split(',').map((s) => s.trim())
      const cityVal = parts[0] ?? ''
      const stateVal = parts[1] ?? ''
      const rawInput = cityVal && stateVal ? `${cityVal}, ${stateVal}` : cityInputValue.trim()
      return { cityVal, stateVal, rawInput }
    }
    const fallbackEl = fallbackInputRef.current
    const fallbackRaw = fallbackEl?.value?.trim() ?? ''
    // Prefer manual entry in the input when present so "Los Angeles, CA" etc. is always used
    if (fallbackRaw) {
      const parts = fallbackRaw.split(',').map((s) => s.trim())
      const cityVal = parts[0] ?? ''
      const stateVal = parts[1] ?? ''
      const rawInput = cityVal && stateVal ? `${cityVal}, ${stateVal}` : fallbackRaw
      return { cityVal, stateVal, rawInput }
    }
    let cityVal = city.trim()
    let stateVal = state.trim()
    const rawInput = cityVal && stateVal ? `${cityVal}, ${stateVal}` : cityVal || stateVal || ''
    return { cityVal, stateVal, rawInput }
  }

  async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; state: string } | null> {
    if (!apiKey) return null
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
      )
      const data = (await res.json()) as {
        results?: Array<{
          address_components?: Array<{ long_name: string; short_name: string; types: string[] }>
        }>
      }
      const comps = data.results?.[0]?.address_components
      if (!comps) return null
      let cityVal = ''
      let stateVal = ''
      for (const c of comps) {
        if (c.types?.includes('locality')) cityVal = c.long_name ?? ''
        if (c.types?.includes('administrative_area_level_1')) stateVal = c.short_name ?? ''
      }
      return { city: cityVal, state: stateVal }
    } catch {
      return null
    }
  }

  function handleUseMyLocation() {
    setGeoErrorMessage('')
    if (!apiKey) {
      setGeoStatus('error')
      setGeoErrorMessage('Location services are not configured.')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('error')
      setGeoErrorMessage('Your browser doesn’t support location.')
      return
    }
    setGeoStatus('getting')
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const result = await reverseGeocode(latitude, longitude)
        if (!result) {
          setGeoStatus('error')
          setGeoErrorMessage('Couldn’t determine your city.')
          return
        }
        setCity(result.city)
        setState(result.state)
        const displayVal = [result.city, result.state].filter(Boolean).join(', ')
        setCityInputValue(displayVal)
        const fallbackEl = fallbackInputRef.current
        if (fallbackEl) {
          fallbackEl.value = displayVal
        }
        setGeoStatus('idle')
        setLocationStatus('checking')
        setTimeout(() => {
          const raw = [result.city, result.state].filter(Boolean).join(', ')
          setLocationStatus(isInLaunchArea(result.city, result.state, raw) ? 'la' : 'not_la')
        }, 300)
      },
      (err) => {
        setGeoStatus('error')
        if (err.code === err.PERMISSION_DENIED) {
          setGeoErrorMessage('Location was denied. You can enter your city above.')
        } else {
          setGeoErrorMessage('Couldn’t get your location. Try entering your city above.')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  function handleLocationSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocationStatus('checking')
    const { cityVal, stateVal, rawInput } = getLocationFromInput()
    setTimeout(() => {
      setLocationStatus(isInLaunchArea(cityVal, stateVal, rawInput) ? 'la' : 'not_la')
    }, 300)
  }

  async function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault()
    setWaitlistMessage('')
    const emailTrim = email.trim().toLowerCase()
    if (!emailTrim) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter your email address.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setWaitlistStatus('error')
      setWaitlistMessage('Enter a valid email address.')
      return
    }
    if (!emailConsent) {
      setWaitlistStatus('error')
      setWaitlistMessage('Please agree to receive email from us.')
      return
    }
    const supabase = getSupabase()
    if (!supabase) {
      setWaitlistStatus('error')
      setWaitlistMessage('Unable to submit. Please try again.')
      return
    }
    const { cityVal, stateVal } = waitlistOnly ? { cityVal: '', stateVal: '' } : getLocationFromInput()
    setWaitlistStatus('loading')
    const { error } = await supabase.from('waitlist').insert({
      email: emailTrim,
      city: cityVal || null,
      state: stateVal || null,
      marketing_consent_at: new Date().toISOString(),
    })
    if (error) {
      setWaitlistStatus('error')
      setWaitlistMessage(error.code === '23505' ? 'This email is already on the list.' : 'Something went wrong. Please try again.')
      return
    }
    setWaitlistStatus('success')
    setWaitlistMessage(waitlistOnly ? "You're on the list. We'll be in touch." : "You're on the list. We'll email you when Fika comes to your city.")
    setEmail('')
    setEmailConsent(false)
  }

  // Waitlist-only mode (home page): skip location, show only waitlist form
  if (waitlistOnly) {
    if (waitlistStatus === 'success') {
      return (
        <p className="cta-success" role="status">
          {waitlistMessage}
        </p>
      )
    }
    return (
      <form className="cta-form" onSubmit={handleWaitlistSubmit}>
        <label htmlFor="cta-waitlist-email" className="cta-waitlist-hint">
          Email
        </label>
        <div className="cta-form-row cta-form-row-single">
          <input
            id="cta-waitlist-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="cta-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={waitlistStatus === 'loading'}
            autoComplete="email"
            required
          />
        </div>
        <label className="cta-consent">
          <input
            type="checkbox"
            checked={emailConsent}
            onChange={(e) => setEmailConsent(e.target.checked)}
            disabled={waitlistStatus === 'loading'}
            aria-describedby="cta-consent-email-text"
          />
          <span id="cta-consent-email-text" className="cta-consent-text">
            I agree to receive email from Fika when we launch. Unsubscribe anytime.
          </span>
        </label>
        {waitlistMessage && (
          <p className={`cta-message ${waitlistStatus === 'error' ? 'cta-message-error' : ''}`} role="alert">
            {waitlistMessage}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={waitlistStatus === 'loading' || !email.trim() || !emailConsent}
        >
          {waitlistStatus === 'loading' ? 'Adding…' : 'Notify me'}
        </button>
      </form>
    )
  }

  // Step 1: Ask for location
  if (locationStatus === 'idle' || locationStatus === 'checking') {
    const showUseMyLocation = !!apiKey
    return (
      <form className="cta-location-form" onSubmit={handleLocationSubmit}>
        <div className="cta-form-row">
          <div className="cta-place-wrapper cta-location-place" ref={placeContainerRef}>
            {(usePlainCityInput || !apiKey) && (
              <div
                className={`location-floating-wrap${cityInputValue.trim() ? ' location-floating-filled' : ''}`}
              >
                <input
                  ref={fallbackInputRef}
                  id="cta-location-input"
                  name="location"
                  type="text"
                  placeholder=" "
                  className="cta-input"
                  aria-label="City, State"
                  value={cityInputValue}
                  onChange={(e) => setCityInputValue(e.target.value)}
                  disabled={locationStatus === 'checking'}
                  autoComplete="address-level2"
                />
                <span className="location-floating-label">City, State</span>
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={locationStatus === 'checking'}>
            {locationStatus === 'checking' ? 'Checking…' : 'Continue'}
          </button>
        </div>
        {showUseMyLocation && (
          <div className="cta-use-location">
            <button
              type="button"
              className="cta-use-location-btn"
              onClick={handleUseMyLocation}
              disabled={locationStatus === 'checking' || geoStatus === 'getting'}
            >
              {geoStatus === 'getting' ? 'Getting location…' : 'Use my current location'}
            </button>
            {geoStatus === 'error' && geoErrorMessage && (
              <p className="cta-use-location-error" role="alert">
                {geoErrorMessage}
              </p>
            )}
          </div>
        )}
      </form>
    )
  }

  // LA: no webapp signup — direct to SMS
  if (locationStatus === 'la') {
    return (
      <div className="cta-result cta-result-la">
        <p className="cta-result-title">You&apos;re in our launch city.</p>
        <p className="cta-result-body">Text FIKA to our number to get started. We&apos;ll send you a link to complete your profile.</p>
        <button
          type="button"
          className="cta-go-back"
          onClick={() => {
            autocompleteElementRef.current = null
            setGeoStatus('idle')
            setGeoErrorMessage('')
            setLocationStatus('idle')
          }}
        >
          Go back
        </button>
      </div>
    )
  }

  // Not LA: show waitlist (email only; city from earlier step)
  if (waitlistStatus === 'success') {
    return (
      <p className="cta-success" role="status">
        {waitlistMessage}
      </p>
    )
  }

  return (
    <div className="cta-result cta-result-waitlist">
      <p className="cta-result-title">We&apos;re currently in Los Angeles.</p>
      <p className="cta-result-body">Join the waitlist and we&apos;ll email you when Fika comes to your city.</p>
      <form className="cta-form" onSubmit={handleWaitlistSubmit}>
        <label htmlFor="cta-waitlist-email" className="cta-waitlist-hint">
          Email
        </label>
        <div className="cta-form-row cta-form-row-single">
          <input
            id="cta-waitlist-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="cta-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={waitlistStatus === 'loading'}
            autoComplete="email"
            required
          />
        </div>
        <label className="cta-consent">
          <input
            type="checkbox"
            checked={emailConsent}
            onChange={(e) => setEmailConsent(e.target.checked)}
            disabled={waitlistStatus === 'loading'}
            aria-describedby="cta-consent-email-text"
          />
          <span id="cta-consent-email-text" className="cta-consent-text">
            I agree to receive email from Fika when we launch in my city. Unsubscribe anytime.
          </span>
        </label>
        {waitlistMessage && (
          <p className={`cta-message ${waitlistStatus === 'error' ? 'cta-message-error' : ''}`} role="alert">
            {waitlistMessage}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={waitlistStatus === 'loading' || !email.trim() || !emailConsent}
        >
          {waitlistStatus === 'loading' ? 'Adding…' : 'Notify me'}
        </button>
      </form>
      <div className="cta-go-back-wrap">
        <button
          type="button"
          className="cta-go-back"
          onClick={() => {
            autocompleteElementRef.current = null
            setGeoStatus('idle')
            setGeoErrorMessage('')
            setLocationStatus('idle')
          }}
        >
          Go back
        </button>
      </div>
    </div>
  )
}
