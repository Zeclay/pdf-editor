/**
 * Autosave / restore via IndexedDB.
 *
 * One "current" session record is kept:
 *   { pdfBytes, annotations, strokes, fileName, savedAt }
 *
 * Uint8Array is structured-clone-safe so it serialises into IDB natively.
 * All public functions are safe to call on the first render — they open (and
 * migrate) the database on demand and resolve/reject cleanly.
 */
import type { Annotation, InkStroke } from "./types";

const DB_NAME = "pdf-editor-autosave";
const DB_VERSION = 1;
const STORE = "session";
const SESSION_KEY = "current";

export interface SessionData {
  pdfBytes: Uint8Array;
  annotations: Annotation[];
  strokes: InkStroke[];
  fileName: string;
  savedAt: number; // Date.now()
}

// ---------------------------------------------------------------------------
// Internal: open (+ create schema on first run)
// ---------------------------------------------------------------------------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IDB blocked"));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist the current editor state.
 * Silently swallows errors so a failing IDB never crashes the editor.
 */
export async function saveSession(data: SessionData): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[autosave] save failed:", err);
  }
}

/**
 * Load the last saved session, or null if none exists.
 * Returns null (not throws) on any IDB error.
 */
export async function loadSession(): Promise<SessionData | null> {
  try {
    const db = await openDB();
    return await new Promise<SessionData | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(SESSION_KEY);
      req.onsuccess = () => { db.close(); resolve((req.result as SessionData) ?? null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (err) {
    console.warn("[autosave] load failed:", err);
    return null;
  }
}

/**
 * Erase the saved session (e.g. user clicks "Start fresh").
 */
export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[autosave] clear failed:", err);
  }
}
