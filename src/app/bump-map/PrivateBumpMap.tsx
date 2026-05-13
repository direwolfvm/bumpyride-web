'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export function PrivateBumpMap({
  minLat,
  maxLat,
  minLon,
  maxLon,
}: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = new maplibregl.Map({
      container: el,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      fitBoundsOptions: { padding: 40, maxZoom: 15 },
    });

    map.on('load', () => {
      map.addSource('bump', {
        type: 'raster',
        // Server-rendered PNG tiles. Includes the iOS-style purple glow halo
        // so sparse data stays visible at any zoom level.
        tiles: ['/api/tiles/user/{z}/{x}/{y}'],
        tileSize: 256,
      });
      map.addLayer({
        id: 'bump',
        type: 'raster',
        source: 'bump',
        paint: { 'raster-opacity': 0.85 },
      });
    });

    return () => map.remove();
  }, [minLat, maxLat, minLon, maxLon]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 600,
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid #22222c',
      }}
    />
  );
}
