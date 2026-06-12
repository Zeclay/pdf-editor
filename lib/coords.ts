import type { Annotation } from "./types";

/**
 * Screen <-> PDF coordinate conversion.
 *
 * `scale` is always: renderedPageWidthPx / pageWidthPt
 * (i.e. CSS pixels per PDF point at the current zoom).
 *
 * react-pdf reports the intrinsic size via page.originalWidth/originalHeight,
 * which is the PDF viewport at scale 1 — exactly PDF points.
 */

/** CSS pixels -> PDF points */
export const pxToPt = (px: number, scale: number): number => px / scale;

/** PDF points -> CSS pixels */
export const ptToPx = (pt: number, scale: number): number => pt * scale;

/** Pixels-per-point for a page rendered at `renderedWidthPx`. */
export const getScale = (renderedWidthPx: number, pageWidthPt: number): number =>
  renderedWidthPx / pageWidthPt;

/**
 * Convert a stored annotation (top-left origin, points) to the rectangle
 * pdf-lib expects (bottom-left origin, points).
 *
 * pdf-lib's y is the BOTTOM edge of the drawn object, so:
 *   pdfY = pageHeight - topY - height
 */
export function annotationToPdfRect(
  ann: Pick<Annotation, "x" | "y" | "width" | "height">,
  pageHeightPt: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: ann.x,
    y: pageHeightPt - ann.y - ann.height,
    width: ann.width,
    height: ann.height,
  };
}

/**
 * Baseline y for pdf-lib's drawText: drawText positions text at its
 * BASELINE, not the box top. Approximate the baseline as fontSize * 0.85
 * below the top of the box (works well for Helvetica).
 */
export function textBaselineY(
  ann: Pick<Annotation, "y" | "fontSize">,
  pageHeightPt: number
): number {
  const fontSize = ann.fontSize ?? 14;
  return pageHeightPt - ann.y - fontSize * 0.85;
}

/** Hex "#rrggbb" -> { r, g, b } in 0..1 for pdf-lib's rgb(). */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export const newId = (): string =>
  `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
