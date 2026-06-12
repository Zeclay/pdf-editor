"use client";

import dynamic from "next/dynamic";

// pdfjs touches `window`/`DOMMatrix`, so the editor must never run on the server.
const PdfEditor = dynamic(() => import("@/components/editor/PdfEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-gray-400">
      Loading editor…
    </div>
  ),
});

export default function Home() {
  return <PdfEditor />;
}
