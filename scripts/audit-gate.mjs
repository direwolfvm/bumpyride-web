// Fails CI on high or critical advisories in production dependencies,
// except the reviewed exceptions below. Each exception says why it does not
// apply here and when to remove it.
import { execFileSync } from 'node:child_process';

const IGNORED = {
  // maplibre-gl DOM.sanitize() bypass. Only reachable through Popup HTML
  // (setHTML), which this app never uses. Fixed in maplibre-gl 6, a major
  // upgrade (ESM-only, API changes) that needs its own PR. Remove when on 6.x.
  'GHSA-jrc7-96c5-q579': 'maplibre-gl popup sanitizer, popups unused',
};

let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
} catch (err) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = err.stdout;
}

const report = JSON.parse(raw);
const blocking = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue;
    if (via.severity !== 'high' && via.severity !== 'critical') continue;
    const id = via.url?.split('/').pop();
    if (IGNORED[id]) {
      console.log(`ignored ${id} (${name}): ${IGNORED[id]}`);
      continue;
    }
    blocking.push(`${via.severity} ${name}: ${via.title} ${via.url}`);
  }
}

if (blocking.length) {
  console.error('High or critical advisories in production dependencies:');
  for (const line of blocking) console.error(`  ${line}`);
  process.exit(1);
}
console.log('No unreviewed high or critical advisories in production dependencies.');
