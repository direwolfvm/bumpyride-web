// Runs once in <head> before paint to promote data-theme="system" to the
// user's stored preference. Plain string injected via dangerouslySetInnerHTML
// — no React hydration, no JS module overhead. Stays in sync with the
// STORAGE_KEY constant in ThemeToggle.tsx.
const INIT_SCRIPT = `
(function() {
  try {
    var v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark') {
      document.documentElement.dataset.theme = v;
    }
  } catch (e) {}
})();
`;

export function ThemeInit() {
  return <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />;
}
