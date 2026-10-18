# block-grid-editor

A visual grid editor for **Interlocking Puzzle** configurations. Build key pieces from unit cells
(block; one to four spikes on an edge; matching holes), place them on an assembly grid, and see overlaps and
spike-into-hole fits live. Everything autosaves to localStorage; export/import as JSON, export PNG.

Live: https://www.iambaangkok.dev/block-grid-editor/

```sh
pnpm install
pnpm dev     # http://localhost:5173/block-grid-editor/
pnpm test && pnpm lint && pnpm build
```

## Controls

| | Mouse / keyboard | Touch |
|---|---|---|
| Move piece | drag it (Shift+arrows nudge one cell) | drag it |
| Select | click, Shift+click, drag a box, Ctrl+A | tap |
| Pan | middle/right drag, Space+drag, H tool, trackpad scroll | drag empty space |
| Zoom | wheel, ctrl/pinch on trackpad | pinch |
| Rotate / mirror | → or R (clockwise), ← or Shift+R / F | toolbar |
| Copy / cut / paste | Ctrl+C / Ctrl+X / Ctrl+V (pastes at the pointer) | — |
| Duplicate / delete | Ctrl+D / Del | toolbar |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z | toolbar |
| Edit key piece | double-click a piece | ✎ in toolbar |

See [CONTEXT.md](CONTEXT.md) for the domain model.
