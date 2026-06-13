/**
 * Client-side file validation helpers.
 *
 * Two layers of defence:
 *   1. MIME type   — browser-reported, easily spoofed, fast first check
 *   2. Magic bytes — reads the actual first bytes of the file, can't be spoofed
 */

/** 100 MB hard limit per PDF file. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** Human-readable size string, e.g. "123.4 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Verify that a File actually starts with the PDF magic bytes `%PDF-`.
 * Returns false if the file is too small or the read fails.
 */
export async function isPdfMagic(file: File): Promise<boolean> {
  try {
    const buf = await file.slice(0, 5).arrayBuffer();
    const b = new Uint8Array(buf);
    // 0x25='%' 0x50='P' 0x44='D' 0x46='F' 0x2D='-'
    return (
      b[0] === 0x25 &&
      b[1] === 0x50 &&
      b[2] === 0x44 &&
      b[3] === 0x46 &&
      b[4] === 0x2D
    );
  } catch {
    return false;
  }
}

export interface FileValidationResult {
  ok: boolean;
  /** Human-readable error, set only when ok === false */
  error?: string;
}

/**
 * Full validation for a PDF upload:
 *   - MIME type must be application/pdf
 *   - File must not exceed MAX_PDF_BYTES
 *   - Magic bytes must match %PDF-
 */
export async function validatePdfFile(file: File): Promise<FileValidationResult> {
  if (file.type !== "application/pdf") {
    return { ok: false, error: `"${file.name}" is not a PDF file.` };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `"${file.name}" is too large (${formatBytes(file.size)}). Maximum allowed size is ${formatBytes(MAX_PDF_BYTES)}.`,
    };
  }
  const magic = await isPdfMagic(file);
  if (!magic) {
    return {
      ok: false,
      error: `"${file.name}" does not appear to be a valid PDF file.`,
    };
  }
  return { ok: true };
}
