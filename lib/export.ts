import {
  PDFDocument,
  StandardFonts,
  rgb,
  BlendMode,
  LineCapStyle,
  type PDFImage,
} from "pdf-lib";
import type { Annotation, InkStroke } from "./types";
import { annotationToPdfRect, textBaselineY, hexToRgb01 } from "./coords";
import { pointsToSvgPath } from "./ink";

/** Matches Tailwind's `leading-tight` used by the on-screen overlay. */
const LINE_HEIGHT = 1.25;

/**
 * "Bake" all annotations into the PDF.
 *
 * Annotations are already stored in PDF points (top-left origin), so the
 * only transforms needed here are:
 *   1. y-flip to pdf-lib's bottom-left origin (annotationToPdfRect)
 *   2. baseline offset for drawText (textBaselineY)
 *   3. object-contain fit for signature images (scaleToFit + centering),
 *      mirroring how the <img> renders inside the Rnd box on screen.
 */
export async function bakeAnnotations(
  pdfBytes: Uint8Array,
  annotations: Annotation[],
  strokes: InkStroke[] = []
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  // Embed each unique signature PNG only once, even if placed multiple times.
  const imageCache = new Map<string, PDFImage>();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    const { height: pageHeight } = page.getSize();

    if (ann.type === "text") {
      const text = ann.text?.trim();
      if (!text) continue;
      const fontSize = ann.fontSize ?? 14;
      const { r, g, b } = hexToRgb01(ann.color ?? "#111827");
      const firstBaseline = textBaselineY(ann, pageHeight);

      text.split("\n").forEach((line, i) => {
        page.drawText(line, {
          x: ann.x,
          y: firstBaseline - i * fontSize * LINE_HEIGHT,
          size: fontSize,
          font,
          color: rgb(r, g, b),
        });
      });
    } else if (ann.type === "signature" && ann.dataUrl) {
      let image = imageCache.get(ann.dataUrl);
      if (!image) {
        image = await doc.embedPng(ann.dataUrl);
        imageCache.set(ann.dataUrl, image);
      }
      const rect = annotationToPdfRect(ann, pageHeight);
      // object-contain: fit inside the box, centered, preserving aspect ratio.
      const fitted = image.scaleToFit(rect.width, rect.height);
      page.drawImage(image, {
        x: rect.x + (rect.width - fitted.width) / 2,
        y: rect.y + (rect.height - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height,
      });
    }
  }

  // ---- freehand ink strokes ----
  // Stroke points are stored in PDF points with a top-left origin (SVG-style,
  // y down). drawSvgPath interprets path coordinates exactly that way,
  // relative to the (x, y) origin you give it — so anchoring the origin at
  // the page's top-left corner (x: 0, y: pageHeight) means the SAME path
  // string used on screen embeds with zero coordinate math.
  for (const stroke of strokes) {
    const page = pages[stroke.pageIndex];
    if (!page || stroke.points.length === 0) continue;
    const { r, g, b } = hexToRgb01(stroke.color);

    page.drawSvgPath(pointsToSvgPath(stroke.points), {
      x: 0,
      y: page.getSize().height,
      borderColor: rgb(r, g, b),
      borderWidth: stroke.width,
      borderOpacity: stroke.opacity,
      borderLineCap: LineCapStyle.Round,
      // Multiply lets text show through highlighter ink in any PDF viewer.
      blendMode: stroke.blend === "multiply" ? BlendMode.Multiply : BlendMode.Normal,
    });
  }

  return doc.save();
}

/** Split: build a new PDF containing only `pageIndices` (0-based, in order). */
export async function extractPages(
  pdfBytes: Uint8Array,
  pageIndices: number[]
): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, pageIndices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Parse "1-3, 5, 8-10" into sorted 0-based indices.
 * Throws with a user-readable message on invalid input.
 */
export function parsePageRanges(input: string, numPages: number): number[] {
  const indices = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Enter at least one page or range.");

  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid format: "${part}"`);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end > numPages || start > end)
      throw new Error(`"${part}" is out of bounds (1–${numPages}).`);
    for (let p = start; p <= end; p++) indices.add(p - 1);
  }
  return [...indices].sort((a, b) => a - b);
}

/** Trigger a browser download of raw PDF bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const baseName = (filename: string): string =>
  filename.replace(/\.pdf$/i, "");
