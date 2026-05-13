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
      className="h-[640px] w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
