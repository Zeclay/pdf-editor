export type AnnotationType = "text" | "signature";

/**
 * IMPORTANT — coordinate convention:
 * Annotations are stored in **PDF points** (1 pt = 1/72"), NOT screen pixels,
 * with a **top-left origin** (y grows downward, like CSS).
 *
 * - The DraggableOverlay converts points -> pixels for display (`pt * scale`)
 *   and pixels -> points on drag/resize stop (`px / scale`).
 * - At export time only the y-axis needs flipping to pdf-lib's bottom-left
 *   origin (see lib/coords.ts -> annotationToPdfRect).
 *
 * Storing in points means zoom changes never corrupt positions.
 */
export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 0-based page index in the *current* document */
  pageIndex: number;
  /** Top-left x, in PDF points */
  x: number;
  /** Top-left y, in PDF points (from the TOP of the page) */
  y: number;
  /** Width in PDF points */
  width: number;
  /** Height in PDF points */
  height: number;
  // --- text ---
  text?: string;
  /** Font size in PDF points */
  fontSize?: number;
  color?: string; // hex, e.g. "#111827"
  // --- signature ---
  /** PNG data URL from react-signature-canvas */
  dataUrl?: string;
}

/** Intrinsic page size in PDF points (react-pdf's originalWidth/Height at scale 1). */
export interface PageDimensions {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Freehand drawing (ink)
// ---------------------------------------------------------------------------

export type DrawTool = "pen" | "highlighter" | "eraser";

export interface InkPoint {
  x: number;
  y: number;
}

/**
 * A freehand stroke. Same convention as Annotation: points live in
 * **PDF points with a top-left origin**, captured as `px / scale` while
 * drawing, so they're zoom-independent and export needs no rescaling.
 */
export interface InkStroke {
  id: string;
  pageIndex: number;
  points: InkPoint[];
  color: string; // hex
  /** Stroke width in PDF points */
  width: number;
  /** 0..1 — highlighter is translucent */
  opacity: number;
  /** "multiply" keeps text readable under highlighter ink in the final PDF */
  blend: "normal" | "multiply";
}
