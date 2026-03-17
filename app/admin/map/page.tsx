'use client'

import dynamic from 'next/dynamic'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

const AdminMapClient = dynamic(() => import('./AdminMapClient'), { ssr: false })

export default function AdminMapPage() {
  return <AdminMapClient />
}
