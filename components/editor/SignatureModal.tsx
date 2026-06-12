"use client";

import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { X, Eraser, Check, PenLine, ImageUp, Trash2 } from "lucide-react";

const PEN_COLORS = [
  { hex: "#111827", label: "Black" },
  { hex: "#1d4ed8", label: "Blue" },
  { hex: "#b91c1c", label: "Red" },
];

/** Cap uploaded image size; plenty for print resolution, keeps the PDF small. */
const MAX_UPLOAD_WIDTH = 1200;

type Tab = "draw" | "upload";

interface UploadedImage {
  dataUrl: string;
  /** width / height — used to size the Rnd box to the image's shape */
  aspect: number;
}

interface SignatureModalProps {
  /**
   * Receives a PNG data URL (drawn signatures are whitespace-trimmed,
   * uploads are normalized to PNG) and the image's aspect ratio (w/h).
   */
  onConfirm: (dataUrl: string, aspect: number) => void;
  onClose: () => void;
}

export default function SignatureModal({ onConfirm, onClose }: SignatureModalProps) {
  const [tab, setTab] = useState<Tab>("draw");

  // --- draw tab ---
  const sigRef = useRef<SignatureCanvas>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[0].hex);
  const [isEmpty, setIsEmpty] = useState(true);

  // --- upload tab ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedImage | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const clearDrawing = () => {
    sigRef.current?.clear();
    setIsEmpty(true);
  };

  /**
   * Normalize any browser-decodable image (PNG/JPG/WebP/GIF…) to a PNG data
   * URL via canvas. PNG keeps transparency and is the one format the export
   * pipeline embeds (pdf-lib embedPng), so nothing downstream changes.
   */
  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_UPLOAD_WIDTH / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      setUploaded({
        dataUrl: canvas.toDataURL("image/png"),
        aspect: img.naturalWidth / img.naturalHeight,
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const confirm = () => {
    if (tab === "draw") {
      const sig = sigRef.current;
      if (!sig || sig.isEmpty()) return;
      let canvas: HTMLCanvasElement;
      try {
        // Trimmed = no surrounding whitespace, so the image fills its Rnd box.
        canvas = sig.getTrimmedCanvas();
      } catch {
        canvas = sig.getCanvas();
      }
      onConfirm(canvas.toDataURL("image/png"), canvas.width / canvas.height);
    } else if (uploaded) {
      onConfirm(uploaded.dataUrl, uploaded.aspect);
    }
  };

  const canConfirm = tab === "draw" ? !isEmpty : uploaded !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Add signature</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* ---- tabs ---- */}
        <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
          <TabButton
            active={tab === "draw"}
            icon={<PenLine size={14} />}
            label="Draw"
            onClick={() => setTab("draw")}
          />
          <TabButton
            active={tab === "upload"}
            icon={<ImageUp size={14} />}
            label="Upload image"
            onClick={() => setTab("upload")}
          />
        </div>

        {/* ---- draw tab ---- */}
        {/* Kept mounted (hidden) so switching tabs doesn't erase the drawing. */}
        <div className={tab === "draw" ? "" : "hidden"}>
          {/* Fixed canvas dimensions on purpose: CSS-stretching a canvas would
              desync pointer coordinates from drawn pixels. */}
          <SignatureCanvas
            ref={sigRef}
            penColor={penColor}
            onEnd={() => setIsEmpty(sigRef.current?.isEmpty() ?? true)}
            canvasProps={{
              width: 470,
              height: 180,
              className:
                "rounded-lg border border-dashed border-gray-300 bg-gray-50 touch-none",
            }}
          />
          <div className="mt-3 flex items-center gap-2">
            {PEN_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                onClick={() => setPenColor(c.hex)}
                className={`h-6 w-6 rounded-full border-2 ${
                  penColor === c.hex ? "border-blue-500" : "border-transparent"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <div className="flex-1" />
            <button
              type="button"
              onClick={clearDrawing}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              <Eraser size={14} />
              Clear
            </button>
          </div>
        </div>

        {/* ---- upload tab ---- */}
        {tab === "upload" && (
          <div>
            {uploaded ? (
              <div className="relative rounded-lg border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0%_25%,white_0%_50%)] bg-[length:16px_16px] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploaded.dataUrl}
                  alt="Signature preview"
                  className="mx-auto max-h-40 object-contain"
                />
                <button
                  type="button"
                  title="Remove"
                  onClick={() => setUploaded(null)}
                  className="absolute right-2 top-2 rounded bg-white/90 p-1.5 text-red-600 shadow hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <div
                className={`flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors ${
                  isDragOver
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 bg-gray-50 hover:border-blue-400"
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
                  const file = e.dataTransfer.files[0];
                  if (file) processImageFile(file);
                }}
              >
                <ImageUp size={28} className="text-blue-500" />
                <p className="text-sm font-medium text-gray-700">
                  Drop an image or click to browse
                </p>
                <p className="text-xs text-gray-400">
                  PNG with transparent background works best
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processImageFile(file);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
          </div>
        )}

        {/* ---- footer ---- */}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} />
            Add to Document
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
