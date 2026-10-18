# block-grid-editor — domain & decisions

A visual, grid-based editor for building **Interlocking Puzzle** configurations (research into
undecidability). Web SPA, live at `https://www.iambaangkok.dev/block-grid-editor/`.

## Ubiquitous language

- **Assembly** — a named, square 2D grid on which **Key Piece placements** sit. Coordinates:
  `(0,0)` at the centre, `+x` right, `+y` up. Working bounds 128×128 (`x, y ∈ [-64, 63]`) for now;
  the model treats the grid as unbounded. Many assemblies; all persisted to localStorage.
- **Key Piece** — a named template: a set of **Unit Cells** at integer offsets, plus one **border
  colour** and one **fill colour** shared by every cell in it. Owned by one assembly; can be
  *copied* (independent duplicate) to another assembly.
- **Placement** — an instance of a Key Piece on an assembly: position + rotation (0/90/180/270) +
  mirror flag. Linked to its template — editing the Key Piece updates every placement live.
  Only placements go on an assembly (no loose cells).
- **Unit Cell** — one grid cell inside a Key Piece. Has a **kind** and (except `block`) a
  **direction** (the edge its feature sits on: N/E/S/W), rotatable in 90° steps.

### Unit Cell kinds

| kind | look |
|---|---|
| `block` | full square (not rotatable) |
| `spike` | no block — a triangle on one edge; its base is inset from the edge's ends (never the full edge, so four spikes don't tile a square), apex at the centre |
| `hole` | full block with a matching triangular notch cut in from one edge |
| `spike2` / `spike3` / `spike4` | no block — 2 / 3 / 4 smaller spikes side by side on the **same** edge (edge split into equal slots, each spike inset in its slot; depth min(½, 1/n)) |
| `hole2` / `hole3` / `hole4` | block with the matching 2 / 3 / 4 notches on one edge |

### Overlap & fit

Placements may overlap. Per occupied grid cell, the resolved cells are classified:
- **fit** — a spike cell in the hole cell with the same count (`spikeN` in `holeN`), same edge, so the triangles land exactly in the notches → shown as a valid
  interlock indicator.
- **conflict** — any other overlap (block/block, spike into solid, mismatched spike/hole such as `spike` into `hole2`) →
  red warning.

The classification is a pure function over the assembly model, so later analysis (lock checks,
sliding/disassembly simulation) can build on the same data.

## Decisions

- Stack: pnpm, Vite, React 19, TypeScript, Tailwind 4, Canvas 2D rendering, vitest, oxlint
  (mirrors `tweet-typer`).
- Input: desktop mouse + touch (pointer events, pinch-zoom, pan).
- Infinite pan/zoom canvas, white background, light grid lines, axes through origin.
- Editing: select / box-select / move / rotate (→ / ← or R / Shift+R) / mirror (F) / duplicate /
  delete; Shift+Arrow nudges; copy / cut / paste (Ctrl+C / X / V — in-app clipboard, pastes at the
  pointer, works across assemblies by copying the key pieces along); undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- Key Piece editor: separate panel with its own small grid; place cells freely, rotate cells in
  90° steps; mirror whole piece.
- Colours: per Key Piece — border + fill only, no stroke width. Excalidraw-style palette
  (~12 hues × 5 shades) plus quick defaults (yellow, bright green, pink, red, blue, orange,
  purple, black). No free hex picker.
- Persistence: autosave everything to localStorage. Export/import JSON (single assembly or whole
  workspace). PNG export of an assembly, and of all its key pieces in one
  labelled row.
- Deploy: **subpath** `https://www.iambaangkok.dev/block-grid-editor/`. Cloudflare Worker with
  Static Assets (assets-only, no script) bound by a **route** `www.iambaangkok.dev/block-grid-editor*`
  in `wrangler.jsonc`. Routes don't strip the prefix, so Vite `base: '/block-grid-editor/'` and the
  build emits into `dist/block-grid-editor/` (assets dir = `dist`). `www` needs a proxied DNS record
  (none exists yet — e.g. `AAAA www 100::`, proxied). Git integration auto-deploys on push to `master`.

## Out of scope (v1)

- Interlock / undecidability analysis (data model is designed to support it later).
- YAML export, stroke widths, free colour picker.
