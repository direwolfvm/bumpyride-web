// Picks a Carto basemap style URL that matches the current theme.
//
// We read the resolved theme at map mount time (data-theme attribute set
// by ThemeInit pre-paint script). We don't re-resolve when the user
// toggles the theme later — MapLibre `setStyle()` recomputes every tile
// and the basemap flickers. The new theme picks up on next navigation,
// which is fine for a setting users change rarely.
//
// Style attribution stays the same in both:
//   © OpenStreetMap contributors © CARTO

const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DARK_MATTER =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export function basemapStyleForCurrentTheme(): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return POSITRON; // SSR fallback; not actually rendered
  }
  const stored = document.documentElement.dataset.theme;
  if (stored === 'light') return POSITRON;
  if (stored === 'dark') return DARK_MATTER;
  // "system" or unset — follow OS preference.
  const prefersDark = window.matchMedia(
    '(prefers-color-scheme: dark)',
  ).matches;
  return prefersDark ? DARK_MATTER : POSITRON;
}
