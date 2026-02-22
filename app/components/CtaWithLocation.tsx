'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  /** When true, redirect to /signup as soon as user is detected in launch area (e.g. on login page) */
  redirectToSignupWhenInLA?: boolean
}

export default function CtaWithLocation({ redirectToSignupWhenInLA = false }: CtaWithLocationProps) {
  const router = useRouter()
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [locationStatus, setLocationStatus] = useState<'idle' | 'checking' | 'la' | 'not_la'>('idle')
  const [email, setEmail] = useState('')
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [waitlistMessage, setWaitlistMessage] = useState('')

  const placeContainerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const waitlistCityRef = useRef<HTMLInputElement>(null)
  const autocompleteElementRef = useRef<HTMLElement | null>(null)
  const [usePlainCityInput, setUsePlainCityInput] = useState(true)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'getting' | 'error'>('idle')
  const [geoErrorMessage, setGeoErrorMessage] = useState('')
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (redirectToSignupWhenInLA && locationStatus === 'la') {
      router.replace('/signup')
    }
  }, [redirectToSignupWhenInLA, locationStatus, router])

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
        const fallbackEl = fallbackInputRef.current
        if (fallbackEl) {
          fallbackEl.value = [result.city, result.state].filter(Boolean).join(', ')
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
    setWaitlistStatus('loading')
    setWaitlistMessage('')
    let cityVal = city.trim()
    let stateVal = state.trim()
    const waitlistCityEl = waitlistCityRef.current
    if (waitlistCityEl?.value) {
      const parts = waitlistCityEl.value.split(',').map((s) => s.trim())
      cityVal = parts[0] ?? cityVal
      stateVal = parts[1] ?? stateVal
    }
    if (!cityVal && !stateVal) {
      const fromLocation = getLocationFromInput()
      cityVal = fromLocation.cityVal
      stateVal = fromLocation.stateVal
    }
    const supabase = getSupabase()
    if (!supabase) {
      setWaitlistStatus('error')
      setWaitlistMessage('Unable to submit. Please try again.')
      return
    }
    const { error } = await supabase.from('waitlist').insert({
      email: email.trim(),
      city: cityVal || null,
      state: stateVal || null,
    })
    if (error) {
      setWaitlistStatus('error')
      setWaitlistMessage(error.code === '23505' ? 'This email is already on the list.' : 'Something went wrong. Please try again.')
      return
    }
    setWaitlistStatus('success')
    setWaitlistMessage("You're on the list. We'll be in touch when Fika comes to your city.")
    setEmail('')
  }

  // Step 1: Ask for location
  if (locationStatus === 'idle' || locationStatus === 'checking') {
    const showUseMyLocation = !!apiKey
    return (
      <form className="cta-location-form" onSubmit={handleLocationSubmit}>
        <div className="cta-form-row">
          <div className="cta-place-wrapper cta-location-place" ref={placeContainerRef}>
            {(usePlainCityInput || !apiKey) && (
              <input
                ref={fallbackInputRef}
                id="cta-location-input"
                name="location"
                type="text"
                placeholder="City, State"
                className="cta-input"
                aria-label="City, State"
                defaultValue=""
                disabled={locationStatus === 'checking'}
                autoComplete="address-level2"
              />
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

  // LA: redirect to signup when requested (e.g. login page), else show sign up CTA
  if (locationStatus === 'la') {
    if (redirectToSignupWhenInLA) {
      return (
        <p className="cta-message" aria-live="polite">
          Taking you to sign up…
        </p>
      )
    }
    return (
      <div className="cta-result cta-result-la">
        <p className="cta-result-title">You&apos;re in our launch city.</p>
        <p className="cta-result-body">Fika is live in Los Angeles. Create an account and get your first weekly intros.</p>
        <Link href="/signup" className="btn btn-primary">
          Sign up
        </Link>
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

  // Not LA: show waitlist form (email + location in same row)
  if (waitlistStatus === 'success') {
    return (
      <p className="cta-success" role="status">
        {waitlistMessage}
      </p>
    )
  }

  const { cityVal, stateVal } = getLocationFromInput()
  const cityDisplay = [cityVal, stateVal].filter(Boolean).join(', ') || ''

  return (
    <div className="cta-result cta-result-waitlist">
      <p className="cta-result-title">We&apos;re currently in Los Angeles.</p>
      <p className="cta-result-body">Join the waitlist and we&apos;ll let you know when Fika comes to your city.</p>
      <form className="cta-form" onSubmit={handleWaitlistSubmit}>
        <div className="cta-form-row">
          <input
            id="cta-waitlist-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="cta-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={waitlistStatus === 'loading'}
            autoComplete="email"
          />
          <div className="cta-place-wrapper">
            <input
              ref={waitlistCityRef}
              id="cta-waitlist-city"
              name="city_state"
              type="text"
              placeholder="City, State"
              className="cta-input"
              defaultValue={cityDisplay}
              disabled={waitlistStatus === 'loading'}
              autoComplete="address-level2"
            />
          </div>
        </div>
        {waitlistMessage && (
          <p className={`cta-message ${waitlistStatus === 'error' ? 'cta-message-error' : ''}`} role="alert">
            {waitlistMessage}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={waitlistStatus === 'loading'}>
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
