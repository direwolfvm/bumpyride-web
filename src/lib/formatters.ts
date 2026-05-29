// Display helpers shared across server + client components.

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const MPS_PER_MPH = 0.44704;

/**
 * Speed in mph, one decimal place. Input is m/s (the unit iOS
 * CoreLocation reports). Returns "—" for non-finite or negative
 * input — defensive against speed=NaN points that we accept on the
 * wire but should not present as 0.0 mph.
 */
export function formatSpeed(mps: number): string {
  if (!Number.isFinite(mps) || mps < 0) return '—';
  const mph = mps / MPS_PER_MPH;
  return `${mph.toFixed(1)} mph`;
}
