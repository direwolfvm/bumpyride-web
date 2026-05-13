// Port of BumpGrid cell math from the iOS app (BumpGrid.swift).
// Anchored to DC reference latitude — see docs/SCHEMA.md and the iOS source
// for the rationale. Cell indices are stable across the web app and iOS so
// uploaded points land in the same grid the phone visualises.

export const REFERENCE_LATITUDE = 38.9;
export const CELL_SIZE_FEET = 20;
export const CELL_SIZE_METERS = CELL_SIZE_FEET * 0.3048;

const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON =
  Math.cos((REFERENCE_LATITUDE * Math.PI) / 180) * METERS_PER_DEGREE_LAT;

export const CELL_LAT_DEG = CELL_SIZE_METERS / METERS_PER_DEGREE_LAT;
export const CELL_LON_DEG = CELL_SIZE_METERS / METERS_PER_DEGREE_LON;

export function gridIndex(lat: number, lon: number): { ix: number; iy: number } {
  return {
    ix: Math.floor(lon / CELL_LON_DEG),
    iy: Math.floor(lat / CELL_LAT_DEG),
  };
}

export function cellOrigin(ix: number, iy: number): { lat: number; lon: number } {
  return { lat: iy * CELL_LAT_DEG, lon: ix * CELL_LON_DEG };
}
