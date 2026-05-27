'use client';

import { useState } from 'react';
import { EXPORT_KINDS, type ExportKind } from '@/lib/exports';
import { TILE_MODES, type TileMode } from '@/lib/tile-mode';

const KIND_LABELS: Record<ExportKind, string> = {
  raw: 'Raw',
  display: 'Display',
};

const MODE_LABELS: Record<TileMode, string> = {
  all: 'All data',
  '3mo': 'Last 3 months',
  last10: 'Last 10 observations',
};

/**
 * Three-control export picker used on /bump-map and /map. The
 * download anchor's href is built from the current pickers; clicking
 * it triggers the browser's normal file-download flow.
 *
 * `kindHelp` is per-surface copy explaining what raw vs display means
 * here (the asymmetry between personal and public is documented at
 * call sites since the meaning of "raw" differs).
 */
export function ExportControls({
  endpoint,
  kindHelp,
}: {
  endpoint: string;
  kindHelp: { raw: string; display: string };
}) {
  const [kind, setKind] = useState<ExportKind>('display');
  const [mode, setMode] = useState<TileMode>('all');
  const href = `${endpoint}?kind=${kind}&mode=${mode}`;

  return (
    <details className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium text-text">
        Export data ▾
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <Picker
          label="Kind"
          values={EXPORT_KINDS as unknown as readonly string[]}
          labels={KIND_LABELS}
          current={kind}
          onChange={(v) => setKind(v as ExportKind)}
        />
        <p className="text-xs text-text-muted">{kindHelp[kind]}</p>
        <Picker
          label="View"
          values={TILE_MODES as unknown as readonly string[]}
          labels={MODE_LABELS as Record<string, string>}
          current={mode}
          onChange={(v) => setMode(v as TileMode)}
        />
        <a
          href={href}
          download
          className="inline-block self-start rounded bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong/90"
        >
          Download JSON
        </a>
      </div>
    </details>
  );
}

function Picker({
  label,
  values,
  labels,
  current,
  onChange,
}: {
  label: string;
  values: readonly string[];
  labels: Record<string, string>;
  current: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex overflow-hidden rounded border border-border-strong bg-bg"
      >
        {values.map((v) => {
          const isCurrent = current === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              onClick={() => onChange(v)}
              className={`px-3 py-1.5 text-sm transition ${
                isCurrent
                  ? 'bg-accent-strong text-white'
                  : 'text-text-muted hover:bg-surface hover:text-text'
              }`}
            >
              {labels[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
