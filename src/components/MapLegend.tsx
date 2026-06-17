'use client';

import type { ReactNode } from 'react';

// Floating legend / layer-visibility control overlaid on the map.
// Positioned absolutely inside a relatively-positioned map wrapper.
//
// Each item is a checkbox that mirrors and controls the visibility of
// a MapLibre layer. The swatch is a small colored square (or custom
// node) so the legend doubles as a colour key.

export type LegendItem = {
  id: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
  // 1-2 word hint shown after the label, e.g. "halo-only".
  hint?: string;
  // Color swatch — usually a CSS color, or a custom node for things
  // like the events marker (red dot with white ring) or the halo
  // (gradient swatch). Pass `null` for items that don't need a
  // visible swatch (e.g. the disclosure header).
  swatch?: ReactNode;
};

export function MapLegend({
  items,
  defaultOpen = true,
}: {
  items: ReadonlyArray<LegendItem>;
  defaultOpen?: boolean;
}) {
  return (
    <div className="absolute right-3 top-3 z-10 max-w-[14rem]">
      <details
        open={defaultOpen}
        className="group rounded-lg border border-border-strong bg-surface/95 shadow-sm backdrop-blur-sm"
      >
        <summary
          className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium uppercase tracking-wide text-text"
          aria-label="Toggle layer legend"
        >
          <span>Layers</span>
          <span
            aria-hidden
            className="text-text-muted transition group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <ul className="space-y-1.5 border-t border-border px-3 py-2 text-xs">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-bg">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={item.onToggle}
                  className="h-3.5 w-3.5 cursor-pointer accent-accent-strong"
                />
                {item.swatch !== null && item.swatch !== undefined ? (
                  <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {item.swatch}
                  </span>
                ) : null}
                <span className="flex-1 leading-tight text-text">
                  {item.label}
                </span>
                {item.hint && (
                  <span className="text-[10px] uppercase tracking-wide text-text-dim">
                    {item.hint}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// Small reusable swatch shapes used by both PublicBumpMap and
// PrivateBumpMap. Keep dimensions matching the 14-px (h-3.5)
// checkbox so everything aligns.

export function ColorSquareSwatch({ from, to }: { from: string; to: string }) {
  return (
    <span
      className="block h-3.5 w-3.5 rounded-sm"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    />
  );
}

export function CircleMarkerSwatch({ color }: { color: string }) {
  return (
    <span
      className="block h-3 w-3 rounded-full ring-2 ring-white"
      style={{ background: color }}
    />
  );
}

