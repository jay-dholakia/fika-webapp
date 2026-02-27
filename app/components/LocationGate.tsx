'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

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

// Los Angeles plus Greater LA / LA metro cities (same launch area)
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
  // Must be in California for LA metro
  if (s && s !== 'ca' && s !== 'california') return false
  const toCheck = [c, raw].filter(Boolean)
  return LA_CITY_NAMES.some((name) =>
    toCheck.some((t) => t === name || t.startsWith(name + ',') || t.includes(name))
  )
}

export default function LocationGate() {
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'la' | 'not_la'>('idle')
  const placeContainerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const autocompleteElementRef = useRef<HTMLElement | null>(null)
  const [usePlainCityInput, setUsePlainCityInput] = useState(true)
  const [cityInputValue, setCityInputValue] = useState('')

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    const update = () => {
      const plain = !apiKey || (typeof window !== 'undefined' && window.innerWidth <= 768)
      setUsePlainCityInput(plain)
      if (plain && autocompleteElementRef.current && placeContainerRef.current) {
        if (placeContainerRef.current.contains(autocompleteElementRef.current)) {
          placeContainerRef.current.removeChild(autocompleteElementRef.current)
        }
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
      const t = setInterval(function () {
        if (window.google && window.google.maps && window.google.maps.importLibrary) {
          clearInterval(t)
          initPlaceAutocomplete()
        }
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
        const elAny = el as unknown as {
          addEventListener: (ev: string, cb: (e: { placePrediction?: { toPlace: () => Promise<PlaceLike> } }) => void) => void
        }
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
        // fallback input remains
      }
    }

    bootstrap()
  }, [apiKey, usePlainCityInput])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('checking')

    let cityVal = city.trim()
    let stateVal = state.trim()
    if (!cityVal && cityInputValue.trim()) {
      const parts = cityInputValue.trim().split(',').map((s) => s.trim())
      cityVal = parts[0] ?? ''
      stateVal = parts[1] ?? stateVal
    }
    const fallbackEl = fallbackInputRef.current
    if (!cityVal && fallbackEl?.value) {
      const parts = fallbackEl.value.split(',').map((s) => s.trim())
      cityVal = parts[0] ?? ''
      stateVal = parts[1] ?? stateVal
    }
    const rawInput = cityVal && stateVal ? `${cityVal}, ${stateVal}` : fallbackEl?.value ?? cityInputValue.trim() ?? cityVal ?? ''

    // Small delay so "checking" state is visible
    setTimeout(() => {
      const inLA = isInLaunchArea(cityVal, stateVal, rawInput)
      setStatus(inLA ? 'la' : 'not_la')
    }, 300)
  }

  if (status === 'la') {
    return (
      <div className="location-gate-result location-gate-la">
        <p className="location-gate-result-title">You&apos;re in our launch city.</p>
        <p className="location-gate-result-body">We're bringing Fika to Los Angeles. Sign up and we'll get you in for your first weekly intros.</p>
        <Link href="/signup" className="btn btn-primary">
          Sign up
        </Link>
      </div>
    )
  }

  if (status === 'not_la') {
    return (
      <div className="location-gate-result location-gate-not-la">
        <p className="location-gate-result-title">We&apos;re currently in Los Angeles.</p>
        <p className="location-gate-result-body">Fika is launching in LA first. Join the waitlist and we&apos;ll let you know when we expand to your city.</p>
        <a href="#cta" className="btn btn-primary">
          Join the waitlist
        </a>
      </div>
    )
  }

  return (
    <form className="location-gate-form" onSubmit={handleSubmit}>
      <label htmlFor="location-gate-input" className="location-gate-label">
        Where are you?
      </label>
      <div className="location-gate-row">
        <div className="location-gate-place-wrapper" ref={placeContainerRef}>
          {(usePlainCityInput || !apiKey) && (
            <div
              className={`location-floating-wrap${cityInputValue.trim() ? ' location-floating-filled' : ''}`}
            >
              <input
                ref={fallbackInputRef}
                id="location-gate-input"
                name="location"
                type="text"
                placeholder=" "
                className="location-gate-input"
                aria-label="City, State"
                value={cityInputValue}
                onChange={(e) => setCityInputValue(e.target.value)}
                disabled={status === 'checking'}
                autoComplete="address-level2"
              />
              <span className="location-floating-label">City, State</span>
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={status === 'checking'}>
          {status === 'checking' ? 'Checking…' : 'Continue'}
        </button>
      </div>
    </form>
  )
}
