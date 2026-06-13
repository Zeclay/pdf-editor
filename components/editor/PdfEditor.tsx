"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument } from "pdf-lib";
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
} from "lucide-react";
import DraggableOverlay from "./DraggableOverlay";
import DrawingLayer from "./DrawingLayer";
import SignatureModal from "./SignatureModal";
import SplitModal from "./SplitModal";
import type {
  Annotation,
  DrawTool,
  InkStroke,
  PageDimensions,
} from "@/lib/types";
import { getScale, newId } from "@/lib/coords";
import {
  bakeAnnotations,
  extractPages,
  downloadBytes,
  baseName,
} from "@/lib/export";

// pdf.js worker — served as a plain static file from /public, copied there
// from the installed pdfjs-dist by scripts/copy-pdf-worker.mjs (predev/prebuild).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** Base rendered page width in CSS px at zoom = 1 */
const BASE_PAGE_WIDTH = 800;
const THUMB_WIDTH = 110;
const MAX_HISTORY = 30;

const PEN_COLORS = ["#111827", "#1d4ed8", "#b91c1c"];
const HIGHLIGHT_COLORS = ["#facc15", "#4ade80", "#f472b6"];

/** Stroke width ranges in PDF points */
const PEN_WIDTH_RANGE = { min: 1, max: 10, default: 2 };
const HIGHLIGHT_WIDTH_RANGE = { min: 6, max: 24, default: 12 };

// ---------------------------------------------------------------------------
// History snapshot — everything needed to fully restore editor state
// ---------------------------------------------------------------------------
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

  // ---- freehand drawing state ----
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[2]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTH_RANGE.default);
  const [highlightWidth, setHighlightWidth] = useState(
    HIGHLIGHT_WIDTH_RANGE.default
  );

  // ---- undo / redo ----
  // Stacks live in refs (no re-render on push/pop); canUndo/canRedo are
  // plain state so toolbar buttons react immediately.
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ---- sidebar ----
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // One ref per thumbnail div — used for auto-scroll.
  const thumbRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ---- page reorder drag state ----
  const dragPageIdx = useRef<number | null>(null);
  const [thumbOverIdx, setThumbOverIdx] = useState<number | null>(null);

  // Style for NEW strokes, resolved from the active tool.
  const strokeStyle =
    drawTool === "highlighter"
      ? {
          color: highlightColor,
          width: highlightWidth,
          opacity: 0.45,
          blend: "multiply" as const,
        }
      : { color: penColor, width: penWidth, opacity: 1, blend: "normal" as const };

  const toggleDrawTool = (tool: DrawTool) => {
    setDrawTool((t) => (t === tool ? null : tool));
    setSelectedId(null);
  };

  // Blob prevents DataCloneError when two <Document>s share the same buffer.
  const documentFile = useMemo(
    () =>
      pdfBytes
        ? new Blob([pdfBytes.slice().buffer], { type: "application/pdf" })
        : null,
    [pdfBytes]
  );

  // ===========================================================================
  // History helpers
  // ===========================================================================

  /**
   * Call BEFORE any mutating operation to snapshot the current state.
   * Any new action clears the redo stack (standard linear undo model).
   */
  const pushHistory = useCallback(() => {
    undoStack.current = [
      ...undoStack.current,
      { pdfBytes, annotations, strokes },
    ].slice(-MAX_HISTORY);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [pdfBytes, annotations, strokes]);

  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current = [
      ...redoStack.current,
      { pdfBytes, annotations, strokes },
    ];
    // Only swap pdfBytes when the page structure actually changed (cheap
    // reference comparison avoids resetting pageDims / numPages on pure
    // annotation edits).
    if (snapshot.pdfBytes !== pdfBytes) {
      setNumPages(0);
      setPdfBytes(snapshot.pdfBytes);
      setPageDims({});
    }
    setAnnotations(snapshot.annotations);
    setStrokes(snapshot.strokes);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [pdfBytes, annotations, strokes]);

  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current = [
      ...undoStack.current,
      { pdfBytes, annotations, strokes },
    ].slice(-MAX_HISTORY);
    if (snapshot.pdfBytes !== pdfBytes) {
      setNumPages(0);
      setPdfBytes(snapshot.pdfBytes);
      setPageDims({});
    }
    setAnnotations(snapshot.annotations);
    setStrokes(snapshot.strokes);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [pdfBytes, annotations, strokes]);

  // ===========================================================================
  // Sidebar: auto-scroll active thumbnail into view
  // ===========================================================================
  useEffect(() => {
    if (!sidebarOpen) return;
    thumbRefs.current[activePage]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activePage, sidebarOpen]);

  // ===========================================================================
  // File management: open / merge
  // ===========================================================================
  const loadFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      if (pdfs.length === 0) return;
      setIsBusy(true);
      try {
        let bytes: Uint8Array;
        if (pdfs.length === 1 && !pdfBytes) {
          bytes = new Uint8Array(await pdfs[0].arrayBuffer());
        } else {
          const merged = await PDFDocument.create();
          const sources: (Uint8Array | ArrayBuffer)[] = [];
          if (pdfBytes) sources.push(pdfBytes);
          for (const f of pdfs) sources.push(await f.arrayBuffer());
          for (const src of sources) {
            const doc = await PDFDocument.load(src, {
              ignoreEncryption: true,
            });
            const pages = await merged.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => merged.addPage(p));
          }
          bytes = await merged.save();
        }
        setNumPages(0);
        setPdfBytes(bytes);
        if (!pdfBytes) setFileName(pdfs[0].name);
        setPageDims({});
        setSelectedId(null);
      } finally {
        setIsBusy(false);
      }
    },
    [pdfBytes]
  );

  // ===========================================================================
  // Page operations
  // ===========================================================================
  const deletePage = useCallback(
    async (pageIndex: number) => {
      if (!pdfBytes || numPages <= 1) return;
      pushHistory();
      setIsBusy(true);
      try {
        const doc = await PDFDocument.load(pdfBytes, {
          ignoreEncryption: true,
        });
        doc.removePage(pageIndex);
        const bytes = await doc.save();
        setNumPages(0);
        setPdfBytes(bytes);
        setPageDims({});
        setAnnotations((prev) =>
          prev
            .filter((a) => a.pageIndex !== pageIndex)
            .map((a) =>
              a.pageIndex > pageIndex
                ? { ...a, pageIndex: a.pageIndex - 1 }
                : a
            )
        );
        setStrokes((prev) =>
          prev
            .filter((s) => s.pageIndex !== pageIndex)
            .map((s) =>
              s.pageIndex > pageIndex
                ? { ...s, pageIndex: s.pageIndex - 1 }
                : s
            )
        );
        setActivePage((p) => Math.max(0, Math.min(p, numPages - 2)));
      } finally {
        setIsBusy(false);
      }
    },
    [pdfBytes, numPages, pushHistory]
  );

  // ===========================================================================
  // Page reorder
  // ===========================================================================
  const reorderPages = useCallback(
    async (newOrder: number[]) => {
      if (!pdfBytes) return;
      pushHistory();
      setIsBusy(true);
      try {
        const bytes = await extractPages(pdfBytes, newOrder);
        setNumPages(0);
        setPdfBytes(bytes);
        setPageDims({});
        setAnnotations((prev) =>
          prev
            .map((a) => ({ ...a, pageIndex: newOrder.indexOf(a.pageIndex) }))
            .filter((a) => a.pageIndex !== -1)
        );
        setStrokes((prev) =>
          prev
            .map((s) => ({ ...s, pageIndex: newOrder.indexOf(s.pageIndex) }))
            .filter((s) => s.pageIndex !== -1)
        );
        setActivePage((p) => {
          const next = newOrder.indexOf(p);
          return next === -1 ? 0 : next;
        });
      } finally {
        setIsBusy(false);
      }
    },
    [pdfBytes, pushHistory]
  );

  // ===========================================================================
  // Annotations
  // ===========================================================================
  const addText = useCallback(() => {
    const dims = pageDims[activePage];
    if (!dims) return;
    setDrawTool(null);
    pushHistory();
    const ann: Annotation = {
      id: newId(),
      type: "text",
      pageIndex: activePage,
      x: dims.width / 2 - 90,
      y: dims.height / 3,
      width: 180,
      height: 28,
      text: "Double-click to edit",
      fontSize: 14,
      color: "#111827",
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
      const height = Math.min(
        width / (aspect > 0 ? aspect : 2.5),
        dims.height / 3
      );
      const ann: Annotation = {
        id: newId(),
        type: "signature",
        pageIndex: activePage,
        x: dims.width / 2 - width / 2,
        y: dims.height / 2,
        width,
        height,
        dataUrl,
      };
      setAnnotations((prev) => [...prev, ann]);
      setSelectedId(ann.id);
    },
    [activePage, pageDims, pushHistory]
  );

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      pushHistory();
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
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

  // ===========================================================================
  // Keyboard shortcuts
  // ===========================================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "TEXTAREA" ||
        t.tagName === "INPUT" ||
        t.isContentEditable
      )
        return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteAnnotation(selectedId);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        // Ctrl+Shift+Z = Redo (common on Windows/Linux)
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        // Ctrl+Y = Redo (Windows convention)
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setDrawTool(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deleteAnnotation, undo, redo]);

  // ===========================================================================
  // Modals + export
  // ===========================================================================
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
      } finally {
        setIsBusy(false);
      }
    },
    [pdfBytes, fileName]
  );

  const finalizeAndDownload = useCallback(async () => {
    if (!pdfBytes) return;
    setIsBusy(true);
    try {
      const bytes = await bakeAnnotations(pdfBytes, annotations, strokes);
      downloadBytes(bytes, `${baseName(fileName)}-final.pdf`);
    } finally {
      setIsBusy(false);
    }
  }, [pdfBytes, annotations, strokes, fileName]);

  // ===========================================================================
  // Render
  // ===========================================================================
  if (!pdfBytes) {
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <div
          className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
            isDragOver
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            void loadFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <FileUp size={40} className="text-blue-500" />
          <div>
            <p className="text-lg font-semibold text-gray-800">
              Drop PDF files here
            </p>
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
            onChange={(e) =>
              e.target.files && void loadFiles(Array.from(e.target.files))
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* ===================== Toolbar ===================== */}
      <header className="z-30 flex items-center gap-1 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
        <span className="mr-3 max-w-48 truncate text-sm font-semibold text-gray-700">
          {fileName}
        </span>

        <ToolbarButton
          icon={<FilePlus2 size={16} />}
          label="Add PDF"
          onClick={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) =>
            e.target.files && void loadFiles(Array.from(e.target.files))
          }
        />
        <ToolbarButton
          icon={<Type size={16} />}
          label="Add Text"
          onClick={addText}
        />
        <ToolbarButton
          icon={<PenLine size={16} />}
          label="Sign"
          onClick={() => setShowSignatureModal(true)}
        />
        <ToolbarButton
          icon={<Scissors size={16} />}
          label="Split"
          onClick={() => setShowSplitModal(true)}
        />

        <div className="mx-3 h-5 w-px bg-gray-200" />

        {/* ---- draw tools ---- */}
        <ToolbarButton
          icon={<Pencil size={16} />}
          label="Draw"
          active={drawTool === "pen"}
          onClick={() => toggleDrawTool("pen")}
        />
        <ToolbarButton
          icon={<Highlighter size={16} />}
          label="Highlight"
          active={drawTool === "highlighter"}
          onClick={() => toggleDrawTool("highlighter")}
        />
        <ToolbarButton
          icon={<Eraser size={16} />}
          label=""
          active={drawTool === "eraser"}
          onClick={() => toggleDrawTool("eraser")}
        />
        {(drawTool === "pen" || drawTool === "highlighter") && (
          <div className="ml-1 flex items-center gap-1.5">
            {(drawTool === "pen" ? PEN_COLORS : HIGHLIGHT_COLORS).map((c) => {
              const current = drawTool === "pen" ? penColor : highlightColor;
              const setColor =
                drawTool === "pen" ? setPenColor : setHighlightColor;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border-2 ${
                    current === c ? "border-blue-500" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              );
            })}

            {/* stroke width slider */}
            <input
              type="range"
              title="Stroke width"
              min={
                drawTool === "pen"
                  ? PEN_WIDTH_RANGE.min
                  : HIGHLIGHT_WIDTH_RANGE.min
              }
              max={
                drawTool === "pen"
                  ? PEN_WIDTH_RANGE.max
                  : HIGHLIGHT_WIDTH_RANGE.max
              }
              step={1}
              value={drawTool === "pen" ? penWidth : highlightWidth}
              onChange={(e) =>
                (drawTool === "pen" ? setPenWidth : setHighlightWidth)(
                  Number(e.target.value)
                )
              }
              className="ml-2 h-1 w-20 cursor-pointer accent-blue-600"
            />
            {/* live preview dot */}
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

        {/* ---- undo / redo ---- */}
        <ToolbarButton
          icon={<Undo2 size={16} />}
          label=""
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolbarButton
          icon={<Redo2 size={16} />}
          label=""
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        />

        <div className="mx-3 h-5 w-px bg-gray-200" />

        <ToolbarButton
          icon={<ZoomOut size={16} />}
          label=""
          onClick={() =>
            setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))
          }
        />
        <span className="w-12 text-center text-xs tabular-nums text-gray-500">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton
          icon={<ZoomIn size={16} />}
          label=""
          onClick={() =>
            setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))
          }
        />

        <div className="flex-1" />
        {isBusy && (
          <Loader2 size={16} className="mr-2 animate-spin text-blue-500" />
        )}
        <button
          type="button"
          onClick={finalizeAndDownload}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Download size={15} />
          Finalize &amp; Download
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ===================== Thumbnail sidebar ===================== */}
        <aside
          className={`shrink-0 border-r border-gray-200 bg-white transition-all duration-200 ${
            sidebarOpen ? "w-40" : "w-9"
          }`}
        >
          {/* header row: page count + collapse toggle */}
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
              {sidebarOpen ? (
                <PanelLeftClose size={15} />
              ) : (
                <PanelLeftOpen size={15} />
              )}
            </button>
          </div>

          {/* thumbnail list */}
          {sidebarOpen && (
            <div className="h-[calc(100%-2rem)] overflow-y-auto p-3">
              <Document file={documentFile} loading={null}>
                {Array.from({ length: numPages }, (_, i) => {
                  const isDraggingOver =
                    thumbOverIdx === i && dragPageIdx.current !== i;
                  return (
                    <div
                      key={`thumb-${i}`}
                      ref={(el) => {
                        thumbRefs.current[i] = el;
                      }}
                      draggable
                      onDragStart={(e) => {
                        dragPageIdx.current = i;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (thumbOverIdx !== i) setThumbOverIdx(i);
                      }}
                      onDragLeave={() => {
                        if (thumbOverIdx === i) setThumbOverIdx(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragPageIdx.current;
                        if (from !== null && from !== i) {
                          const order = Array.from(
                            { length: numPages },
                            (_, x) => x
                          );
                          order.splice(from, 1);
                          order.splice(i, 0, from);
                          void reorderPages(order);
                        }
                        dragPageIdx.current = null;
                        setThumbOverIdx(null);
                      }}
                      onDragEnd={() => {
                        dragPageIdx.current = null;
                        setThumbOverIdx(null);
                      }}
                      className={`group relative mb-3 cursor-grab rounded border-2 transition-opacity active:cursor-grabbing ${
                        activePage === i
                          ? "border-blue-500"
                          : "border-transparent hover:border-blue-200"
                      } ${
                        isDraggingOver
                          ? "border-t-4 border-t-blue-500 opacity-80"
                          : ""
                      }`}
                      onClick={() => {
                        setActivePage(i);
                        document
                          .getElementById(`pdf-page-${i}`)
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                      }}
                    >
                      <Page
                        pageIndex={i}
                        width={THUMB_WIDTH}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-gray-900/70 px-1.5 text-[10px] text-white">
                        {i + 1}
                      </span>
                      {numPages > 1 && (
                        <button
                          type="button"
                          title="Delete page"
                          className="absolute right-1 top-1 hidden rounded bg-red-600 p-1 text-white group-hover:block"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deletePage(i);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </Document>
            </div>
          )}
        </aside>

        {/* ===================== Main canvas ===================== */}
        <main
          className="flex-1 overflow-auto p-8"
          onClick={() => setSelectedId(null)}
        >
          <Document
            file={documentFile}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={
              <div className="flex justify-center pt-20 text-gray-400">
                Rendering…
              </div>
            }
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
                    activePage === i
                      ? "outline outline-2 outline-blue-300"
                      : ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePage(i);
                    setSelectedId(null);
                  }}
                >
                  <Page
                    pageIndex={i}
                    width={renderedWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(page) => {
                      setPageDims((prev) =>
                        prev[i]
                          ? prev
                          : {
                              ...prev,
                              [i]: {
                                width: page.originalWidth,
                                height: page.originalHeight,
                              },
                            }
                      );
                    }}
                  />
                  {/* Freehand ink layer */}
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
                      onAddStroke={(s) => {
                        pushHistory();
                        setStrokes((prev) => [...prev, s]);
                      }}
                      onDeleteStroke={(id) => {
                        pushHistory();
                        setStrokes((prev) =>
                          prev.filter((s) => s.id !== id)
                        );
                      }}
                    />
                  )}
                  {/* Draggable annotation layer */}
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
          onConfirm={(dataUrl, aspect) => {
            addSignature(dataUrl, aspect);
            setShowSignatureModal(false);
          }}
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
  icon,
  label,
  title,
  onClick,
  active = false,
  disabled = false,
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
        active
          ? "bg-blue-100 text-blue-700"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
