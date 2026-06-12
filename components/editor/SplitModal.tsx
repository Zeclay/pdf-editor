"use client";

import { useMemo, useState } from "react";
import { X, Scissors, Loader2 } from "lucide-react";
import { parsePageRanges } from "@/lib/export";

interface SplitModalProps {
  numPages: number;
  isBusy: boolean;
  /** 0-based page indices to export as a new PDF */
  onExport: (indices: number[]) => void;
  onClose: () => void;
}

export default function SplitModal({
  numPages,
  isBusy,
  onExport,
  onClose,
}: SplitModalProps) {
  const [input, setInput] = useState(`1-${numPages}`);

  const parsed = useMemo<{ indices: number[] } | { error: string }>(() => {
    try {
      return { indices: parsePageRanges(input, numPages) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invalid input" };
    }
  }, [input, numPages]);

  const valid = "indices" in parsed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            Export page range
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <label className="mb-1 block text-sm text-gray-600">
          Pages to export (document has {numPages} page{numPages > 1 ? "s" : ""})
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 1-3, 5, 8-10"
          autoFocus
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
            valid
              ? "border-gray-300 focus:ring-blue-200"
              : "border-red-400 focus:ring-red-200"
          }`}
        />
        <p className={`mt-1.5 h-5 text-xs ${valid ? "text-gray-500" : "text-red-600"}`}>
          {valid
            ? `${parsed.indices.length} page${parsed.indices.length > 1 ? "s" : ""} selected`
            : parsed.error}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || isBusy}
            onClick={() => valid && onExport(parsed.indices)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Scissors size={14} />
            )}
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
