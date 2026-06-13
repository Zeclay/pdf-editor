"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, degrees } from "pdf-lib";
import {
  FileUp,
  FilePlus2,
  Type,
  PenLine,
  Download,
  Trash2,
  Scissors,
  ZoomIn,
  ZoomOut,
  Loader2,
  Pencil,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  RotateCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import DraggableOverlay from "./DraggableOverlay";
import DrawingLayer from "./DrawingLayer";
import SignatureModal from "./SignatureModal";
import SplitModal from "./SplitModal";
import type { Annotation, DrawTool, InkStroke, PageDimensions } from "@/lib/types";
import { getScale, newId } from "@/lib/coords";
import { bakeAnnotations, extractPages, downloadBytes, baseName } from "@/lib/export";
import { saveSession, loadSession, clearSession } from "@/lib/autosave";
import type { SessionData } from "@/lib/autosave";
import { validatePdfFile } from "@/lib/validate";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const BASE_PAGE_WIDTH = 800;
const THUMB_WIDTH = 110;
const MAX_HISTORY = 30;
const AUTOSAVE_DELAY_MS = 1500;

const PEN_COLORS = ["#111827", "#1d4ed8", "#b91c1c"];
const HIGHLIGHT_COLORS = ["#facc15", "#4ade80", "#f472b6"];
const PEN_WIDTH_RANGE = { min: 1, max: 10, default: 2 };
const HIGHLIGHT_WIDTH_RANGE = { min: 6, max: 24, default: 12 };

interface HistorySnapshot {
  pdfBytes: Uint8Array | null;
  annotations: Annotation[];
  strokes: InkStroke[];
}

export default function PdfEditor() {
  // ---- document state ----
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageDims, setPageDims] = useState<Record<number, PageDimensions>>({});
  const [fileName, setFileName] = useState("document.pdf");
  const [isBusy, setIsBusy] = useState(false);

  // ---- editor state ----
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- freehand drawing ----
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[2]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTH_RANGE.default);
  const [highlightWidth, setHighlightWidth] = useState(HIGHLIGHT_WIDTH_RANGE.default);

  // ---- undo / redo ----
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ---- sidebar ----
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const thumbRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ---- page reorder drag ----
  const dragPageIdx = useRef<number | null>(null);
  const [thumbOverIdx, setThumbOverIdx] = useState<number | null>(null);

  // ---- validation / warnings ----
  const [fileError, setFileError] = useState<string | null>(null);
  /** True when the loaded PDF had its encryption flag set (password-protected). */
  const [wasEncrypted, setWasEncrypted] = useState(false);

  // ---- autosave ----
  const [pendingSession, setPendingSession] = useState<SessionData | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // =========================================================================
  // Derived
  // =========================================================================
  const strokeStyle =
    drawTool === "highlighter"
      ? { color: highlightColor, width: highlightWidth, opacity: 0.45, blend: "multiply" as const }
      : { color: penColor, width: penWidth, opacity: 1, blend: "normal" as const };

  const toggleDrawTool = (tool: DrawTool) => {
    setDrawTool((t) => (t === tool ? null : tool));
    setSelectedId(null);
  };

  // Blob prevents DataCloneError when two <Document>s share the same buffer.
  const documentFile = useMemo(
    () => pdfBytes ? new Blob([pdfBytes.slice().buffer], { type: "application/pdf" }) : null,
    [pdfBytes]
  );

  // =========================================================================
  // History
  // =========================================================================
  const pushHistory = useCallback(() => {
    undoStack.current = [...undoStack.current, { pdfBytes, annotations, strokes }].slice(-MAX_HISTORY);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [pdfBytes, annotations, strokes]);

  const undo = useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current = [...redoStack.current, { pdfBytes, annotations, strokes }];
    if (snap.pdfBytes !== pdfBytes) { setNumPages(0); setPdfBytes(snap.pdfBytes); setPageDims({}); }
    setAnnotations(snap.annotations);
    setStrokes(snap.strokes);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [pdfBytes, annotations, strokes]);

  const redo = useCallback(() => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current = [...undoStack.current, { pdfBytes, annotations, strokes }].slice(-MAX_HISTORY);
    if (snap.pdfBytes !== pdfBytes) { setNumPages(0); setPdfBytes(snap.pdfBytes); setPageDims({}); }
    setAnnotations(snap.annotations);
    setStrokes(snap.strokes);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [pdfBytes, annotations, strokes]);

  // =========================================================================
  // Autosave: load on mount, save on change (debounced)
  // =========================================================================
  // 1 — check for a saved session when the component first mounts
  useEffect(() => {
    loadSession()
      .then((s) => { if (s) setPendingSession(s); })
      .catch(() => {/* ignore */});
  }, []);

  // 2 — debounced save whenever editing state changes
  useEffect(() => {
    if (!pdfBytes) return; // nothing to save before a file is loaded
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveSession({ pdfBytes, annotations, strokes, fileName, savedAt: Date.now() });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [pdfBytes, annotations, strokes, fileName]);

  // =========================================================================
  // Sidebar: auto-scroll active thumbnail into view
  // =========================================================================
  useEffect(() => {
    if (!sidebarOpen) return;
    thumbRefs.current[activePage]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activePage, sidebarOpen]);

  // =========================================================================
  // File management
  // =========================================================================
  const loadFiles = useCallback(
    async (files: File[]) => {
      // Filter to PDF files first, then validate each one.
      const candidates = files.filter((f) => f.type === "application/pdf");
      if (candidates.length === 0) return;

      setFileError(null);
      setIsBusy(true);
      try {
        // Validate every file before touching pdf-lib.
        for (const f of candidates) {
          const result = await validatePdfFile(f);
          if (!result.ok) {
            setFileError(result.error ?? "Invalid file.");
            return;
          }
        }

        let bytes: Uint8Array;
        let foundEncrypted = false;

        if (candidates.length === 1 && !pdfBytes) {
          bytes = new Uint8Array(await candidates[0].arrayBuffer());
          // Detect encryption: try loading without ignoreEncryption flag.
          try {
            await PDFDocument.load(bytes);
          } catch {
            // pdf-lib throws when it hits an encrypted document.
            foundEncrypted = true;
          }
          // Re-load with ignoreEncryption so editing still works.
          await PDFDocument.load(bytes, { ignoreEncryption: true });
        } else {
          const merged = await PDFDocument.create();
          const sources: (Uint8Array | ArrayBuffer)[] = [];
          if (pdfBytes) sources.push(pdfBytes);
          for (const f of candidates) sources.push(await f.arrayBuffer());
          for (const src of sources) {
            const srcBytes = src instanceof ArrayBuffer ? new Uint8Array(src) : src;
            // Detect encryption on each new file.
            try {
              await PDFDocument.load(srcBytes);
            } catch {
              foundEncrypted = true;
            }
            const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
            const pages = await merged.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => merged.addPage(p));
          }
          bytes = await merged.save();
        }

        setWasEncrypted(foundEncrypted);
        setNumPages(0);
        setPdfBytes(bytes);
        if (!pdfBytes) setFileName(candidates[0].name);
        setPageDims({});
        setSelectedId(null);
        setPendingSession(null);
      } finally {
        setIsBusy(false);
      }
    },
    [pdfBytes]
  );

  // Restore a saved session
  const handleRestore = useCallback(() => {
    if (!pendingSession) return;
    setNumPages(0);
    setPdfBytes(pendingSession.pdfBytes);
    setAnnotations(pendingSession.annotations);
    setStrokes(pendingSession.strokes);
    setFileName(pendingSession.fileName);
    setPageDims({});
    setPendingSession(null);
  }, [pendingSession]);

  const handleDiscardSession = useCallback(() => {
    void clearSession();
    setPendingSession(null);
  }, []);

  // =========================================================================
  // Page: delete
  // =========================================================================
  const deletePage = useCallback(
    async (pageIndex: number) => {
      if (!pdfBytes || numPages <= 1) return;
      pushHistory();
      setIsBusy(true);
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        doc.removePage(pageIndex);
        const bytes = await doc.save();
        setNumPages(0); setPdfBytes(bytes); setPageDims({});
        setAnnotations((prev) =>
          prev.filter((a) => a.pageIndex !== pageIndex)
              .map((a) => a.pageIndex > pageIndex ? { ...a, pageIndex: a.pageIndex - 1 } : a)
        );
        setStrokes((prev) =>
          prev.filter((s) => s.pageIndex !== pageIndex)
              .map((s) => s.pageIndex > pageIndex ? { ...s, pageIndex: s.pageIndex - 1 } : s)
        );
        setActivePage((p) => Math.max(0, Math.min(p, numPages - 2)));
      } finally { setIsBusy(false); }
    },
    [pdfBytes, numPages, pushHistory]
  );

  // =========================================================================
  // Page: reorder
  // =========================================================================
  const reorderPages = useCallback(
    async (newOrder: number[]) => {
      if (!pdfBytes) return;
      pushHistory();
      setIsBusy(true);
      try {
        const bytes = await extractPages(pdfBytes, newOrder);
        setNumPages(0); setPdfBytes(bytes); setPageDims({});
        setAnnotations((prev) =>
          prev.map((a) => ({ ...a, pageIndex: newOrder.indexOf(a.pageIndex) }))
              .filter((a) => a.pageIndex !== -1)
        );
        setStrokes((prev) =>
          prev.map((s) => ({ ...s, pageIndex: newOrder.indexOf(s.pageIndex) }))
              .filter((s) => s.pageIndex !== -1)
        );
        setActivePage((p) => { const n = newOrder.indexOf(p); return n === -1 ? 0 : n; });
      } finally { setIsBusy(false); }
    },
    [pdfBytes, pushHistory]
  );

  // =========================================================================
  // Page: rotate
  // =========================================================================
  const rotatePage = useCallback(
    async (pageIndex: number, delta: 90 | -90) => {
      if (!pdfBytes) return;
      pushHistory();
      setIsBusy(true);
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const page = doc.getPages()[pageIndex];
        const current = page.getRotation().angle;
        // Normalise to 0-359 so pdf-lib never sees negative values.
        page.setRotation(degrees(((current + delta) % 360 + 360) % 360));
        const bytes = await doc.save();
        // Page dimensions swap on 90/270 — reset so react-pdf re-measures.
        setNumPages(0); setPdfBytes(bytes); setPageDims({});
      } finally { setIsBusy(false); }
    },
    [pdfBytes, pushHistory]
  );

  // =========================================================================
  // Annotations
  // =========================================================================
  const addText = useCallback(() => {
    const dims = pageDims[activePage];
    if (!dims) return;
    setDrawTool(null);
    pushHistory();
    const ann: Annotation = {
      id: newId(), type: "text", pageIndex: activePage,
      x: dims.width / 2 - 90, y: dims.height / 3,
      width: 180, height: 28,
      text: "Double-click to edit", fontSize: 14, color: "#111827",
    };
    setAnnotations((prev) => [...prev, ann]);
    setSelectedId(ann.id);
  }, [activePage, pageDims, pushHistory]);

  const addSignature = useCallback(
    (dataUrl: string, aspect: number) => {
      const dims = pageDims[activePage];
      if (!dims) return;
      setDrawTool(null);
      pushHistory();
      const width = 200;
      const height = Math.min(width / (aspect > 0 ? aspect : 2.5), dims.height / 3);
      const ann: Annotation = {
        id: newId(), type: "signature", pageIndex: activePage,
        x: dims.width / 2 - width / 2, y: dims.height / 2,
        width, height, dataUrl,
      };
      setAnnotations((prev) => [...prev, ann]);
      setSelectedId(ann.id);
    },
    [activePage, pageDims, pushHistory]
  );

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      pushHistory();
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    },
    [pushHistory]
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      pushHistory();
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [pushHistory]
  );

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault(); deleteAnnotation(selectedId);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault(); redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      } else if (e.key === "Escape") {
        setSelectedId(null); setDrawTool(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deleteAnnotation, undo, redo]);

  // =========================================================================
  // Modals + export
  // =========================================================================
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);

  const handleSplitExport = useCallback(
    async (indices: number[]) => {
      if (!pdfBytes) return;
      setIsBusy(true);
      try {
        const bytes = await extractPages(pdfBytes, indices);
        downloadBytes(bytes, `${baseName(fileName)}-pages.pdf`);
        setShowSplitModal(false);
      } finally { setIsBusy(false); }
    },
    [pdfBytes, fileName]
  );

  const finalizeAndDownload = useCallback(async () => {
    if (!pdfBytes) return;
    setIsBusy(true);
    try {
      const bytes = await bakeAnnotations(pdfBytes, annotations, strokes);
      downloadBytes(bytes, `${baseName(fileName)}-final.pdf`);
    } finally { setIsBusy(false); }
  }, [pdfBytes, annotations, strokes, fileName]);

  // =========================================================================
  // Render — upload / drop zone
  // =========================================================================
  if (!pdfBytes) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 p-8">
        {/* ---- autosave restore banner ---- */}
        {pendingSession && (
          <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm shadow-sm">
            <CheckCircle2 size={18} className="shrink-0 text-blue-500" />
            <div className="flex-1 text-gray-700">
              <span className="font-semibold">{pendingSession.fileName}</span> — autosaved{" "}
              {new Date(pendingSession.savedAt).toLocaleString()}
            </div>
            <button
              type="button"
              onClick={handleRestore}
              className="rounded-lg bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={handleDiscardSession}
              className="rounded p-1 text-gray-400 hover:text-gray-600"
              title="Discard saved session"
            >
              ✕
            </button>
          </div>
        )}

        {/* ---- file validation error ---- */}
        {fileError && (
          <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0 text-red-500" />
            <span className="flex-1 text-red-700">{fileError}</span>
            <button type="button" onClick={() => setFileError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* ---- drop zone ---- */}
        <div
          className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
            isDragOver
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            void loadFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <FileUp size={40} className="text-blue-500" />
          <div>
            <p className="text-lg font-semibold text-gray-800">Drop PDF files here</p>
            <p className="mt-1 text-sm text-gray-500">
              or click to browse — multiple files are merged in order
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => e.target.files && void loadFiles(Array.from(e.target.files))}
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // Render — editor
  // =========================================================================
  return (
    <div className="flex h-screen flex-col">
      {/* ===================== Toolbar ===================== */}
      <header className="z-30 flex items-center gap-1 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
        <span className="mr-3 max-w-48 truncate text-sm font-semibold text-gray-700">
          {fileName}
        </span>

        <ToolbarButton icon={<FilePlus2 size={16} />} label="Add PDF" onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && void loadFiles(Array.from(e.target.files))}
        />
        <ToolbarButton icon={<Type size={16} />} label="Add Text" onClick={addText} />
        <ToolbarButton icon={<PenLine size={16} />} label="Sign" onClick={() => setShowSignatureModal(true)} />
        <ToolbarButton icon={<Scissors size={16} />} label="Split" onClick={() => setShowSplitModal(true)} />

        <div className="mx-3 h-5 w-px bg-gray-200" />

        {/* draw tools */}
        <ToolbarButton icon={<Pencil size={16} />} label="Draw" active={drawTool === "pen"} onClick={() => toggleDrawTool("pen")} />
        <ToolbarButton icon={<Highlighter size={16} />} label="Highlight" active={drawTool === "highlighter"} onClick={() => toggleDrawTool("highlighter")} />
        <ToolbarButton icon={<Eraser size={16} />} label="" active={drawTool === "eraser"} onClick={() => toggleDrawTool("eraser")} />

        {(drawTool === "pen" || drawTool === "highlighter") && (
          <div className="ml-1 flex items-center gap-1.5">
            {(drawTool === "pen" ? PEN_COLORS : HIGHLIGHT_COLORS).map((c) => {
              const current = drawTool === "pen" ? penColor : highlightColor;
              const setColor = drawTool === "pen" ? setPenColor : setHighlightColor;
              return (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border-2 ${current === c ? "border-blue-500" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
            <input
              type="range"
              title="Stroke width"
              min={drawTool === "pen" ? PEN_WIDTH_RANGE.min : HIGHLIGHT_WIDTH_RANGE.min}
              max={drawTool === "pen" ? PEN_WIDTH_RANGE.max : HIGHLIGHT_WIDTH_RANGE.max}
              step={1}
              value={drawTool === "pen" ? penWidth : highlightWidth}
              onChange={(e) => (drawTool === "pen" ? setPenWidth : setHighlightWidth)(Number(e.target.value))}
              className="ml-2 h-1 w-20 cursor-pointer accent-blue-600"
            />
            <span className="flex w-7 items-center justify-center">
              <span
                className="rounded-full"
                style={{
                  width: Math.min(strokeStyle.width, 24),
                  height: Math.min(strokeStyle.width, 24),
                  backgroundColor: strokeStyle.color,
                  opacity: strokeStyle.opacity,
                }}
              />
            </span>
          </div>
        )}

        <div className="mx-3 h-5 w-px bg-gray-200" />

        {/* undo / redo */}
        <ToolbarButton icon={<Undo2 size={16} />} label="" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
        <ToolbarButton icon={<Redo2 size={16} />} label="" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} />

        <div className="mx-3 h-5 w-px bg-gray-200" />

        {/* zoom */}
        <ToolbarButton icon={<ZoomOut size={16} />} label="" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} />
        <span className="w-12 text-center text-xs tabular-nums text-gray-500">{Math.round(zoom * 100)}%</span>
        <ToolbarButton icon={<ZoomIn size={16} />} label="" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} />

        <div className="flex-1" />

        {/* autosave indicator */}
        {saveStatus === "saving" && (
          <span className="mr-2 flex items-center gap-1 text-xs text-gray-400">
            <Loader2 size={13} className="animate-spin" /> Saving…
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="mr-2 flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="mr-2 flex items-center gap-1 text-xs text-red-500" title="Autosave failed">
            <AlertCircle size={13} /> Save failed
          </span>
        )}

        {isBusy && <Loader2 size={16} className="mr-2 animate-spin text-blue-500" />}
        <button
          type="button"
          onClick={finalizeAndDownload}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Download size={15} />
          Finalize &amp; Download
        </button>
      </header>

      {/* encryption warning */}
      {wasEncrypted && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          <AlertCircle size={13} className="shrink-0" />
          This PDF was password-protected. The password has been bypassed for editing — the exported file will not be encrypted.
          <button type="button" onClick={() => setWasEncrypted(false)} className="ml-auto text-amber-500 hover:text-amber-700">✕</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ===================== Thumbnail sidebar ===================== */}
        <aside className={`shrink-0 border-r border-gray-200 bg-white transition-all duration-200 ${sidebarOpen ? "w-40" : "w-9"}`}>
          {/* header */}
          <div className="flex h-8 items-center justify-between border-b border-gray-100 px-2">
            {sidebarOpen && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Pages ({numPages})
              </span>
            )}
            <button
              type="button"
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              onClick={() => setSidebarOpen((o) => !o)}
              className="ml-auto rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
          </div>

          {/* thumbnails */}
          {sidebarOpen && (
            <div className="h-[calc(100%-2rem)] overflow-y-auto p-3">
              <Document file={documentFile} loading={null}>
                {Array.from({ length: numPages }, (_, i) => {
                  const isDraggingOver = thumbOverIdx === i && dragPageIdx.current !== i;
                  return (
                    <div
                      key={`thumb-${i}`}
                      ref={(el) => { thumbRefs.current[i] = el; }}
                      draggable
                      onDragStart={(e) => { dragPageIdx.current = i; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (thumbOverIdx !== i) setThumbOverIdx(i); }}
                      onDragLeave={() => { if (thumbOverIdx === i) setThumbOverIdx(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragPageIdx.current;
                        if (from !== null && from !== i) {
                          const order = Array.from({ length: numPages }, (_, x) => x);
                          order.splice(from, 1);
                          order.splice(i, 0, from);
                          void reorderPages(order);
                        }
                        dragPageIdx.current = null;
                        setThumbOverIdx(null);
                      }}
                      onDragEnd={() => { dragPageIdx.current = null; setThumbOverIdx(null); }}
                      className={`group relative mb-3 cursor-grab rounded border-2 transition-opacity active:cursor-grabbing ${
                        activePage === i ? "border-blue-500" : "border-transparent hover:border-blue-200"
                      } ${isDraggingOver ? "border-t-4 border-t-blue-500 opacity-80" : ""}`}
                      onClick={() => {
                        setActivePage(i);
                        document.getElementById(`pdf-page-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <Page pageIndex={i} width={THUMB_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} />

                      {/* page number badge */}
                      <span className="absolute bottom-1 left-1 rounded bg-gray-900/70 px-1.5 text-[10px] text-white">
                        {i + 1}
                      </span>

                      {/* hover controls */}
                      <div className="absolute inset-x-0 top-1 hidden items-center justify-between px-1 group-hover:flex">
                        {/* rotate buttons */}
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            title="Rotate left"
                            className="rounded bg-gray-900/70 p-0.5 text-white hover:bg-gray-900"
                            onClick={(e) => { e.stopPropagation(); void rotatePage(i, -90); }}
                          >
                            <RotateCcw size={11} />
                          </button>
                          <button
                            type="button"
                            title="Rotate right"
                            className="rounded bg-gray-900/70 p-0.5 text-white hover:bg-gray-900"
                            onClick={(e) => { e.stopPropagation(); void rotatePage(i, 90); }}
                          >
                            <RotateCw size={11} />
                          </button>
                        </div>

                        {/* delete button */}
                        {numPages > 1 && (
                          <button
                            type="button"
                            title="Delete page"
                            className="rounded bg-red-600 p-0.5 text-white hover:bg-red-700"
                            onClick={(e) => { e.stopPropagation(); void deletePage(i); }}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Document>
            </div>
          )}
        </aside>

        {/* ===================== Main canvas ===================== */}
        <main className="flex-1 overflow-auto p-8" onClick={() => setSelectedId(null)}>
          <Document
            file={documentFile}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<div className="flex justify-center pt-20 text-gray-400">Rendering…</div>}
          >
            {Array.from({ length: numPages }, (_, i) => {
              const dims = pageDims[i];
              const renderedWidth = BASE_PAGE_WIDTH * zoom;
              const scale = dims ? getScale(renderedWidth, dims.width) : 1;

              return (
                <div
                  key={`page-${i}`}
                  id={`pdf-page-${i}`}
                  className={`relative mx-auto mb-6 w-fit bg-white shadow-md ${
                    activePage === i ? "outline outline-2 outline-blue-300" : ""
                  }`}
                  onClick={(e) => { e.stopPropagation(); setActivePage(i); setSelectedId(null); }}
                >
                  <Page
                    pageIndex={i}
                    width={renderedWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(page) => {
                      setPageDims((prev) =>
                        prev[i] ? prev : { ...prev, [i]: { width: page.originalWidth, height: page.originalHeight } }
                      );
                    }}
                  />
                  {dims && (
                    <DrawingLayer
                      pageIndex={i}
                      scale={scale}
                      strokes={strokes.filter((s) => s.pageIndex === i)}
                      tool={drawTool}
                      color={strokeStyle.color}
                      strokeWidth={strokeStyle.width}
                      opacity={strokeStyle.opacity}
                      blend={strokeStyle.blend}
                      onAddStroke={(s) => { pushHistory(); setStrokes((prev) => [...prev, s]); }}
                      onDeleteStroke={(id) => { pushHistory(); setStrokes((prev) => prev.filter((s) => s.id !== id)); }}
                    />
                  )}
                  {dims &&
                    annotations
                      .filter((a) => a.pageIndex === i)
                      .map((a) => (
                        <DraggableOverlay
                          key={a.id}
                          annotation={a}
                          scale={scale}
                          isSelected={selectedId === a.id}
                          onSelect={setSelectedId}
                          onChange={updateAnnotation}
                          onDelete={deleteAnnotation}
                        />
                      ))}
                </div>
              );
            })}
          </Document>
        </main>
      </div>

      {/* ===================== Modals ===================== */}
      {showSignatureModal && (
        <SignatureModal
          onClose={() => setShowSignatureModal(false)}
          onConfirm={(dataUrl, aspect) => { addSignature(dataUrl, aspect); setShowSignatureModal(false); }}
        />
      )}
      {showSplitModal && (
        <SplitModal
          numPages={numPages}
          isBusy={isBusy}
          onClose={() => setShowSplitModal(false)}
          onExport={(indices) => void handleSplitExport(indices)}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  icon, label, title, onClick, active = false, disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? "bg-blue-100 text-blue-700" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
