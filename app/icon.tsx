import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default async function Icon() {
  const fontData = await fetch(
    new URL('https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcaRyjDg.ttf')
  ).then(r => r.arrayBuffer())

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAFBFC',
        }}
      >
        <span
          style={{
            fontFamily: 'Fraunces',
            fontWeight: 600,
            fontSize: 20,
            color: '#0F172A',
            letterSpacing: '-0.5px',
          }}
        >
          f
        </span>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Fraunces', data: fontData, weight: 600 }],
    }
  )
}
