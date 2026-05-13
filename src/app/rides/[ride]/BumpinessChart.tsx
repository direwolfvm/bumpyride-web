'use client';

import { useMemo, useState } from 'react';
import type { Sample } from './RouteMap';

const WIDTH = 900;
const HEIGHT = 180;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 24;

// Plain SVG chart. We're plotting one timeseries with a few hundred to a
// few thousand points — no zoom, no scrubber. A charting lib would be
// overkill for this; keep the dep budget tight.
export function BumpinessChart({ samples }: { samples: Sample[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; sample: Sample } | null>(null);

  const { yMax, polyline, ticks, xScale, yScale } = useMemo(() => {
    if (samples.length === 0) {
      return { yMax: 1, polyline: '', ticks: [] as number[], xScale: () => 0, yScale: () => 0 };
    }
    const tMax = samples[samples.length - 1].tSec;
    const bumpMax = Math.max(1, ...samples.map((s) => s.bumpiness));
    const ymax = Math.ceil(bumpMax * 1.1 * 10) / 10;

    const innerW = WIDTH - PAD_L - PAD_R;
    const innerH = HEIGHT - PAD_T - PAD_B;
    const xs = (t: number) => PAD_L + (tMax > 0 ? (t / tMax) * innerW : 0);
    const ys = (b: number) => PAD_T + innerH - (b / ymax) * innerH;

    const poly = samples.map((s) => `${xs(s.tSec).toFixed(1)},${ys(s.bumpiness).toFixed(1)}`).join(' ');
    const tickCount = 4;
    const tickValues = Array.from({ length: tickCount + 1 }, (_, i) => (ymax / tickCount) * i);
    return { yMax: ymax, polyline: poly, ticks: tickValues, xScale: xs, yScale: ys };
  }, [samples]);

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (samples.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const innerW = WIDTH - PAD_L - PAD_R;
    const t = ((px - PAD_L) / innerW) * samples[samples.length - 1].tSec;
    let nearest = samples[0];
    let bestDiff = Math.abs(nearest.tSec - t);
    for (const s of samples) {
      const d = Math.abs(s.tSec - t);
      if (d < bestDiff) {
        bestDiff = d;
        nearest = s;
      }
    }
    setHover({ x: xScale(nearest.tSec), y: yScale(nearest.bumpiness), sample: nearest });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--color-text-dim)"
            >
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        />
        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD_T}
              y2={HEIGHT - PAD_B}
              stroke="var(--color-border-strong)"
              strokeDasharray="3 3"
            />
            <circle cx={hover.x} cy={hover.y} r={3.5} fill="var(--color-accent)" />
            <text
              x={Math.min(hover.x + 8, WIDTH - PAD_R - 90)}
              y={Math.max(hover.y - 6, PAD_T + 10)}
              fontSize={11}
              fill="var(--color-text)"
            >
              {hover.sample.bumpiness.toFixed(2)} g · {hover.sample.tSec.toFixed(1)}s
            </text>
          </>
        )}
        <text x={PAD_L} y={HEIGHT - 6} fontSize={10} fill="var(--color-text-dim)">
          0s
        </text>
        <text
          x={WIDTH - PAD_R}
          y={HEIGHT - 6}
          fontSize={10}
          fill="var(--color-text-dim)"
          textAnchor="end"
        >
          {samples.length > 0 ? `${samples[samples.length - 1].tSec.toFixed(0)}s` : '0s'}
        </text>
        <text
          x={6}
          y={PAD_T + 4}
          fontSize={10}
          fill="var(--color-text-dim)"
        >
          g (max {yMax.toFixed(1)})
        </text>
      </svg>
    </div>
  );
}
