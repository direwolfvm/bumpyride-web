// Shared bits for the JSON export endpoints.
//
// Three endpoints share the same export-kind / time-window contract:
//   GET /api/me/rides/[ride]/export
//   GET /api/me/bump-map/export?kind=&mode=
//   GET /api/public-map/export?kind=&mode=
//
// All produce a downloadable JSON file (Content-Disposition: attachment).
//
// `kind` is asymmetric between personal and public:
//   personal  raw     -> per-point ride_points + per-event records
//             display -> per-cell aggregates
//   public    raw     -> per-cell aggregates (per-event records would
//                        compromise the per-rider privacy gate, so
//                        public exports are always cell-shaped)
//             display -> per-cell aggregates plus the rendered color bin
//
// `mode` mirrors the tile-route query string introduced in 0013.

import { NextResponse } from 'next/server';

export const EXPORT_KINDS = ['raw', 'display'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function parseExportKind(raw: string | null | undefined): ExportKind {
  if (!raw) return 'display';
  return (EXPORT_KINDS as readonly string[]).includes(raw)
    ? (raw as ExportKind)
    : 'display';
}

export function jsonFileResponse(
  payload: unknown,
  filename: string,
): NextResponse {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * Map a per-cell event count to the same green → purple bin the
 * incident-tile renderer uses. Exposed in `kind=display` exports so
 * consumers can reconstruct the on-screen color without re-running
 * the binning logic. The green-for-0 tier matches the cell renderer
 * — cells with bump coverage but no incidents render green.
 */
export function incidentColorBin(
  count: number,
): 'green' | 'yellow' | 'orange' | 'red' | 'purple' {
  if (count >= 6) return 'purple';
  if (count >= 4) return 'red';
  if (count >= 2) return 'orange';
  if (count >= 1) return 'yellow';
  return 'green';
}
