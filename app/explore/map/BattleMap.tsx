'use client'
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

// The public national battle map: every town hall as a party-colored dot.
// Read-only — pan, zoom, hover for the city name.

export interface HallDot { lat: number; lng: number; party: string | null; city: string; state: string }

export default function BattleMap({ halls }: { halls: HallDot[] }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!el.current || map.current) return
    const m = new mapboxgl.Map({
      container: el.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-96.5, 39.3],
      zoom: 3.3,
      minZoom: 2.8,
      maxZoom: 11,
    })
    map.current = m
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    m.on('load', () => {
      m.addSource('halls', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: halls.map(h => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
            properties: { party: h.party ?? 'open', name: `${h.city}, ${h.state}` },
          })),
        },
      })
      m.addLayer({
        id: 'halls-glow',
        type: 'circle',
        source: 'halls',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 7, 9, 10, 14],
          'circle-blur': 0.6,
          'circle-opacity': 0.55,
          'circle-color': ['match', ['get', 'party'], 'democrat', '#3b82f6', 'republican', '#ef4444', '#6b7280'],
        },
      })
      m.addLayer({
        id: 'halls-core',
        type: 'circle',
        source: 'halls',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 7, 3.5, 10, 6],
          'circle-color': ['match', ['get', 'party'], 'democrat', '#93c5fd', 'republican', '#fca5a5', '#9ca3af'],
        },
      })
      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
      m.on('mousemove', 'halls-glow', e => {
        const f = e.features?.[0]
        if (!f) return
        m.getCanvas().style.cursor = 'pointer'
        popup.setLngLat((f.geometry as any).coordinates)
          .setHTML(`<div style="font-weight:700;font-size:12px">${(f.properties as any).name}</div>`)
          .addTo(m)
      })
      m.on('mouseleave', 'halls-glow', () => { m.getCanvas().style.cursor = ''; popup.remove() })
    })
    return () => { m.remove(); map.current = null }
  }, [halls])

  return <div ref={el} className="w-full h-full" />
}
