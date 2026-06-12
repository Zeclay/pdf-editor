"use client";

import { useRef, useState } from "react";
import type { DrawTool, InkPoint, InkStroke } from "@/lib/types";
import { pointsToSvgPath } from "@/lib/ink";
import { newId } from "@/lib/coords";

/** Ignore pointer moves shorter than this (in PDF points) — thins the data. */
const MIN_DIST_PT = 0.75;

interface DrawingLayerProps {
  pageIndex: number;
  /** CSS pixels per PDF point for this page */
  scale: number;
  /** Strokes belonging to this page only */
  strokes: InkStroke[];
  /** Active tool, or null when draw mode is off */
  tool: DrawTool | null;
  /** Style applied to NEW strokes (resolved by the parent from the tool) */
  color: string;
  strokeWidth: number; // PDF points
  opacity: number;
  blend: "normal" | "multiply";
  onAddStroke: (stroke: InkStroke) => void;
  onDeleteStroke: (id: string) => void;
}

/**
 * Per-page SVG overlay for freehand drawing.
 *
 * - Inactive (tool === null): pointer-events: none, sits UNDER the Rnd
 *   annotation boxes — strokes stay visible, text/signatures stay draggable.
 * - Active: jumps above everything (z-30) and captures all pointer input.
 * - Points are committed in PDF points (px / scale), same convention as
 *   annotations, so zoom never affects stored strokes.
 * - Eraser: click or drag across strokes; hit area is the stroke itself.
 */
export default function DrawingLayer({
  pageIndex,
  scale,
  strokes,
  tool,
  color,
  strokeWidth,
  opacity,
  blend,
  onAddStroke,
  onDeleteStroke,
}: DrawingLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [current, setCurrent] = useState<InkPoint[] | null>(null);

  const active = tool !== null;
  const isDrawing = tool === "pen" || tool === "highlighter";
  const isErasing = tool === "eraser";

  const toPt = (e: React.PointerEvent): InkPoint => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  return (
    <svg
      ref={svgRef}
      className={`absolute inset-0 h-full w-full ${
        active ? "z-30 touch-none" : "pointer-events-none z-[5]"
      } ${isDrawing ? "cursor-crosshair" : ""} ${isErasing ? "cursor-cell" : ""}`}
      onPointerDown={(e) => {
        if (!isDrawing || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setCurrent([toPt(e)]);
      }}
      onPointerMove={(e) => {
        if (!isDrawing || !current) return;
        const pt = toPt(e);
        const last = current[current.length - 1];
        const dx = pt.x - last.x;
        const dy = pt.y - last.y;
        if (dx * dx + dy * dy < MIN_DIST_PT * MIN_DIST_PT) return;
        setCurrent((prev) => (prev ? [...prev, pt] : prev));
      }}
      onPointerUp={() => {
        if (!isDrawing || !current) return;
        onAddStroke({
          id: newId(),
          pageIndex,
          points: current,
          color,
          width: strokeWidth,
          opacity,
          blend,
        });
        setCurrent(null);
      }}
      onPointerCancel={() => setCurrent(null)}
    >
      {/* committed strokes */}
      {strokes.map((s) => (
        <path
          key={s.id}
          d={pointsToSvgPath(s.points, scale)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width * scale}
          strokeOpacity={s.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: isErasing ? "visibleStroke" : "none" }}
          onPointerDown={(e) => {
            if (!isErasing) return;
            e.stopPropagation();
            onDeleteStroke(s.id);
          }}
          onPointerEnter={(e) => {
            // drag-to-erase: pointer moves over a stroke with button held
            if (isErasing && e.buttons > 0) onDeleteStroke(s.id);
          }}
        />
      ))}

      {/* live preview of the stroke being drawn */}
      {current && (
        <path
          d={pointsToSvgPath(current, scale)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth * scale}
          strokeOpacity={opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
