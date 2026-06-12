"use client";

import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { Trash2, GripVertical } from "lucide-react";
import type { Annotation } from "@/lib/types";
import { ptToPx, pxToPt } from "@/lib/coords";

interface DraggableOverlayProps {
  annotation: Annotation;
  /** CSS pixels per PDF point for the page this overlay sits on */
  scale: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  /** Patch is in PDF points (already converted) */
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
}

/**
 * A draggable / resizable box rendered ON TOP of a react-pdf page.
 *
 * The annotation itself lives in PDF-point space; this component is the
 * only place where points <-> pixels conversion happens during editing:
 *
 *   display:  px = pt * scale
 *   commit:   pt = px / scale   (on drag/resize stop)
 *
 * Because of this, the stored coordinates are zoom-independent and can be
 * passed almost directly to pdf-lib at export time (only y-flip needed).
 */
export default function DraggableOverlay({
  annotation,
  scale,
  isSelected,
  onSelect,
  onChange,
  onDelete,
}: DraggableOverlayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const isText = annotation.type === "text";

  return (
    <Rnd
      bounds="parent"
      position={{
        x: ptToPx(annotation.x, scale),
        y: ptToPx(annotation.y, scale),
      }}
      size={{
        width: ptToPx(annotation.width, scale),
        height: ptToPx(annotation.height, scale),
      }}
      onDragStart={() => onSelect(annotation.id)}
      onDragStop={(_e, d) =>
        onChange(annotation.id, {
          x: pxToPt(d.x, scale),
          y: pxToPt(d.y, scale),
        })
      }
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        onChange(annotation.id, {
          x: pxToPt(pos.x, scale),
          y: pxToPt(pos.y, scale),
          width: pxToPt(ref.offsetWidth, scale),
          height: pxToPt(ref.offsetHeight, scale),
        })
      }
      lockAspectRatio={annotation.type === "signature"}
      disableDragging={isEditing}
      enableResizing={isSelected}
      className={`group ${isSelected ? "z-20" : "z-10"}`}
      style={{ position: "absolute" }}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(annotation.id);
      }}
    >
      <div
        className={`relative h-full w-full rounded-sm transition-shadow ${
          isSelected
            ? "ring-2 ring-blue-500 shadow-lg"
            : "ring-1 ring-transparent hover:ring-blue-300"
        }`}
        onDoubleClick={() => isText && setIsEditing(true)}
      >
        {/* ---- content ---- */}
        {isText ? (
          isEditing ? (
            <textarea
              ref={textareaRef}
              defaultValue={annotation.text}
              className="h-full w-full resize-none bg-white/70 p-0 leading-tight outline-none"
              style={{
                fontSize: ptToPx(annotation.fontSize ?? 14, scale),
                color: annotation.color ?? "#111827",
                fontFamily: "Helvetica, Arial, sans-serif",
              }}
              onBlur={(e) => {
                onChange(annotation.id, { text: e.target.value });
                setIsEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              }}
            />
          ) : (
            <div
              className="h-full w-full cursor-move overflow-hidden whitespace-pre-wrap leading-tight"
              style={{
                fontSize: ptToPx(annotation.fontSize ?? 14, scale),
                color: annotation.color ?? "#111827",
                fontFamily: "Helvetica, Arial, sans-serif",
              }}
            >
              {annotation.text || "Double-click to edit"}
            </div>
          )
        ) : (
          // Signature image fills the box; aspect ratio is locked by Rnd.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={annotation.dataUrl}
            alt="Signature"
            draggable={false}
            className="h-full w-full cursor-move select-none object-contain"
          />
        )}

        {/* ---- controls (visible when selected/hovered) ---- */}
        <div
          className={`absolute -top-7 right-0 flex items-center gap-1 rounded bg-gray-900 px-1 py-0.5 ${
            isSelected ? "flex" : "hidden group-hover:flex"
          }`}
        >
          <GripVertical size={12} className="text-gray-400" />
          <button
            type="button"
            title="Delete"
            className="rounded p-0.5 text-red-400 hover:bg-gray-700 hover:text-red-300"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(annotation.id);
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </Rnd>
  );
}
