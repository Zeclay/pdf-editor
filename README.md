# PDF Editor (client-side)

Next.js App Router + TypeScript editor: annotate, sign, merge, delete pages, split, and bake everything into a final PDF — entirely in the browser.

## Setup

```bash
npm install
npm run dev
```

If starting from scratch instead of this repo:

```bash
npx create-next-app@latest pdf-editor --typescript --tailwind --app --src-dir=false
cd pdf-editor
npm install pdf-lib react-pdf react-rnd react-signature-canvas lucide-react
npm install -D @types/react-signature-canvas
```

## Project structure

```
pdf-editor/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # dynamic import (ssr: false) of the editor
│   └── globals.css
├── components/
│   └── editor/
│       ├── PdfEditor.tsx         # main container: state, upload/merge, rendering, sidebar
│       ├── DraggableOverlay.tsx  # react-rnd wrapper (text + signature boxes)
│       ├── SignatureModal.tsx    # (phase 2) react-signature-canvas modal
│       └── SplitModal.tsx        # (phase 2) page-range export
├── lib/
│   ├── types.ts                  # Annotation model (stored in PDF points!)
│   ├── coords.ts                 # screen px <-> PDF points + y-flip helpers
│   └── export.ts                 # (phase 2) pdf-lib baking logic
├── next.config.mjs               # canvas alias stub for pdfjs
└── package.json
```

## Coordinate system (the important bit)

- Annotations are stored in **PDF points** with a **top-left origin**, never in screen pixels.
- `scale = renderedPageWidthPx / pageWidthPt` (react-pdf's `page.originalWidth` IS the width in points).
- Display: `px = pt * scale`. Commit on drag/resize stop: `pt = px / scale`.
- Export (pdf-lib uses bottom-left origin): `pdfY = pageHeight - topY - height`.

Because storage is zoom-independent, zooming never corrupts positions and export needs only the y-flip.
