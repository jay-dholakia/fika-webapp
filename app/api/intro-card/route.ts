import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import React from 'react'
import sharp from 'sharp'

export const runtime = 'nodejs'

/** Fraunces TTF from Google Fonts (latin 600/700) — matches site heading font in globals.css */
const FRAUNCES_GSTATIC = {
  w600:
    'https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcaRyjDg.ttf',
  w700:
    'https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcUByjDg.ttf',
} as const

const INTRO_CARD_NAME_FIKA_PX = 56

const FONT_FETCH_INIT: RequestInit = {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FikaIntroCard/1.0)' },
}

async function loadFrauncesForOg() {
  const [res600, res700] = await Promise.all([
    fetch(FRAUNCES_GSTATIC.w600, FONT_FETCH_INIT),
    fetch(FRAUNCES_GSTATIC.w700, FONT_FETCH_INIT),
  ])
  if (!res600.ok || !res700.ok) {
    throw new Error('Failed to load Fraunces font files')
  }
  const [data600, data700] = await Promise.all([res600.arrayBuffer(), res700.arrayBuffer()])
  return [
    { name: 'Fraunces', data: data600, weight: 600 as const, style: 'normal' as const },
    { name: 'Fraunces', data: data700, weight: 700 as const, style: 'normal' as const },
  ]
}

function getNameLabel(raw: string | null): string {
  const name = (raw ?? '').trim()
  return name || 'Fika intro'
}

function getAgeLabel(raw: string | null): string | null {
  const age = (raw ?? '').trim()
  return /^\d{1,3}$/.test(age) ? age : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const avatar = searchParams.get('avatar')
  const name = getNameLabel(searchParams.get('name'))
  const age = getAgeLabel(searchParams.get('age'))

  if (!avatar) {
    return NextResponse.json({ error: 'Missing avatar' }, { status: 400 })
  }

  const avatarRes = await fetch(avatar)
  if (!avatarRes.ok) {
    return NextResponse.json({ error: 'Avatar fetch failed' }, { status: 400 })
  }

  const avatarBytes = await avatarRes.arrayBuffer()
  const normalizedAvatar = await sharp(Buffer.from(avatarBytes))
    .rotate()
    .jpeg({ quality: 92 })
    .toBuffer()
  const avatarDataUrl = `data:image/jpeg;base64,${normalizedAvatar.toString('base64')}`
  const title = age ? `${name}, ${age}` : name

  let fonts: Awaited<ReturnType<typeof loadFrauncesForOg>>
  try {
    fonts = await loadFrauncesForOg()
  } catch {
    return NextResponse.json({ error: 'Font load failed' }, { status: 502 })
  }

  return new ImageResponse(
    React.createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          background: '#111',
        },
      },
      React.createElement('img', {
        src: avatarDataUrl,
        alt: '',
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
        },
      }),
      React.createElement(
        'div',
        {
          style: {
            position: 'absolute',
            left: 42,
            right: 42,
            bottom: 38,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            color: '#fff',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              fontSize: INTRO_CARD_NAME_FIKA_PX,
              lineHeight: 1,
              fontFamily: 'Fraunces',
              fontWeight: 700,
              textShadow: '0 2px 8px rgba(0,0,0,0.45)',
            },
          },
          title
        ),
        React.createElement(
          'div',
          {
            style: {
              fontSize: INTRO_CARD_NAME_FIKA_PX,
              lineHeight: 1,
              fontFamily: 'Fraunces',
              fontWeight: 600,
              textShadow: '0 2px 8px rgba(0,0,0,0.45)',
            },
          },
          'fika'
        )
      )
    ),
    {
      width: 768,
      height: 1024,
      fonts,
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    }
  )
}
