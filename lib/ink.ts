import type { InkPoint } from "./types";

/**
 * Build a smoothed SVG path from stroke points.
 *
 * Used by BOTH renderers, which is what makes drawing WYSIWYG:
 *   - DrawingLayer:  pointsToSvgPath(points, scale)  -> on-screen <path d>
 *   - lib/export.ts: pointsToSvgPath(points)         -> pdf-lib drawSvgPath
 *     (points are stored in PDF points, so scale = 1 at export)
 *
 * Smoothing: quadratic curves through midpoints — each captured point becomes
 * a control point, so jittery pointer input renders as a clean curve.
 */
export function pointsToSvgPath(points: InkPoint[], scale = 1): string {
  if (points.length === 0) return "";
  const p = points.map((pt) => ({ x: r2(pt.x * scale), y: r2(pt.y * scale) }));

  if (p.length < 3) {
    const a = p[0];
    const b = p[p.length - 1];
    // Dots/short taps: tiny line segment so round line caps render a dot.
    return `M ${a.x} ${a.y} L ${b.x + 0.01} ${b.y + 0.01}`;
  }

  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const midX = r2((p[i].x + p[i + 1].x) / 2);
    const midY = r2((p[i].y + p[i + 1].y) / 2);
    d += ` Q ${p[i].x} ${p[i].y} ${midX} ${midY}`;
  }
  const last = p[p.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Round to 2 decimals — keeps path strings (and the final PDF) compact. */
const r2 = (n: number) => Math.round(n * 100) / 100;
