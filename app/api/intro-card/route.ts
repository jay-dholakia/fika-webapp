import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import React from 'react'

export const runtime = 'nodejs'

function getNameLabel(raw: string | null): string {
  const name = (raw ?? '').trim()
  return name || 'Fika intro'
}

function getAgeLabel(raw: string | null): string | null {
  const age = (raw ?? '').trim()
  return /^\d{1,3}$/.test(age) ? age : null
}

function guessMimeType(url: string, header: string | null): string {
  if (header?.startsWith('image/')) return header
  if (url.endsWith('.png')) return 'image/png'
  if (url.endsWith('.webp')) return 'image/webp'
  if (url.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
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
  const mimeType = guessMimeType(avatar, avatarRes.headers.get('content-type'))
  const avatarDataUrl = `data:${mimeType};base64,${Buffer.from(avatarBytes).toString('base64')}`
  const title = age ? `${name}, ${age}` : name

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
              fontSize: 76,
              lineHeight: 1,
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
              fontSize: 56,
              lineHeight: 1,
              fontFamily: 'Georgia, Times New Roman, serif',
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
    }
  )
}
