'use client';

import { useState } from 'react';
import { formatUkDateTime } from '@/lib/format';

// A dependency-free SVG line chart for trend views. Kept deliberately small:
// one series, optional 0-100 fixed scale (for percentages), a light grid, and
// a hover tooltip. Good enough for CPU / RAM / disk trends without shipping a
// charting library.

export interface ChartPoint {
  t: string; // ISO timestamp
  v: number | null; // value
}

export function LineChart({
  points,
  color = '#2563eb',
  height = 160,
  fixed0to100 = false,
  unit = '',
  valueFormatter,
}: {
  points: ChartPoint[];
  color?: string;
  height?: number;
  fixed0to100?: boolean;
  unit?: string;
  valueFormatter?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const clean = points.filter((p) => p.v != null && !isNaN(p.v as number)) as {
    t: string;
    v: number;
  }[];

  if (clean.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const W = 640;
  const H = height;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = clean.map((p) => p.v);
  const maxV = fixed0to100 ? 100 : Math.max(...values) * 1.1 || 1;
  const minV = fixed0to100 ? 0 : Math.min(...values, 0);

  const n = clean.length;
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - minV) / (maxV - minV || 1)) * innerH;

  const linePath = clean
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(' ');

  const areaPath =
    `${linePath} L ${x(n - 1).toFixed(1)} ${padT + innerH} L ${x(0).toFixed(1)} ${padT + innerH} Z`;

  // A few horizontal gridlines with labels.
  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => minV + ((maxV - minV) * i) / ticks);

  const fmt = valueFormatter || ((v: number) => `${Math.round(v)}${unit}`);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
    >
      {/* gridlines */}
      {gridY.map((gv, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(gv)}
            y2={y(gv)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text x={padL - 6} y={y(gv) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
            {fmt(gv)}
          </text>
        </g>
      ))}

      {/* area + line */}
      <path d={areaPath} fill={color} opacity={0.08} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

      {/* hover hit areas + marker */}
      {clean.map((p, i) => (
        <rect
          key={i}
          x={x(i) - innerW / (2 * Math.max(1, n - 1))}
          y={padT}
          width={Math.max(2, innerW / Math.max(1, n - 1))}
          height={innerH}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
        />
      ))}
      {hover != null && (
        <g>
          <circle cx={x(hover)} cy={y(clean[hover].v)} r={3.5} fill={color} />
          <text
            x={Math.min(Math.max(x(hover), padL + 40), W - padR - 40)}
            y={padT + 10}
            textAnchor="middle"
            fontSize={11}
            fill="#0f172a"
          >
            {fmt(clean[hover].v)} · {formatUkDateTime(clean[hover].t)}
          </text>
        </g>
      )}
    </svg>
  );
}
