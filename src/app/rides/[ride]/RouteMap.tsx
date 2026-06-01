'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyleForCurrentTheme } from '@/lib/map-style';

// When two consecutive samples are more than MAX_GAP_SECONDS apart in
// time, suppress the connecting polyline segment. iOS records every
// ~10 ft of motion at typical riding speed, so anything over a couple
// of seconds is GPS dropout, an iOS pause, an app backgrounding, or
// the user picking up after a break. Drawing a straight line across
// those gaps gives misleading "as-the-crow-flies" routes that don't
// reflect what was actually ridden.
//
// The threshold is generous (10s) so a momentary stoplight + chat
// doesn't get split into two visible segments — at zero speed the
// app may downgrade its sample cadence, so brief stops occasionally
// produce gaps of several seconds even though the rider didn't move.
const MAX_GAP_SECONDS = 10;

// Mirrors the iOS bumpiness colour stops so the route on the web looks like
// the route on the device. Kept in sync with src/lib/tile-renderer.ts.
const LINE_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'bumpiness'],
  0.0, '#00cc00',
  0.5, '#ffbb00',
  1.0, '#ff7700',
  1.5, '#dd2222',
  2.0, '#aa00dd',
];

// Bumpiness color buckets used to group adjacent samples into runs.
// Samples whose bumpiness sits in the same bucket join one LineString;
// crossing a boundary emits a new feature. Boundaries are midpoints
// between the iOS color stops above (0.25, 0.75, 1.25, 1.75) — so the
// per-run AVERAGE bumpiness ends up close to the nominal stop value
// and the gradient looks continuous to the eye even though the actual
// geometry is bucketed.
//
// Why bucket at all: the previous implementation emitted one Feature
// per ADJACENT sample pair. A ride with 5,000 samples produced 5,000
// LineString features, each spanning a single ~10 ft hop. At default
// zoom for a long ride that's many sub-pixel segments per feature,
// which maplibre's renderer drops outright — the route appeared
// invisible until the user zoomed in ~6 clicks and the segments grew
// past 1 px. Grouping into ~50 longer Features per ride lets every
// feature have meaningful pixel extent at every zoom level.
const BUCKET_BOUNDARIES = [0.25, 0.75, 1.25, 1.75] as const;

function bumpinessBucket(b: number): number {
  for (let i = 0; i < BUCKET_BOUNDARIES.length; i++) {
    if (b < BUCKET_BOUNDARIES[i]) return i;
  }
  return BUCKET_BOUNDARIES.length;
}

export type Sample = {
  lat: number;
  lon: number;
  bumpiness: number;
  tSec: number;
};

export type BrakeMarker = {
  lat: number;
  lon: number;
  peakMps2: number;
};

export type CloseCallMarker = {
  lat: number;
  lon: number;
};

export function RouteMap({
  samples,
  brakeMarkers = [],
  closeCallMarkers = [],
}: {
  samples: Sample[];
  brakeMarkers?: BrakeMarker[];
  closeCallMarkers?: CloseCallMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || samples.length === 0) return;

    const features = [] as GeoJSON.Feature<GeoJSON.LineString>[];
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

    // Run-builder state. Each run is a contiguous stretch of samples
    // whose bumpiness color bucket matches and whose recording timeline
    // has no gap. flushRun emits the accumulated LineString feature
    // (skipping degenerate single-point runs).
    let runCoords: [number, number][] = [];
    let runSum = 0;
    let runBucket = -1;
    const flushRun = () => {
      if (runCoords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: runCoords },
          properties: { bumpiness: runSum / runCoords.length },
        });
      }
      runCoords = [];
      runSum = 0;
      runBucket = -1;
    };

    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;

      const bucket = bumpinessBucket(p.bumpiness);
      const prev = i > 0 ? samples[i - 1] : null;
      const gap = prev !== null && p.tSec - prev.tSec > MAX_GAP_SECONDS;

      if (gap) {
        flushRun();
      } else if (runBucket !== -1 && bucket !== runBucket) {
        // Bumpiness crossed a bucket boundary. Close the current run
        // at this point and open a new run starting from the same
        // point — so adjacent runs visually connect end-to-end and
        // we don't draw a sub-pixel gap on bucket transitions.
        runCoords.push([p.lon, p.lat]);
        runSum += p.bumpiness;
        flushRun();
      }

      if (runBucket === -1) runBucket = bucket;
      runCoords.push([p.lon, p.lat]);
      runSum += p.bumpiness;
    }
    flushRun();

    const brakeFeatures: GeoJSON.Feature<GeoJSON.Point>[] = brakeMarkers.map((b) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: { peakMps2: b.peakMps2 },
    }));

    const closeCallFeatures: GeoJSON.Feature<GeoJSON.Point>[] = closeCallMarkers.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: {},
    }));

    const map = new maplibregl.Map({
      container: el,
      style: basemapStyleForCurrentTheme(),
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      fitBoundsOptions: { padding: 40, maxZoom: 16 },
    });

    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': LINE_COLOR,
          // Slight zoom interpolation: thicker at low zoom so the
          // route stays visible when a long ride auto-fits to z=11-13,
          // narrower at high zoom where the detail matters more.
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 4,
            14, 4,
            18, 6,
          ] as maplibregl.ExpressionSpecification,
        },
      });

      if (brakeFeatures.length > 0) {
        map.addSource('brakes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: brakeFeatures },
        });
        // White halo behind a red dot so the marker stays legible on
        // the colored route line regardless of underlying bumpiness.
        map.addLayer({
          id: 'brakes-halo',
          type: 'circle',
          source: 'brakes',
          paint: {
            'circle-radius': 9,
            'circle-color': '#ffffff',
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
        map.addLayer({
          id: 'brakes',
          type: 'circle',
          source: 'brakes',
          paint: {
            'circle-radius': 5,
            'circle-color': '#dd2222',
            'circle-stroke-color': '#7a0d0d',
            'circle-stroke-width': 1.5,
          },
        });
      }

      if (closeCallFeatures.length > 0) {
        // Same halo + dot pattern as brakes, but violet
        // (`#8C40D9`, matches the iOS palette) and slightly larger so
        // close calls read as the more salient incident type.
        map.addSource('close-calls', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: closeCallFeatures },
        });
        map.addLayer({
          id: 'close-calls-halo',
          type: 'circle',
          source: 'close-calls',
          paint: {
            'circle-radius': 10,
            'circle-color': '#ffffff',
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
        map.addLayer({
          id: 'close-calls',
          type: 'circle',
          source: 'close-calls',
          paint: {
            'circle-radius': 6,
            'circle-color': '#8c40d9',
            'circle-stroke-color': '#4a1d77',
            'circle-stroke-width': 1.5,
          },
        });
      }
    });

    return () => map.remove();
  }, [samples, brakeMarkers, closeCallMarkers]);

  return (
    <div
      ref={containerRef}
      className="h-[480px] w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
